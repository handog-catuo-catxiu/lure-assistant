import { useState } from 'react'
import CatchEditModal from '../components/CatchEditModal'
import CatchPhoto from '../components/CatchPhoto'
import ConfirmDialog from '../components/ConfirmDialog'
import Toast from '../components/Toast'
import TopBar from '../components/TopBar'
import TripMap from '../components/TripMap'
import { ChevronRightIcon, MapIcon, PinIcon, TrashIcon } from '../components/icons'
import { useCatchEditor } from '../hooks/useCatchEditor'
import { formatCoordinate, hasCoordinates } from '../lib/geo'
import { resolveGear } from '../lib/tripService'
import { formatClock, formatClockSec, formatDate, formatLength, formatWeight } from '../lib/tripFormat'
import { CATCH_GEAR_CATEGORIES, CATCH_GEAR_FIELD, type CatchSavePayload } from '../types/trip'
import { CATEGORY_META } from '../types/gear'
import type { CatchPhotoLibraryApi } from '../hooks/useCatchPhotos'
import type { GearApi } from '../hooks/useGear'
import type { TripApi } from '../hooks/useTrip'
import type { LiveGeoPoint } from '../types/trip'
import './CatchDetailPage.css'

/**
 * 渔获详情：一条渔获的完整信息。
 *
 * 数据只有一处来源 —— `trip.catches` 里的那条记录，编辑也走既有的
 * CatchEditModal（`useCatchEditor`），所以这里改完，列表、统计和出勤详情
 * 看到的是同一条更新后的记录，不存在两个版本。
 *
 * 「在高德地图查看位置」用的还是项目里那一套高德地图组件，
 * 没有引入第二套地图 SDK，也没有在这里做任何坐标转换
 * （转换统一在 coord.ts 里，TripMap 内部完成）。
 */

interface CatchDetailPageProps {
  trip: TripApi
  gear: GearApi
  catchPhotos: CatchPhotoLibraryApi
  catchId: string
  /** 出勤中的实时读数，编辑时可以用它给这条渔获补位置 */
  currentLocation: LiveGeoPoint | null
  onBack: () => void
  /** 删除成功后回到列表 */
  onDeleted: () => void
  /** 「查看本次出勤」 */
  onOpenSession: (sessionId: string) => void
}

export default function CatchDetailPage({
  trip,
  gear,
  catchPhotos,
  catchId,
  currentLocation,
  onBack,
  onDeleted,
  onOpenSession,
}: CatchDetailPageProps) {
  const [mapOpen, setMapOpen] = useState(false)
  const editor = useCatchEditor({ trip, catchPhotos })

  const record = trip.catches.find((item) => item.id === catchId) ?? null
  const session = record ? trip.sessionById(record.sessionId) : null
  const spot = record?.spotId ? trip.spotById(record.spotId) : null
  const photoUrl = record ? (catchPhotos.photos[record.id]?.url ?? null) : null

  if (!record) {
    return (
      <div className="catch-detail">
        <TopBar title="渔获详情" onBack={onBack} />
        <p className="catch-detail__notice">这条渔获不存在，可能已经被删除。</p>
      </div>
    )
  }

  // 有坐标才显示地图入口；这里顺便把可选字段收窄成确定的数字
  const location =
    typeof record.latitude === 'number' &&
    typeof record.longitude === 'number' &&
    hasCoordinates(record)
      ? {
          latitude: record.latitude,
          longitude: record.longitude,
          accuracy: record.locationAccuracy,
        }
      : null
  const gearRefs = CATCH_GEAR_CATEGORIES.map((category) => ({
    category,
    ref: resolveGear(gear.items, record[CATCH_GEAR_FIELD[category]]),
  })).filter((item) => item.ref !== null)

  function handleSave(payload: CatchSavePayload): string | null {
    const target = record
    if (!target) return null
    return editor.saveCatch(target, payload)
  }

  function handleDeleted() {
    editor.confirmDelete()
    onDeleted()
  }

  return (
    <div className="catch-detail">
      <TopBar
        title="渔获详情"
        subtitle={record.species.trim() || '未填写鱼种'}
        onBack={onBack}
        backLabel="返回我的渔获"
      />

      <div className="catch-detail__photo">
        <CatchPhoto variant="tile" url={photoUrl} alt={`${record.species || '渔获'}的照片`} />
      </div>

      <section className="catch-detail__section">
        <h2 className="catch-detail__heading">{record.species.trim() || '未填写鱼种'}</h2>

        <dl className="catch-detail__grid">
          <Info label="日期" value={formatDate(record.caughtAt)} />
          <Info label="时间" value={formatClockSec(record.caughtAt)} />
          <Info
            label="长度"
            value={record.lengthCm !== null ? formatLength(record.lengthCm) : '—'}
          />
          <Info
            label="重量"
            value={record.weightG !== null ? formatWeight(record.weightG) : '—'}
          />
        </dl>
      </section>

      <section className="catch-detail__section">
        <h3 className="catch-detail__label">备注</h3>
        <p className="catch-detail__note">
          {record.note.trim() || <span className="catch-detail__muted">没有写备注</span>}
        </p>
      </section>

      <section className="catch-detail__section">
        <h3 className="catch-detail__label">关联钓点</h3>
        {record.spotId ? (
          <p className="catch-detail__value">
            <PinIcon size={15} />
            {spot ? spot.name : '标点已删除'}
          </p>
        ) : (
          <p className="catch-detail__muted">这条渔获没有关联钓点</p>
        )}

        {location && (
          <>
            <button
              type="button"
              className="catch-detail__map-toggle"
              onClick={() => setMapOpen((open) => !open)}
              aria-expanded={mapOpen}
            >
              <MapIcon size={16} />
              {mapOpen ? '收起地图' : '在高德地图查看位置'}
            </button>

            {mapOpen && (
              <>
                <p className="catch-detail__hint">
                  上鱼位置：{formatCoordinate(location.latitude, location.longitude)}
                  {typeof location.accuracy === 'number' &&
                    `（±${Math.round(location.accuracy)} 米）`}
                </p>
                <TripMap
                  catches={[record]}
                  spots={spot ? [spot] : []}
                  focus={{ latitude: location.latitude, longitude: location.longitude, zoom: 16 }}
                  autoFit={false}
                  height={220}
                  emptyText="正在加载地图…"
                />
              </>
            )}
          </>
        )}
      </section>

      <section className="catch-detail__section">
        <h3 className="catch-detail__label">实际使用装备</h3>
        {gearRefs.length > 0 ? (
          <ul className="catch-detail__gear">
            {gearRefs.map(({ category, ref }) => (
              <li key={category}>
                <span className="catch-detail__gear-cat">{CATEGORY_META[category].label}</span>
                <span
                  className={`catch-detail__gear-name${
                    ref!.deleted ? ' catch-detail__gear-name--deleted' : ''
                  }`}
                >
                  {ref!.name}
                </span>
                {ref!.brand && <span className="catch-detail__gear-brand">{ref!.brand}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="catch-detail__muted">没有记录这次用的装备</p>
        )}
        {/* 说明一句：这里列的是这条渔获自己用的装备，不是那场出勤带的全部装备 */}
        <p className="catch-detail__hint">只列这条渔获上用到的竿、轮、饵；出勤带的其它装备在出勤详情里。</p>
      </section>

      <section className="catch-detail__section">
        <h3 className="catch-detail__label">关联出勤</h3>
        {session ? (
          <button
            type="button"
            className="catch-detail__link"
            onClick={() => onOpenSession(session.id)}
          >
            <span>
              {formatDate(session.startedAt)} {formatClock(session.startedAt)}
              {session.spotName ? ` · ${session.spotName}` : ''}
            </span>
            <ChevronRightIcon size={16} />
          </button>
        ) : (
          <p className="catch-detail__muted">这次出勤的记录已经不在了</p>
        )}
      </section>

      <section className="catch-detail__actions">
        <button
          type="button"
          className="catch-detail__edit"
          onClick={() => editor.openEditor(record)}
        >
          编辑这条渔获
        </button>
        <button
          type="button"
          className="catch-detail__delete"
          onClick={() => editor.requestDelete(record)}
        >
          <TrashIcon size={16} />
          删除
        </button>
      </section>

      {editor.editing && (
        <CatchEditModal
          record={editor.editing}
          session={session}
          gearItems={gear.items}
          photoUrl={catchPhotos.photos[editor.editing.id]?.url ?? null}
          currentLocation={currentLocation}
          onClose={editor.closeEditor}
          onSave={handleSave}
        />
      )}

      {editor.pendingDelete && (
        <ConfirmDialog
          title="删除渔获"
          message="确定要删除这条渔获记录吗？照片也会一起删除，其它记录不受影响。"
          highlight={`${formatClock(editor.pendingDelete.caughtAt)} ${
            editor.pendingDelete.species || '未填写鱼种'
          }`}
          confirmText="删除"
          danger
          onConfirm={handleDeleted}
          onCancel={editor.cancelDelete}
        />
      )}

      <Toast message={editor.toastMessage} />
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="catch-detail__cell">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
