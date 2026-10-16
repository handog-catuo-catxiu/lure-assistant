import type { PlaceNameApi } from '../hooks/usePlaceName'
import type { GeoRowItem } from '../components/GeoStatusPanel'

/**
 * 把地名查询的状态转成 GeoRows 里的一行「位置名称」。
 *
 * 查不到就说查不到：这里不会拿坐标或者区域名拼一个假地名出来。
 */
export function placeRowItem(api: PlaceNameApi): GeoRowItem {
  if (api.status === 'ok' && api.place) {
    const { name, area } = api.place
    return { label: '位置名称', value: area ? `${name}（${area}）` : name }
  }
  if (api.status === 'loading') {
    return { label: '位置名称', value: '正在查地名…', muted: true }
  }
  if (api.status === 'empty') {
    return { label: '位置名称', value: '这一带没有地名，自己起个名字吧', muted: true }
  }
  if (api.status === 'error') {
    return { label: '位置名称', value: '没查到地名（不影响定位）', muted: true }
  }
  return { label: '位置名称', value: '尚未定位', muted: true }
}
