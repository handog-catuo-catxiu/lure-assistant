import { useState } from 'react'
import type { SyncApi } from '../hooks/useCloudSync'
import type { LegacySummary } from '../lib/sync/claim'
import './SyncStatus.css'

interface SyncStatusProps {
  sync: SyncApi
  signedIn: boolean
}

function formatTime(timestamp: number | null): string {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function summaryText(summary: LegacySummary): string {
  const parts: string[] = []
  if (summary.gear) parts.push(`${summary.gear} 件装备`)
  if (summary.spot) parts.push(`${summary.spot} 个钓点`)
  if (summary.trip) parts.push(`${summary.trip} 场出勤`)
  if (summary.catch) parts.push(`${summary.catch} 条渔获`)
  if (summary.gearImage) parts.push(`${summary.gearImage} 张装备照片`)
  if (summary.catchImage) parts.push(`${summary.catchImage} 张渔获照片`)
  if (summary.track) parts.push(`${summary.track} 个轨迹点`)
  if (summary.pref) parts.push(`${summary.pref} 项偏好`)
  return parts.join('、') || '本机记录'
}

/**
 * 同步状态条。
 *
 * 失败、等待网络、正在同步都会如实显示，不会把没上传成功说成已同步。
 * 本机旧数据必须由用户点「导入」后才会上传，登录本身不会上传。
 */
export default function SyncStatus({ sync, signedIn }: SyncStatusProps) {
  const [claimDone, setClaimDone] = useState<number | null>(null)

  async function handleClaim() {
    const result = await sync.claimLocalData()
    if (result.ok) setClaimDone(Date.now())
  }

  if (!signedIn) {
    return (
      <section className="sync-status sync-status--local" aria-label="同步状态">
        <span className="sync-status__dot" aria-hidden="true" />
        <span className="sync-status__text">
          <strong>本机模式</strong>
          <span>已保存在本机，等待同步。登录后可以把记录同步到账号。</span>
        </span>
      </section>
    )
  }

  if (sync.claimRequired && sync.claimSummary) {
    return (
      <section className="sync-status sync-status--claim" aria-label="本机数据导入">
        <span className="sync-status__text">
          <strong>发现本机旧数据</strong>
          <span>
            {summaryText(sync.claimSummary)}。导入后会保存在当前账号，旧数据仍留在本机不会删除。
          </span>
        </span>
        <button
          type="button"
          className="sync-status__action"
          onClick={() => void handleClaim()}
          disabled={sync.claiming}
        >
          {sync.claiming ? '导入中…' : '导入到此账号'}
        </button>
        {sync.error && (
          <span className="sync-status__error" role="alert">
            {sync.error}
          </span>
        )}
      </section>
    )
  }

  const pendingText =
    sync.pending > 0 ? `有 ${sync.pending} 项改动等待同步` : '所有记录已同步'
  const syncedAt = formatTime(sync.lastSyncedAt)
  const claimDoneText =
    claimDone !== null && sync.pending === 0 ? '本机数据已导入' : null

  if (sync.phase === 'local') {
    return (
      <section className="sync-status sync-status--warn" aria-label="同步状态">
        <span className="sync-status__dot sync-status__dot--warn" aria-hidden="true" />
        <span className="sync-status__text">
          <strong>已保存在本机，等待同步</strong>
          <span>
            {sync.pending > 0 ? `${pendingText}。` : ''}
            云端同步还没有启用，完成云端配置后会从这里自动同步。
          </span>
        </span>
      </section>
    )
  }

  if (sync.phase === 'syncing') {
    return (
      <section className="sync-status" aria-label="同步状态">
        <span className="sync-status__dot sync-status__dot--busy" aria-hidden="true" />
        <span className="sync-status__text">
          <strong>正在同步…</strong>
          <span>{pendingText}</span>
        </span>
      </section>
    )
  }

  if (sync.phase === 'offline') {
    return (
      <section className="sync-status sync-status--warn" aria-label="同步状态">
        <span className="sync-status__dot sync-status__dot--warn" aria-hidden="true" />
        <span className="sync-status__text">
          <strong>等待网络</strong>
          <span>{sync.error ?? '记录已保存在本机，联网后会自动同步。'}</span>
        </span>
        <button
          type="button"
          className="sync-status__action"
          onClick={() => void sync.syncNow()}
        >
          重试
        </button>
      </section>
    )
  }

  if (sync.phase === 'error') {
    return (
      <section className="sync-status sync-status--error" aria-label="同步状态">
        <span className="sync-status__dot sync-status__dot--error" aria-hidden="true" />
        <span className="sync-status__text">
          <strong>同步没有完成</strong>
          <span>{sync.error ?? '记录已保存在本机，请稍后重试。'}</span>
        </span>
        <button
          type="button"
          className="sync-status__action"
          onClick={() => void sync.syncNow()}
        >
          重试
        </button>
      </section>
    )
  }

  if (sync.pending > 0) {
    return (
      <section className="sync-status sync-status--warn" aria-label="同步状态">
        <span className="sync-status__dot sync-status__dot--warn" aria-hidden="true" />
        <span className="sync-status__text">
          <strong>已保存在本机，等待同步</strong>
          <span>{pendingText}</span>
        </span>
        <button
          type="button"
          className="sync-status__action"
          onClick={() => void sync.syncNow()}
        >
          立即同步
        </button>
      </section>
    )
  }

  return (
    <section className="sync-status sync-status--ok" aria-label="同步状态">
      <span className="sync-status__dot sync-status__dot--ok" aria-hidden="true" />
      <span className="sync-status__text">
        <strong>{claimDoneText ?? '已同步'}</strong>
        <span>
          {syncedAt ? `最后同步 ${syncedAt}` : '账号数据已同步到云端'}
          {' · '}
          换设备登录同一账号即可恢复
        </span>
      </span>
      <button
        type="button"
        className="sync-status__action"
        onClick={() => void sync.syncNow()}
      >
        立即同步
      </button>
    </section>
  )
}
