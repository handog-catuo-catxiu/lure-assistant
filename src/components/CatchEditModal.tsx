import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import CatchPhoto from './CatchPhoto'
import Modal from './Modal'
import ToggleSwitch from './ToggleSwitch'
import { CloseIcon, LocateIcon } from './icons'
import {
  formatAccuracy,
  formatCoordinate,
  isLocationUsableForCatch,
} from '../lib/geo'
import { toImageErrorMessage, validateImageFile } from '../lib/imageStore'
import { formatClockSec, formatDate } from '../lib/tripFormat'
import { parsePositiveNumber } from '../lib/tripService'
import { CATEGORY_META } from '../types/gear'
import {
  CATCH_GEAR_CATEGORIES,
  MAX_LENGTH_CM,
  MAX_WEIGHT_G,
  type CatchGearCategory,
  type CatchRecord,
  type CatchSavePayload,
  type GeoPoint,
  type LiveGeoPoint,
  type TripSession,
} from '../types/trip'
import type { GearItem } from '../types/gear'
import './CatchEditModal.css'

const FORM_ID = 'catch-form'

interface CatchEditModalProps {
  record: CatchRecord
  /** 所属出勤。进行中时优先显示本次携带的装备 */
  session: TripSession | null
  gearItems: GearItem[]
  /** 已有照片的地址 */
  photoUrl: string | null
  /** 当前最新的定位读数，用来给这条渔获补位置 */
  currentLocation?: LiveGeoPoint | null
  onClose: () => void
  /** 返回错误文案表示保存失败（弹窗保持打开），返回 null 表示成功 */
  onSave: (payload: CatchSavePayload) => string | null
}

/**
 * 完善 / 编辑渔获。
 *
 * 打开的这一刻渔获早就已经保存好了，这里填的全是选填内容，
 * 直接关掉不会丢数据。
 */
export default function CatchEditModal({
  record,
  session,
  gearItems,
  photoUrl,
  currentLocation = null,
  onClose,
  onSave,
}: CatchEditModalProps) {
  // 刚点完一键上鱼、什么都还没填的渔获，标题说「完善」更贴切
  const isNew =
    !record.species &&
    !record.note &&
    record.lengthCm === null &&
    record.weightG === null &&
    !record.rodId &&
    !record.reelId &&
    !record.lureId &&
    !photoUrl

  const [species, setSpecies] = useState(record.species)
  const [length, setLength] = useState(
    record.lengthCm !== null ? String(record.lengthCm) : '',
  )
  const [weight, setWeight] = useState(
    record.weightG !== null ? String(record.weightG) : '',
  )
  const [gearPick, setGearPick] = useState<Record<CatchGearCategory, string | null>>({
    rod: record.rodId,
    reel: record.reelId,
    lure: record.lureId,
  })
  const [note, setNote] = useState(record.note)
  const [showAllGear, setShowAllGear] = useState(false)
  const [addToTrip, setAddToTrip] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * 上鱼位置的三态：保持不动 / 清除 / 换成当前定位。
   * 位置只在上鱼那一刻真的拿到过定位才会存在，这里不会用标点坐标顶替。
   */
  const [locationChoice, setLocationChoice] = useState<'keep' | 'clear' | 'set'>('keep')

  /** 这条渔获原本记下的位置（老记录可能没有） */
  const recordedLocation: GeoPoint | null =
    record.latitude !== undefined && record.longitude !== undefined
      ? {
          latitude: record.latitude,
          longitude: record.longitude,
          accuracy: record.locationAccuracy ?? Number.NaN,
          recordedAt: record.locationRecordedAt ?? record.caughtAt,
        }
      : null

  const shownLocation =
    locationChoice === 'clear'
      ? null
      : locationChoice === 'set'
        ? currentLocation
        : recordedLocation

  // 照片改动只在弹窗里暂存，保存时才写进 IndexedDB
  const [pickedFile, setPickedFile] = useState<File | null>(null)
  const [pickedPreviewUrl, setPickedPreviewUrl] = useState<string | null>(null)
  const [photoRemoved, setPhotoRemoved] = useState(false)
  const previewUrlRef = useRef<string | null>(null)

  // 只释放本组件自己创建的地址，父组件传进来的地址由父组件管理
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    },
    [],
  )

  const carriedIds = useMemo(
    () => new Set(session?.gearIds ?? []),
    [session],
  )

  /** 三个分类的装备候选：本次携带的（情况 A）或整个装备库（情况 B） */
  const gearOptions = CATCH_GEAR_CATEGORIES.map((category) => {
    const all = gearItems.filter((item) => item.category === category)
    const carried = all.filter((item) => carriedIds.has(item.id))
    // 出勤时跳过了装备选择（或这个分类没带），就直接给整个装备库
    const expanded = showAllGear || carried.length === 0

    const current = gearPick[category]
    let listed = expanded ? all : carried
    // 已经选中的装备在收起后也要看得见，不然会以为没选上
    if (current && !listed.some((item) => item.id === current)) {
      listed = [...all.filter((item) => item.id === current), ...listed]
    }

    return { category, all, carried, listed, expanded }
  })

  const pickedIds = CATCH_GEAR_CATEGORIES.map((category) => gearPick[category]).filter(
    (id): id is string => id !== null,
  )
  const newGearIds = pickedIds.filter((id) => !carriedIds.has(id))
  // 只有出勤还在进行中才有「加入本次出勤装备」这回事，并且必须由用户主动勾选
  const canAddToTrip = session?.status === 'active' && newGearIds.length > 0

  const previewUrl =
    pickedPreviewUrl ?? (photoRemoved ? null : photoUrl ?? null)

  function handlePickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // 清空 value，否则连续选同一张图不会再触发 change
    event.target.value = ''
    if (!file) return

    try {
      validateImageFile(file)
    } catch (err) {
      setError(toImageErrorMessage(err))
      return
    }

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    const url = URL.createObjectURL(file)
    previewUrlRef.current = url

    setPickedFile(file)
    setPickedPreviewUrl(url)
    setPhotoRemoved(false)
    setError(null)
  }

  function handleRemovePhoto() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    setPickedFile(null)
    setPickedPreviewUrl(null)
    setError(null)
    // 只有本来就存在照片时才需要通知外部删除
    setPhotoRemoved(Boolean(photoUrl))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const lengthResult = parsePositiveNumber(length, MAX_LENGTH_CM)
    if (!lengthResult.ok) {
      setError(`长度请填 0 以上的数字，最大 ${MAX_LENGTH_CM} cm`)
      return
    }

    const weightResult = parsePositiveNumber(weight, MAX_WEIGHT_G)
    if (!weightResult.ok) {
      setError(`重量请填 0 以上的数字，最大 ${MAX_WEIGHT_G} g`)
      return
    }

    /*
     * 位置只在用户主动改的时候才动：
     * 保持 → 不带 location；清除 → null；用当前位置 → 那一刻的读数。
     * 读数是否够新鲜在点击的这一刻判断，过期就如实说，不硬写。
     */
    let location: GeoPoint | null | undefined
    if (locationChoice === 'clear') {
      location = null
    } else if (locationChoice === 'set') {
      if (!currentLocation || !isLocationUsableForCatch(currentLocation)) {
        setError(
          currentLocation?.source === 'ip'
            ? '现在手上是高德返回的 IP 大致位置（误差可能几公里），不能当上鱼位置。点「刷新定位」拿到设备定位后再试'
            : '刚才那次定位已经过期了，点「刷新定位」拿到新位置后再试',
        )
        return
      }
      location = currentLocation
    }

    const photo: { file?: File; remove?: boolean } = {}
    if (pickedFile) photo.file = pickedFile
    else if (photoRemoved) photo.remove = true

    const failure = onSave({
      draft: {
        species: species.trim(),
        lengthCm: lengthResult.value,
        weightG: weightResult.value,
        rodId: gearPick.rod,
        reelId: gearPick.reel,
        lureId: gearPick.lure,
        note: note.trim(),
        location,
      },
      photo,
      addGearIds: canAddToTrip && addToTrip ? newGearIds : [],
    })

    if (failure) {
      setError(failure)
      return
    }
    onClose()
  }

  return (
    <Modal
      title={isNew ? '完善渔获' : '编辑渔获'}
      subtitle={
        isNew
          ? '这条鱼已经记下了，下面这些都可以慢慢填'
          : '改完点保存即可，留空的部分会显示成未填写'
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" form={FORM_ID} className="btn btn--primary">
            保存
          </button>
        </>
      }
    >
      <form id={FORM_ID} className="form" onSubmit={handleSubmit} noValidate>
        <p className="catch-edit__time">
          上鱼时间：{formatDate(record.caughtAt)} {formatClockSec(record.caughtAt)}
          {session && <span className="catch-edit__spot"> · {session.spotName}</span>}
        </p>

        <div className="form__row">
          <span className="form__label">
            上鱼位置<em>选填</em>
          </span>

          {shownLocation ? (
            <>
              <p className="catch-edit__geo">
                <LocateIcon size={13} />
                {formatCoordinate(shownLocation.latitude, shownLocation.longitude)}
              </p>
              <p className="catch-edit__geo-hint">
                {formatAccuracy(shownLocation.accuracy)} · 记录于{' '}
                {formatClockSec(shownLocation.recordedAt)}
                {locationChoice === 'set' && ' · 保存后换成这个位置'}
              </p>
            </>
          ) : locationChoice === 'clear' ? (
            <p className="catch-edit__geo-hint">保存后会清除这条渔获的位置。</p>
          ) : (
            <p className="catch-edit__geo-hint">
              这条渔获没有位置。位置是上鱼那一刻单独定位记下来的，
              没记到就留空，不会拿标点的坐标来充数。
            </p>
          )}

          <div className="catch-edit__geo-actions">
            {/* IP 大致位置不能当上鱼位置，索性不提供这个按钮 */}
            {currentLocation && currentLocation.source === 'device' && locationChoice !== 'set' && (
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setLocationChoice('set')
                  setError(null)
                }}
              >
                {shownLocation ? '用当前位置替换' : '用当前位置补上'}
              </button>
            )}

            {shownLocation && locationChoice !== 'clear' && (
              <button
                type="button"
                className="link-btn link-btn--danger"
                onClick={() => setLocationChoice('clear')}
              >
                清除位置
              </button>
            )}

            {locationChoice !== 'keep' && (
              <button
                type="button"
                className="link-btn"
                onClick={() => setLocationChoice('keep')}
              >
                撤销改动
              </button>
            )}
          </div>

          {currentLocation && !shownLocation && (
            <p className="catch-edit__geo-hint">
              最近一次定位：{formatCoordinate(currentLocation.latitude, currentLocation.longitude)}
              （{formatAccuracy(currentLocation.accuracy)}）
              {currentLocation.source === 'ip' && ' · 这是 IP 大致位置，不能当上鱼位置'}
            </p>
          )}
        </div>

        <div className="form__row">
          <span className="form__label">渔获照片<em>选填</em></span>

          <CatchPhoto
            url={previewUrl}
            variant="cover"
            alt={species.trim() ? `${species.trim()} 的照片` : '渔获照片'}
          />

          <div className="photo-actions">
            <label className="photo-btn">
              {previewUrl ? '替换照片' : '拍照 / 选择照片'}
              <input
                className="photo-btn__input"
                type="file"
                accept="image/*"
                onChange={handlePickFile}
              />
            </label>

            {previewUrl && (
              <button
                type="button"
                className="photo-btn photo-btn--danger"
                onClick={handleRemovePhoto}
              >
                删除照片
              </button>
            )}
          </div>

          <p className="photo-hint">
            支持 JPG / PNG / WebP，单张不超过 5MB；照片保存在本机浏览器里
          </p>
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor="catch-species">
            鱼种<em>选填</em>
          </label>
          <input
            id="catch-species"
            className="form__input"
            value={species}
            onChange={(event) => setSpecies(event.target.value)}
            placeholder="例如 翘嘴、鳜鱼、黑鱼"
            autoComplete="off"
          />
        </div>

        <div className="form__row">
          <span className="form__label">尺寸<em>选填</em></span>
          <div className="form__grid2">
            <div className="form__sub-field">
              <label className="form__sub-label" htmlFor="catch-length">
                长度（cm）
              </label>
              <input
                id="catch-length"
                className="form__input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={length}
                onChange={(event) => {
                  setLength(event.target.value)
                  if (error) setError(null)
                }}
                placeholder="例如 38"
              />
            </div>
            <div className="form__sub-field">
              <label className="form__sub-label" htmlFor="catch-weight">
                重量（g）
              </label>
              <input
                id="catch-weight"
                className="form__input"
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={weight}
                onChange={(event) => {
                  setWeight(event.target.value)
                  if (error) setError(null)
                }}
                placeholder="例如 850"
              />
            </div>
          </div>
        </div>

        <div className="form__row">
          <span className="form__label">
            实际使用的装备<em>选填 · 和出勤装备是两回事</em>
          </span>

          {gearOptions.map(({ category, all, carried, listed, expanded }) => (
            <div className="catch-gear" key={category}>
              <div className="catch-gear__head">
                <span className="catch-gear__label">
                  {CATEGORY_META[category].label}
                </span>
                <span className="catch-gear__source">
                  {expanded ? '装备库' : '本次携带'}
                </span>
              </div>

              {listed.length > 0 ? (
                <div className="catch-gear__chips">
                  {listed.map((item) => {
                    const active = gearPick[category] === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`gear-chip${active ? ' gear-chip--active' : ''}`}
                        aria-pressed={active}
                        onClick={() =>
                          setGearPick((prev) => ({
                            ...prev,
                            [category]: active ? null : item.id,
                          }))
                        }
                      >
                        {item.name}
                        {carriedIds.has(item.id) && (
                          <span className="gear-chip__tag">携带</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="catch-gear__empty">
                  装备库里还没有{CATEGORY_META[category].label}
                </p>
              )}

              {carried.length > 0 && all.length > carried.length && (
                <button
                  type="button"
                  className="link-btn catch-gear__more"
                  onClick={() => setShowAllGear((value) => !value)}
                >
                  {showAllGear
                    ? '只看本次携带的装备'
                    : `展开全部装备库（${all.length} 件）`}
                </button>
              )}
            </div>
          ))}
        </div>

        {canAddToTrip && (
          <label className="form__switch-row" htmlFor="catch-add-gear">
            <span className="form__switch-text">
              把所选装备加入本次出勤装备
              <em>共 {newGearIds.length} 件不在本次携带清单里，勾选后一并加进去</em>
            </span>
            <ToggleSwitch
              id="catch-add-gear"
              checked={addToTrip}
              onChange={setAddToTrip}
              label="把所选装备加入本次出勤装备"
            />
          </label>
        )}

        <div className="form__row">
          <label className="form__label" htmlFor="catch-note">
            备注<em>选填</em>
          </label>
          <textarea
            id="catch-note"
            className="form__textarea"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="水层、手法、咬口情况…"
            rows={3}
          />
        </div>

        {error && (
          <p className="form__error" role="alert">
            <CloseIcon size={14} />
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
