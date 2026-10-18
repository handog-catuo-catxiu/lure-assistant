import { useCallback, useEffect, useState } from 'react'
import {
  claimLocalData as runClaim,
  getSyncSnapshot,
  startSync,
  stopSync,
  subscribeSyncState,
  syncNow as runSync,
  type ClaimResult,
  type SyncSnapshot,
} from '../lib/sync/engine'

export interface SyncApi extends SyncSnapshot {
  /** 手动立即同步；失败会体现在快照的 error 上 */
  syncNow: () => Promise<void>
  /** 把本机旧数据导入当前账号（只有用户点按钮时才会执行） */
  claimLocalData: () => Promise<ClaimResult>
}

/**
 * 订阅同步状态。
 *
 * uid 变化时自动切换同步范围；未登录时引擎完全停止，
 * 不会把上一份账号的数据当成当前账号上传。
 */
export function useCloudSync(uid: string | null): SyncApi {
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(getSyncSnapshot)

  useEffect(() => subscribeSyncState(setSnapshot), [])

  useEffect(() => {
    if (uid) startSync(uid)
    else stopSync()
    return () => stopSync()
  }, [uid])

  const syncNow = useCallback(() => runSync(), [])
  const claimLocalData = useCallback(() => runClaim(), [])

  return { ...snapshot, syncNow, claimLocalData }
}
