import { useState } from 'react'
import GearPickerList from './GearPickerList'
import Modal from './Modal'
import { CloseIcon } from './icons'
import type { GearItem } from '../types/gear'
import type { TripSession } from '../types/trip'
import './TripGearModal.css'

interface TripGearModalProps {
  session: TripSession
  gearItems: GearItem[]
  imageUrls: Record<string, { url: string }>
  onClose: () => void
  /** 返回错误文案，null 表示保存成功 */
  onSave: (gearIds: string[]) => string | null
}

/** 管理本次携带的装备：出勤途中随时能加进来或拿出去 */
export default function TripGearModal({
  session,
  gearItems,
  imageUrls,
  onClose,
  onSave,
}: TripGearModalProps) {
  const [selected, setSelected] = useState<string[]>(session.gearIds)
  const [error, setError] = useState<string | null>(null)

  function handleToggle(gearId: string) {
    setSelected((current) =>
      current.includes(gearId)
        ? current.filter((id) => id !== gearId)
        : [...current, gearId],
    )
    if (error) setError(null)
  }

  function handleSave() {
    const failure = onSave(selected)
    if (failure) {
      setError(failure)
      return
    }
    onClose()
  }

  return (
    <Modal
      title="本次出勤装备"
      subtitle="这次带出去的装备，和钓到鱼时实际用的装备是两回事"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn--primary" onClick={handleSave}>
            保存（已选 {selected.length} 件）
          </button>
        </>
      }
    >
      <p className="trip-gear__hint">
        不选也可以正常出勤，之后随时再来调整。
      </p>

      <GearPickerList
        items={gearItems}
        imageUrls={imageUrls}
        selectedIds={selected}
        onToggle={handleToggle}
      />

      {error && (
        <p className="form__error trip-gear__error" role="alert">
          <CloseIcon size={14} />
          {error}
        </p>
      )}
    </Modal>
  )
}
