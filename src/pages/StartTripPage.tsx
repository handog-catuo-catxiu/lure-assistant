import { useRef, useState } from 'react'
import GearPickerList from '../components/GearPickerList'
import { GeoRows } from '../components/GeoStatusPanel'
import PlaceNote from '../components/PlaceNameInfo'
import SpotPicker from '../components/SpotPicker'
import Toast from '../components/Toast'
import ToggleSwitch from '../components/ToggleSwitch'
import TopBar from '../components/TopBar'
import { LocateIcon, PlayIcon } from '../components/icons'
import { useCurrentLocation } from '../hooks/useGeolocation'
import { useLastFix } from '../hooks/useLastFix'
import { useNow } from '../hooks/useNow'
import { usePlaceName } from '../hooks/usePlaceName'
import { useToast } from '../hooks/useToast'
import {
  formatAccuracy,
  formatCoordinate,
  formatFixAge,
  isFixFresh,
} from '../lib/geo'
import { placeRowItem } from '../lib/placeFormat'
import { formatClockSec } from '../lib/tripFormat'
import { resolveSessionGear } from '../lib/tripService'
import type { GearApi } from '../hooks/useGear'
import type { ImageLibraryApi } from '../hooks/useImageLibrary'
import type { TripApi } from '../hooks/useTrip'
import type { SpotDraft, TripSession } from '../types/trip'
import './StartTripPage.css'

const STEPS = ['标点', '装备', '确认']

interface StartTripPageProps {
  trip: TripApi
  gear: GearApi
  images: ImageLibraryApi
  /** 放弃这次出勤（还没开始，不会有任何数据落库） */
  onCancel: () => void
  /** options.recordTrack：用户是否同意出勤期间记录 GPS 轨迹 */
  onStarted: (session: TripSession, options: { recordTrack: boolean }) => void
}

/**
 * 开始出勤的三步流程：选标点 → 选装备（可跳过）→ 确认开始。
 * 只有最后一步真的创建出勤，前面两步随时退出都不会留下数据。
 *
 * 定位在这里是可选的准备工作：拿到位置可以顺手存到标点上，
 * 不授权、定位失败都不影响开始出勤。
 */
export default function StartTripPage({
  trip,
  gear,
  images,
  onCancel,
  onStarted,
}: StartTripPageProps) {
  const { message, showToast } = useToast()

  const [step, setStep] = useState(0)
  const [spotId, setSpotId] = useState<string | null>(null)
  const [gearIds, setGearIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [recordTrack, setRecordTrack] = useState(true)

  // 一次性定位：点一次拿一次，不会一直监听
  const locate = useCurrentLocation()
  const located = locate.position

  /** 没有定位时给一个「上次在哪儿」的参考，界面上写明这不是当前位置 */
  const lastFix = useLastFix()

  /** 手上的读数是不是已经旧了：旧了只能当参考，不能存成标点坐标 */
  const now = useNow(10_000)
  const locatedStale = located !== null && (locate.stale || !isFixFresh(located.recordedAt, now))

  /*
   * 拿到坐标后查一次地名：只有用户点「获取当前位置」才会查，
   * 出勤途中的轨迹更新一次都不会走到这里。
   */
  const place = usePlaceName(located)

  /*
   * 防止连点「开始出勤」。同步生效，不依赖 state 更新，
   * 否则两次点击之间 state 还没变，就会尝试开出第二场出勤。
   */
  const startingRef = useRef(false)

  const selectedSpot = spotId ? trip.spotById(spotId) : null

  /** 一次性定位的状态文案，没有定位时不显示任何坐标 */
  const locateBadge =
    locate.status === 'locating'
      ? { label: '定位中…', tone: 'wait' as const }
      : locate.status === 'success'
        ? { label: '定位成功', tone: 'ok' as const }
        : locate.status === 'error' || locate.status === 'unsupported'
          ? { label: '定位失败', tone: 'error' as const }
          : { label: '尚未定位', tone: 'off' as const }

  /**
   * 把刚拿到的位置存到当前选中的标点上。
   * 只更新经纬度，名称和备注原样带回，不会覆盖用户写的内容。
   */
  function handleSaveLocationToSpot() {
    if (!selectedSpot || !located) return
    // 旧的读数只能当参考，不许写进标点：标点位置是以后要照着找的地方
    if (locatedStale) {
      showToast('刚才那条定位已经过期了，先点「获取当前位置」重新定位再存')
      return
    }
    // IP 大致位置误差可能几公里，记成标点是害人
    if (locate.ipBased) {
      showToast('这是 IP 大致位置，不是设备定位，不能存成标点坐标')
      return
    }

    const result = trip.updateSpot(selectedSpot.id, {
      name: selectedSpot.name,
      note: selectedSpot.note,
      latitude: located.latitude,
      longitude: located.longitude,
      // 顺手把查到的地名留下来，标点名仍然是用户自己起的那个
      placeName: place.place?.name,
    })
    if (!result.ok) {
      showToast(result.error)
      return
    }
    showToast(`已把当前位置存到「${selectedSpot.name}」`)
  }

  function handleCreateSpot(draft: SpotDraft): string | null {
    const result = trip.addSpot(draft)
    if (!result.ok) return result.error

    // 新建完直接选中，少点一步
    setSpotId(result.value.id)
    showToast(`已新建标点「${result.value.name}」`)
    return null
  }

  function handleToggleGear(gearId: string) {
    setGearIds((current) =>
      current.includes(gearId)
        ? current.filter((id) => id !== gearId)
        : [...current, gearId],
    )
  }

  function handleBack() {
    if (step === 0) {
      onCancel()
      return
    }
    setError(null)
    setStep((current) => current - 1)
  }

  function handleStart() {
    if (!spotId || startingRef.current) return

    startingRef.current = true
    const result = trip.startTrip({ spotId, gearIds })
    if (!result.ok) {
      startingRef.current = false
      setError(result.error)
      showToast(result.error)
      return
    }
    onStarted(result.value, { recordTrack })
  }

  /** 已经有一场进行中的出勤时，不再让人误开第二场 */
  if (trip.activeSession) {
    return (
      <div className="start-trip">
        <TopBar title="开始出勤" onBack={onCancel} backLabel="返回" />
        <div className="start-trip__notice">
          <p className="start-trip__notice-text">
            已经有一场进行中的出勤了，同一时间只能有一场。
          </p>
          <button
            type="button"
            className="start-trip__notice-btn"
            onClick={onCancel}
          >
            回去看看那场出勤
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="start-trip">
      <TopBar
        title="开始出勤"
        subtitle={`第 ${step + 1} 步 / 共 ${STEPS.length} 步 · ${STEPS[step]}`}
        onBack={handleBack}
        backLabel={step === 0 ? '取消开始出勤' : '上一步'}
      />

      <ol className="start-trip__steps">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={`start-trip__step${index === step ? ' start-trip__step--current' : ''}${
              index < step ? ' start-trip__step--done' : ''
            }`}
          >
            <span className="start-trip__step-index">{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <div className="start-trip__body">
        {step === 0 && (
          <>
            <section className="start-trip__geo">
              <div className="geo-card">
                <div className="geo-card__head">
                  <div>
                    <h3 className="geo-card__title">
                      <LocateIcon size={17} />
                      当前位置
                    </h3>
                    <p className="geo-card__subtitle">
                      定位一次，可以顺手把坐标存到标点上
                    </p>
                  </div>
                  <span className={`geo-badge geo-badge--${locateBadge.tone}`}>
                    {locateBadge.label}
                  </span>
                </div>

                {located ? (
                  <>
                    <GeoRows
                      rows={[
                        placeRowItem(place),
                        {
                          label: locatedStale ? '上次定位坐标' : '当前坐标',
                          value: formatCoordinate(located.latitude, located.longitude),
                        },
                        { label: '定位精度', value: formatAccuracy(located.accuracy) },
                        {
                          label: locatedStale ? '上次定位时间' : '定位时间',
                          value: `${formatClockSec(located.recordedAt)}${
                            locatedStale ? ` · ${formatFixAge(located.recordedAt, now)}` : ''
                          }`,
                        },
                      ]}
                    />
                    <PlaceNote api={place} />

                    {locatedStale && (
                      <p className="geo-note geo-note--warn">
                        这是 {formatFixAge(located.recordedAt, now)}
                        拿到的位置，<strong>不是现在的位置</strong>
                        ，所以先不能存到标点上。点「获取当前位置」重新定位一次。
                      </p>
                    )}

                    {locate.ipBased && (
                      <p className="geo-note geo-note--warn">
                        高德这次没拿到设备定位，退回的是<strong>IP 大致位置</strong>
                        ，误差可能有好几公里，只能当参考。
                        它不能存到标点上——要记坐标请走到开阔处重新点一次「获取当前位置」。
                      </p>
                    )}
                  </>
                ) : lastFix ? (
                  <>
                    <GeoRows
                      rows={[
                        {
                          label: '上次定位坐标',
                          value: formatCoordinate(lastFix.latitude, lastFix.longitude),
                        },
                        { label: '上次定位精度', value: formatAccuracy(lastFix.accuracy) },
                        {
                          label: '上次定位时间',
                          value: `${formatClockSec(lastFix.recordedAt)} · ${formatFixAge(
                            lastFix.recordedAt,
                            now,
                          )}`,
                        },
                      ]}
                    />
                    <p className="geo-card__hint">
                      这是上一次成功定位的参考位置，<strong>不是现在的位置</strong>
                      。要存到标点上，先点「获取当前位置」。
                    </p>
                  </>
                ) : (
                  <p className="geo-card__hint">
                    {locate.status === 'locating'
                      ? locate.hint ?? '正在获取位置，请稍候…'
                      : '还没有定位。点下面的按钮获取当前位置，跳过也不影响开始出勤。'}
                  </p>
                )}

                {located && !selectedSpot && (
                  <p className="geo-card__hint">
                    先选一个标点，就能把当前位置存进去。
                  </p>
                )}

                {locate.status === 'locating' && located && locate.hint && (
                  <p className="geo-card__hint">{locate.hint}</p>
                )}

                {locate.error && (
                  <p className="geo-note geo-note--error">{locate.error}</p>
                )}

                <div className="geo-actions">
                  <button
                    type="button"
                    className="geo-btn geo-btn--primary"
                    onClick={locate.locate}
                    disabled={
                      locate.status === 'locating' || locate.status === 'unsupported'
                    }
                  >
                    <LocateIcon size={16} />
                    {locate.status === 'locating' ? '定位中…' : '获取当前位置'}
                  </button>

                  {located && selectedSpot && !locatedStale && !locate.ipBased && (
                    <button
                      type="button"
                      className="geo-btn"
                      onClick={handleSaveLocationToSpot}
                    >
                      保存到「{selectedSpot.name}」
                    </button>
                  )}
                </div>
              </div>
            </section>

            <SpotPicker
              spots={trip.spots}
              selectedId={spotId}
              location={located}
              place={place}
              onLocate={locate.locate}
              locating={locate.status === 'locating'}
              onSelect={setSpotId}
              onCreate={handleCreateSpot}
            />
          </>
        )}

        {step === 1 && (
          <>
            <p className="start-trip__hint">
              这次带出去的装备，鱼竿、渔轮、拟饵、周边都能多选；不选也没关系。
            </p>
            <GearPickerList
              items={gear.items}
              imageUrls={images.images}
              selectedIds={gearIds}
              onToggle={handleToggleGear}
              emptyText="装备库还是空的，先跳过这一步也可以"
            />
          </>
        )}

        {step === 2 && (
          <div className="start-trip__summary">
            <div className="start-trip__summary-row">
              <span className="start-trip__summary-label">标点</span>
              <span className="start-trip__summary-value">
                {selectedSpot?.name ?? '未选择'}
              </span>
            </div>

            <div className="start-trip__summary-row start-trip__summary-row--stacked">
              <span className="start-trip__summary-label">出勤装备</span>
              {gearIds.length > 0 ? (
                <ul className="start-trip__gear-list">
                  {resolveSessionGear(gear.items, gearIds).map((ref) => (
                    <li className="start-trip__gear" key={ref.id}>
                      <span className="start-trip__gear-name">{ref.name}</span>
                      {ref.brand && (
                        <span className="start-trip__gear-brand">{ref.brand}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="start-trip__summary-value start-trip__summary-value--muted">
                  这次不带装备
                </span>
              )}
            </div>

            <label className="start-trip__track" htmlFor="start-track-switch">
              <span className="start-trip__track-text">
                记录 GPS 轨迹
                <em>出勤期间持续记录位置，出勤页可以随时暂停</em>
              </span>
              <ToggleSwitch
                id="start-track-switch"
                checked={recordTrack}
                onChange={setRecordTrack}
                label="出勤期间记录 GPS 轨迹"
              />
            </label>

            <p className="start-trip__hint">
              开始后可以一键上鱼，也随时能增减本次携带的装备。
              记录轨迹需要浏览器定位权限，不授权也能照常出勤，只是没有轨迹和距离。
            </p>

            {error && <p className="start-trip__error" role="alert">{error}</p>}
          </div>
        )}
      </div>

      <div className="start-trip__foot">
        {step === 0 && (
          <button
            type="button"
            className="start-trip__next"
            disabled={!spotId}
            onClick={() => setStep(1)}
          >
            {spotId ? '下一步：选装备' : '请先选择一个标点'}
          </button>
        )}

        {step === 1 && (
          <>
            <button
              type="button"
              className="start-trip__skip"
              onClick={() => setStep(2)}
            >
              跳过装备选择
            </button>
            <button
              type="button"
              className="start-trip__next"
              onClick={() => setStep(2)}
            >
              {gearIds.length > 0
                ? `下一步：已选 ${gearIds.length} 件`
                : '下一步'}
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <button
              type="button"
              className="start-trip__skip"
              onClick={() => setStep(1)}
            >
              返回修改
            </button>
            <button
              type="button"
              className="start-trip__next"
              onClick={handleStart}
            >
              <PlayIcon size={18} />
              开始出勤
            </button>
          </>
        )}
      </div>

      <Toast message={message} />
    </div>
  )
}
