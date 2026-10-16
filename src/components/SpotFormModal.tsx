import { useState, type FormEvent } from 'react'
import MapPicker from './MapPicker'
import Modal from './Modal'
import { CloseIcon, LocateIcon, MapIcon } from './icons'
import { useNow } from '../hooks/useNow'
import { PLACE_ATTRIBUTION, PLACE_ATTRIBUTION_URL } from '../lib/amap/geocode'
import { formatAccuracy, formatCoordinate, formatFixAge, isFixFresh } from '../lib/geo'
import type { PlaceName } from '../lib/amap/geocode'
import type { LiveGeoPoint, Spot, SpotDraft } from '../types/trip'
import type { PlaceStatus } from '../hooks/usePlaceName'
import './SpotFormModal.css'

const FORM_ID = 'spot-form'

/**
 * 标点位置从哪来。
 * - `keep`   保持标点上原来记的位置（只有编辑已有位置的标点才有这个选项）
 * - `current` 用当前 GPS 定位
 * - `map`    在地图上选点 / 搜索地点
 * - `none`   不记位置
 */
type SpotLocationChoice = 'keep' | 'current' | 'map' | 'none'

/** 地图上选出来的位置。坐标已经是 WGS84，可以跟定位坐标直接比、直接存 */
interface PickedLocation {
  latitude: number
  longitude: number
  /** 选点这一带查到的地名；查不到就是空串，绝不拿坐标编一个 */
  name: string
}

interface SpotFormModalProps {
  /** 传入标点表示编辑，否则为新建 */
  initial?: Spot | null
  /**
   * 手上已有的当前位置读数。传了就可以选「使用当前位置」，
   * 不传（或还没定位）时这个选项是灰的；IP 大致位置也是灰的。
   */
  location?: LiveGeoPoint | null
  /** 这个位置查到的地名，用来给名称输入框填个默认值 */
  place?: PlaceName | null
  placeStatus?: PlaceStatus
  /** 在这个弹窗里直接触发一次定位（页面没提供就不显示这个按钮） */
  onLocate?: (() => void) | null
  locating?: boolean
  onCancel: () => void
  /**
   * 提交。返回错误文案表示失败（弹窗保持打开并显示原因），
   * 返回 null 表示成功（弹窗自己关掉）。
   */
  onSubmit: (draft: SpotDraft) => string | null
}

/** 新建 / 编辑标点。表单样式沿用装备表单的 .form__* 类 */
export default function SpotFormModal({
  initial = null,
  location = null,
  place = null,
  placeStatus = 'idle',
  onLocate = null,
  locating = false,
  onCancel,
  onSubmit,
}: SpotFormModalProps) {
  const isEditing = initial !== null
  const hasLocation = location !== null

  /*
   * 手上这条读数还新不新。旧了就不许再拿它当「当前位置」存进标点——
   * 标点位置是以后要照着找的地方，不能拿一条十分钟前的读数凑数。
   * 高德退回的 IP 大致位置同样不许：它离你可能有几公里。
   */
  const now = useNow(10_000)
  const locationStale = location !== null && !isFixFresh(location.recordedAt, now)
  const locationIsIp = location !== null && location.source === 'ip'
  const usableLocation = hasLocation && !locationStale && !locationIsIp

  /** 编辑时标点上原本记着的位置 */
  const existing =
    initial && typeof initial.latitude === 'number' && typeof initial.longitude === 'number'
      ? { latitude: initial.latitude, longitude: initial.longitude }
      : null

  /** 没有位置可选时才默认「不记录位置」，有定位就默认用当前位置 */
  const [source, setSource] = useState<SpotLocationChoice>(
    existing ? 'keep' : usableLocation ? 'current' : 'none',
  )
  const [picked, setPicked] = useState<PickedLocation | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  /*
   * 名称输入框里的内容：
   * typedName 为 null 表示用户还没动过，这时显示查到的地名当默认值；
   * 只要用户敲过字，就以用户写的为准 —— 自动填的地名不会再把他的输入顶掉。
   */
  const [typedName, setTypedName] = useState<string | null>(initial?.name ?? null)
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState<string | null>(null)

  /*
   * 自动填的名字跟着「用户选的位置」走：地图选点用地图查到的地名，
   * 用当前位置才用定位那一次查到的地名。两者不会串味。
   */
  const autoName = source === 'map' ? (picked?.name ?? '') : source === 'current' ? (place?.name ?? '') : ''
  const name = typedName ?? autoName
  /** 名称输入框里显示的是高德查来的地名，按署名要求把出处挂出来 */
  const showingAmapName = autoName !== '' && typedName === null

  /** 最终要写进标点的位置；null 表示这次不动位置 */
  function readChosen(): PickedLocation | null {
    if (source === 'current' && location && !locationStale && !locationIsIp) {
      return {
        latitude: location.latitude,
        longitude: location.longitude,
        name: place?.name ?? '',
      }
    }
    if (source === 'map' && picked) return picked
    return null
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('请先填写标点名称')
      return
    }
    if (source === 'map' && !picked) {
      setError('还没在地图上选位置。点「打开地图」选一个，或者把位置改成「不记录位置」。')
      return
    }
    if (source === 'current' && !usableLocation) {
      setError(
        locationIsIp
          ? '手上这条是高德返回的 IP 大致位置，误差可能有几公里，不能当标点坐标。请重新定位，或者改成「在地图上选点」。'
          : locationStale && location
            ? `手上这条定位是 ${formatFixAge(location.recordedAt, now)} 的读数，已经不能当当前位置用了。先重新定位，或者改成「在地图上选点」。`
            : '现在没有可用的定位。先获取一次位置，或者改成「在地图上选点」。',
      )
      return
    }

    const chosen = readChosen()
    const draft: SpotDraft = { name: trimmedName, note: note.trim() }
    if (chosen) {
      draft.latitude = chosen.latitude
      draft.longitude = chosen.longitude
      // 没查到地名就不带地名，免得标点上挂着一个跟坐标无关的名字
      if (chosen.name) draft.placeName = chosen.name
    }

    const failure = onSubmit(draft)
    if (failure) setError(failure)
  }

  const sources: { value: SpotLocationChoice; title: string; hint: string; disabled?: boolean }[] = [
    ...(existing
      ? [
          {
            value: 'keep' as const,
            title: '保留原有位置',
            hint: formatCoordinate(existing.latitude, existing.longitude),
          },
        ]
      : []),
    {
      value: 'current',
      title: '使用当前位置',
      hint: !hasLocation
        ? locating
          ? '正在定位…'
          : '还没有定位'
        : locationIsIp
          ? `${formatCoordinate(location.latitude, location.longitude)} · 这是高德返回的 IP 大致位置，误差可能几公里，不能存成标点`
          : locationStale
            ? `${formatCoordinate(location.latitude, location.longitude)} · 这是 ${formatFixAge(
                location.recordedAt,
                now,
              )} 的读数，不是现在的位置`
            : `${formatCoordinate(location.latitude, location.longitude)} · 精度 ${formatAccuracy(
                location.accuracy,
              )}`,
      // 过期的读数、IP 大致位置都只能当参考：不许拿它们当标点位置存下去
      disabled: !usableLocation,
    },
    {
      value: 'map',
      title: '在地图上选点',
      hint: picked
        ? `${picked.name || '这一带没查到地名'} · ${formatCoordinate(picked.latitude, picked.longitude)}`
        : '点地图选，或者搜索水库、公园等地名',
    },
    {
      value: 'none',
      title: '不记录位置',
      hint: '只记名字，不影响出勤',
    },
  ]

  return (
    <Modal
      title={isEditing ? '编辑标点' : '新建标点'}
      subtitle={isEditing ? '改完点保存即可' : '记下常去的地方，出勤时直接选'}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            取消
          </button>
          <button type="submit" form={FORM_ID} className="btn btn--primary">
            {isEditing ? '保存修改' : '创建标点'}
          </button>
        </>
      }
    >
      <form id={FORM_ID} className="form" onSubmit={handleSubmit} noValidate>
        <div className="form__row">
          <label className="form__label" htmlFor="spot-name">
            标点名称<span className="form__required">*</span>
          </label>
          <input
            id="spot-name"
            className="form__input"
            value={name}
            onChange={(event) => {
              setTypedName(event.target.value)
              if (error) setError(null)
            }}
            placeholder="例如 老桥墩东侧"
            autoComplete="off"
          />

          {placeStatus === 'loading' && source === 'current' && (
            <p className="spot-form__hint">
              正在根据坐标查这一带的地名，查到会自动填进名称里…
            </p>
          )}

          {showingAmapName && (
            <p className="spot-form__hint">
              这是根据位置自动填的地名，可以改成自己的叫法，比如「水库北岸」。
            </p>
          )}
        </div>

        <div className="form__row">
          <label className="form__label" htmlFor="spot-note">
            备注<em>选填</em>
          </label>
          <textarea
            id="spot-note"
            className="form__textarea"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="水位、目标鱼、停车位置…"
            rows={3}
          />
        </div>

        <fieldset className="spot-form__sources">
          <legend className="form__label">
            标点位置<em>选填</em>
          </legend>

          {sources.map((option) => (
            <label
              key={option.value}
              className={`spot-form__source${
                source === option.value ? ' spot-form__source--active' : ''
              }${option.disabled ? ' spot-form__source--disabled' : ''}`}
            >
              <input
                type="radio"
                name="spot-location-source"
                className="spot-form__radio"
                value={option.value}
                checked={source === option.value}
                disabled={option.disabled}
                onChange={() => {
                  setSource(option.value)
                  setError(null)
                  if (option.value === 'map' && !picked) setPickerOpen(true)
                }}
              />
              <span className="spot-form__source-icon" aria-hidden="true">
                {option.value === 'map' ? <MapIcon size={17} /> : <LocateIcon size={17} />}
              </span>
              <span className="spot-form__source-body">
                <span className="spot-form__source-title">{option.title}</span>
                <span className="spot-form__source-hint">{option.hint}</span>
              </span>
            </label>
          ))}

          {source === 'current' && !hasLocation && onLocate && (
            <button
              type="button"
              className="spot-form__locate"
              onClick={onLocate}
              disabled={locating}
            >
              <LocateIcon size={16} />
              {locating ? '定位中…' : '获取当前位置'}
            </button>
          )}

          {source === 'map' && (
            <button
              type="button"
              className="spot-form__locate"
              onClick={() => setPickerOpen(true)}
            >
              <MapIcon size={16} />
              {picked ? '重新选点' : '打开地图选点'}
            </button>
          )}

          {existing && source !== 'keep' && (
            <p className="spot-form__hint">
              选「使用当前位置」或「在地图上选点」会替换掉标点上原来的位置。
              只想改名字的话，选「保留原有位置」。
            </p>
          )}
        </fieldset>

        <p className="spot-form__hint">
          标点位置只是标记这是哪片水域，上鱼位置仍然是上鱼那一刻单独定位记录下来的。
          标点可以反复使用，一场出勤引用一个标点；不记位置也不影响出勤。
        </p>

        {showingAmapName && (
          <p className="spot-form__hint">
            <a
              className="geo-note__link"
              href={PLACE_ATTRIBUTION_URL}
              target="_blank"
              rel="noreferrer"
            >
              {PLACE_ATTRIBUTION}
            </a>
          </p>
        )}

        {error && (
          <p className="form__error" role="alert">
            <CloseIcon size={14} />
            {error}
          </p>
        )}
      </form>

      {pickerOpen && (
        <MapPicker
          initial={
            picked
              ? { latitude: picked.latitude, longitude: picked.longitude }
              : (existing ?? (source === 'current' && usableLocation && location ? location : null))
          }
          initialName={picked?.name || initial?.placeName || (usableLocation ? place?.name : '') || null}
          onCancel={() => setPickerOpen(false)}
          onConfirm={(result) => {
            setPicked(result)
            setSource('map')
            setPickerOpen(false)
            setError(null)
          }}
        />
      )}
    </Modal>
  )
}
