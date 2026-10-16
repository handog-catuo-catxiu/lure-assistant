import { useState } from 'react'
import ConfirmDialog from '../components/ConfirmDialog'
import { GeoRows } from '../components/GeoStatusPanel'
import PageHeader from '../components/PageHeader'
import PlaceNote from '../components/PlaceNameInfo'
import SpotFormModal from '../components/SpotFormModal'
import Toast from '../components/Toast'
import TripMap from '../components/TripMap'
import { LocateIcon, PinIcon, PlusIcon } from '../components/icons'
import { useCurrentLocation } from '../hooks/useGeolocation'
import { useLastFix } from '../hooks/useLastFix'
import { useNow } from '../hooks/useNow'
import { usePlaceName } from '../hooks/usePlaceName'
import { useToast } from '../hooks/useToast'
import {
  formatAccuracy,
  formatCoordinate,
  formatCoordinateShort,
  formatFixAge,
  hasCoordinates,
  isFixFresh,
} from '../lib/geo'
import { placeRowItem } from '../lib/placeFormat'
import { formatClockSec, formatDate } from '../lib/tripFormat'
import type { TripApi } from '../hooks/useTrip'
import type { Spot, SpotDraft } from '../types/trip'
import './SpotPage.css'

interface SpotPageProps {
  trip: TripApi
}

/** 标点管理：新增、编辑、删除。标点可以反复使用，与出勤是两份独立数据 */
export default function SpotPage({ trip }: SpotPageProps) {
  const { message, showToast } = useToast()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Spot | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Spot | null>(null)

  // 一次性定位：先拿到位置，新建标点时就可以顺手记下坐标
  const locate = useCurrentLocation()

  // 只有点了「获取当前位置」才会查一次地名，标点列表不会触发任何查询
  const place = usePlaceName(locate.position)

  // 没有定位时给一个「上次在哪儿」的参考，界面上会写明这不是当前位置
  const lastFix = useLastFix()

  /*
   * 手上这条读数是不是已经旧了（这次没定位成功，或者读数超过一分钟）。
   * 旧了就改口叫「上次定位」，并且不让它冒充当前位置。
   */
  const now = useNow(10_000)
  const positionStale =
    locate.position !== null &&
    (locate.stale || !isFixFresh(locate.position.recordedAt, now))

  const totalTrips = trip.sessions.length

  function handleOpenAdd() {
    setEditing(null)
    setFormOpen(true)
  }

  function handleOpenEdit(spot: Spot) {
    setEditing(spot)
    setFormOpen(true)
  }

  function handleSubmit(draft: SpotDraft): string | null {
    const result = editing ? trip.updateSpot(editing.id, draft) : trip.addSpot(draft)
    if (!result.ok) return result.error

    const name = draft.name.trim()
    showToast(editing ? `已更新「${name}」` : `已新建「${name}」`)
    setFormOpen(false)
    setEditing(null)
    return null
  }

  function handleConfirmDelete() {
    if (!pendingDelete) return

    const target = pendingDelete
    setPendingDelete(null)

    const result = trip.removeSpot(target.id)
    if (!result.ok) {
      showToast(result.error)
      return
    }
    showToast(`已删除「${target.name}」`)
  }

  const deleteUsage = pendingDelete ? trip.tripCountOfSpot(pendingDelete.id) : 0

  return (
    <div className="spot-page">
      <PageHeader title="钓点" subtitle="常去的地方记下来，出勤时直接选">
        <div className="page-header__stats">
          <div className="page-header__stat">
            <strong>{trip.spots.length}</strong>
            <span>标点</span>
          </div>
          <div className="page-header__divider" />
          <div className="page-header__stat">
            <strong>{totalTrips}</strong>
            <span>累计出勤</span>
          </div>
        </div>
      </PageHeader>

      <section className="spot-page__section">
        <button type="button" className="add-button" onClick={handleOpenAdd}>
          <PlusIcon size={20} />
          新建标点
        </button>
      </section>

      {/*
        标点位置是选填的：想记就点一下定位，不想记也不影响标点和出勤。
        这里拿到的位置只用来填进「新建 / 编辑标点」表单，不会自动写进任何标点。
      */}
      <section className="spot-page__section">
        <div className="geo-card">
          <div className="geo-card__head">
            <div>
              <h3 className="geo-card__title">
                <LocateIcon size={17} />
                当前位置
              </h3>
              <p className="geo-card__subtitle">新建标点时可以顺手把坐标记下来</p>
            </div>
            <span
              className={`geo-badge geo-badge--${
                locate.status === 'locating'
                  ? 'wait'
                  : locate.ipBased
                    ? 'wait'
                    : locate.status === 'success'
                      ? 'ok'
                      : locate.status === 'error' || locate.status === 'unsupported'
                        ? 'error'
                        : 'off'
              }`}
            >
              {locate.status === 'locating'
                ? '定位中…'
                : locate.ipBased
                  ? '仅 IP 大致位置'
                  : locate.status === 'success'
                    ? '定位成功'
                    : locate.status === 'error' || locate.status === 'unsupported'
                      ? '定位失败'
                      : '尚未定位'}
            </span>
          </div>

          {locate.position ? (
            <>
              <GeoRows
                rows={[
                  placeRowItem(place),
                  {
                    label: positionStale ? '上次定位坐标' : '当前坐标',
                    value: formatCoordinate(
                      locate.position.latitude,
                      locate.position.longitude,
                    ),
                  },
                  { label: '定位精度', value: formatAccuracy(locate.position.accuracy) },
                  {
                    label: positionStale ? '上次定位时间' : '定位时间',
                    value: `${formatClockSec(locate.position.recordedAt)}${
                      positionStale ? ` · ${formatFixAge(locate.position.recordedAt, now)}` : ''
                    }`,
                  },
                ]}
              />
              <PlaceNote api={place} />

              {positionStale && (
                <p className="geo-note geo-note--warn">
                  这是 {formatFixAge(locate.position.recordedAt, now)}
                  拿到的位置，<strong>不是现在的位置</strong>。要记成标点的话建议先重新定位一次。
                </p>
              )}

              {locate.ipBased && (
                <p className="geo-note geo-note--warn">
                  高德这次没拿到设备定位，退回的是<strong>IP 大致位置</strong>
                  ，误差可能有好几公里，只能当地图参考。
                  它不能存成标点位置——要记坐标请走到开阔处重新点「获取当前位置」。
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
                这是上一次成功定位留下的参考位置，<strong>不是现在的位置</strong>。
                要记成标点的话，先点「获取当前位置」重新定位。
              </p>
            </>
          ) : (
            <p className="geo-card__hint">
              还没有定位。点下面的按钮获取当前位置，或者直接新建标点也行。
            </p>
          )}

          {locate.status === 'locating' && locate.hint && (
            <p className="geo-card__hint">{locate.hint}</p>
          )}

          {locate.error && <p className="geo-note geo-note--error">{locate.error}</p>}

          <div className="geo-actions">
            <button
              type="button"
              className="geo-btn"
              onClick={locate.locate}
              disabled={locate.status === 'locating' || locate.status === 'unsupported'}
            >
              <LocateIcon size={16} />
              {locate.status === 'locating' ? '定位中…' : '获取当前位置'}
            </button>
          </div>
        </div>
      </section>

      {/*
        标点地图：把记过位置的标点一次性摆在高德底图上，
        一眼就能看出哪几个钓点挨在一起。没记位置的不在这里画。
      */}
      {trip.spots.some(hasCoordinates) && (
        <section className="spot-page__section">
          <div className="spot-page__list-head">
            <h2 className="spot-page__heading">标点地图</h2>
            <span className="spot-page__count">
              共 {trip.spots.filter(hasCoordinates).length} 个有位置
            </span>
          </div>

          {/* 当前位置交给地图画：和上面卡片用的是同一条读数 */}
          <TripMap
            spots={trip.spots}
            current={locate.position}
            height={240}
            emptyText="还没有记过位置的标点。新建标点时选「使用当前位置」或「在地图上选点」就会出现在这里"
          />
        </section>
      )}

      <section className="spot-page__section">
        <div className="spot-page__list-head">
          <h2 className="spot-page__heading">我的标点</h2>
          <span className="spot-page__count">共 {trip.spots.length} 个</span>
        </div>

        {trip.spots.length > 0 ? (
          <ul className="spot-page__list">
            {trip.spots.map((spot) => {
              const used = trip.tripCountOfSpot(spot.id)
              return (
                <li className="spot-item" key={spot.id}>
                  <span className="spot-item__icon" aria-hidden="true">
                    <PinIcon size={18} />
                  </span>

                  <div className="spot-item__body">
                    <h3 className="spot-item__name">{spot.name}</h3>
                    {spot.note && <p className="spot-item__note">{spot.note}</p>}
                    <p className="spot-item__meta">
                      建于 {formatDate(spot.createdAt)} · 出勤 {used} 场
                    </p>
                    {/* 地名是主要信息，坐标只在没有地名时兜底 */}
                    {spot.placeName ? (
                      <p className="spot-item__geo">
                        <LocateIcon size={12} />
                        {spot.placeName}
                      </p>
                    ) : (
                      spot.latitude !== undefined &&
                      spot.longitude !== undefined && (
                        <p className="spot-item__geo">
                          <LocateIcon size={12} />
                          {formatCoordinateShort(spot.latitude, spot.longitude)}
                        </p>
                      )
                    )}
                  </div>

                  <div className="spot-item__actions">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => handleOpenEdit(spot)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="link-btn link-btn--danger"
                      onClick={() => setPendingDelete(spot)}
                    >
                      删除
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="spot-page__empty">
            <span className="spot-page__empty-icon" aria-hidden="true">
              <PinIcon size={22} />
            </span>
            <p className="spot-page__empty-text">
              还没有标点，点上面「新建标点」记下第一个吧
            </p>
            <p className="spot-page__empty-hint">
              标点就是常去的钓位，之后开始出勤时可以直接选
            </p>
          </div>
        )}
      </section>

      {formOpen && (
        <SpotFormModal
          initial={editing}
          location={locate.position}
          place={place.place}
          placeStatus={place.status}
          onLocate={locate.locate}
          locating={locate.status === 'locating'}
          onCancel={() => {
            setFormOpen(false)
            setEditing(null)
          }}
          onSubmit={handleSubmit}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="删除标点"
          message={
            deleteUsage > 0
              ? `这个标点已经被 ${deleteUsage} 场出勤使用过。删除后历史记录里仍然会显示当时的标点名。`
              : '确定要删除这个标点吗？'
          }
          highlight={pendingDelete.name}
          confirmText="删除"
          danger
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      <Toast message={message} />
    </div>
  )
}
