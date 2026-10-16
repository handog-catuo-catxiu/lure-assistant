import { useState } from 'react'
import SpotFormModal from './SpotFormModal'
import { CheckIcon, LocateIcon, PinIcon, PlusIcon } from './icons'
import { formatCoordinateShort } from '../lib/geo'
import { formatDate } from '../lib/tripFormat'
import type { LiveGeoPoint, Spot, SpotDraft } from '../types/trip'
import type { PlaceNameApi } from '../hooks/usePlaceName'
import './SpotPicker.css'

interface SpotPickerProps {
  spots: Spot[]
  selectedId: string | null
  /** 手上已有的定位读数，用来在新标点上顺手记下坐标（IP 大致位置会被挡掉） */
  location?: LiveGeoPoint | null
  /** 这个坐标解析出来的地名，用来给新标点起个默认名字 */
  place?: PlaceNameApi | null
  /** 在新标点表单里直接触发一次定位（页面没提供就不显示） */
  onLocate?: (() => void) | null
  locating?: boolean
  onSelect: (spotId: string) => void
  /** 新建标点，返回错误文案；成功时由调用方负责把新标点选上 */
  onCreate: (draft: SpotDraft) => string | null
}

/** 从已保存的标点里选一个，也可以就地新建一个 */
export default function SpotPicker({
  spots,
  selectedId,
  location = null,
  place = null,
  onLocate = null,
  locating = false,
  onSelect,
  onCreate,
}: SpotPickerProps) {
  const [creating, setCreating] = useState(false)

  function handleCreate(draft: SpotDraft): string | null {
    const failure = onCreate(draft)
    if (failure) return failure
    setCreating(false)
    return null
  }

  return (
    <div className="spot-picker">
      <div className="spot-picker__head">
        <h2 className="spot-picker__heading">选择标点</h2>
        <button
          type="button"
          className="spot-picker__add"
          onClick={() => setCreating(true)}
        >
          <PlusIcon size={16} />
          新建标点
        </button>
      </div>

      {spots.length > 0 ? (
        <ul className="spot-picker__list">
          {spots.map((spot) => {
            const active = spot.id === selectedId
            return (
              <li key={spot.id}>
                <button
                  type="button"
                  className={`spot-option${active ? ' spot-option--active' : ''}`}
                  aria-pressed={active}
                  onClick={() => onSelect(spot.id)}
                >
                  <span className="spot-option__icon" aria-hidden="true">
                    <PinIcon size={18} />
                  </span>

                  <span className="spot-option__body">
                    <span className="spot-option__name">{spot.name}</span>
                    {spot.note && (
                      <span className="spot-option__note">{spot.note}</span>
                    )}
                    <span className="spot-option__date">
                      建于 {formatDate(spot.createdAt)}
                    </span>
                    {/* 有地名就显示地名，没有才退回坐标 */}
                    {spot.placeName ? (
                      <span className="spot-option__geo">
                        <LocateIcon size={12} />
                        {spot.placeName}
                      </span>
                    ) : (
                      spot.latitude !== undefined &&
                      spot.longitude !== undefined && (
                        <span className="spot-option__geo">
                          <LocateIcon size={12} />
                          {formatCoordinateShort(spot.latitude, spot.longitude)}
                        </span>
                      )
                    )}
                  </span>

                  <span className="spot-option__check" aria-hidden="true">
                    {active && <CheckIcon size={16} />}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="spot-picker__empty">
          <span className="spot-picker__empty-icon" aria-hidden="true">
            <PinIcon size={22} />
          </span>
          <p className="spot-picker__empty-text">
            还没有标点，先新建一个再去出勤吧
          </p>
          <p className="spot-picker__empty-hint">
            标点就是常去的地方，之后每次出勤都能直接选
          </p>
        </div>
      )}

      {creating && (
        <SpotFormModal
          location={location}
          place={place?.place ?? null}
          placeStatus={place?.status ?? 'idle'}
          onLocate={onLocate}
          locating={locating}
          onCancel={() => setCreating(false)}
          onSubmit={handleCreate}
        />
      )}
    </div>
  )
}
