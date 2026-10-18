/**
 * 本地数据变化 & 云端结果应用的通知。
 *
 * localStorage 的 storage 事件只在「别的标签页」触发，本标签页自己的写入收不到，
 * 所以这里提供一个极小的进程内事件总线：
 * - 本地增删改 → 通知同步引擎尽快推送
 * - 云端拉取合并完成 → 通知 React hook 重新从本地存储读取
 */

export type LocalChangeKind =
  | 'gear'
  | 'spot'
  | 'trip'
  | 'catch'
  | 'pref'
  | 'image'
  | 'track'
  | 'meta'

type Listener = (kind: LocalChangeKind) => void

const localListeners = new Set<Listener>()
const remoteListeners = new Set<Listener>()

export function emitLocalChange(kind: LocalChangeKind): void {
  for (const listener of localListeners) listener(kind)
}

export function subscribeLocalChanges(listener: Listener): () => void {
  localListeners.add(listener)
  return () => localListeners.delete(listener)
}

/** 云端数据已经安全写入本地，界面可以重新读取了 */
export function emitRemoteApplied(kind: LocalChangeKind = 'meta'): void {
  for (const listener of remoteListeners) listener(kind)
}

export function subscribeRemoteApplied(listener: Listener): () => void {
  remoteListeners.add(listener)
  return () => remoteListeners.delete(listener)
}
