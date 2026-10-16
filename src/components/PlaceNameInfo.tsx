import { PLACE_ATTRIBUTION, PLACE_ATTRIBUTION_URL } from '../lib/amap/geocode'
import type { PlaceNameApi } from '../hooks/usePlaceName'
import './GeoStatus.css'

/**
 * 地名的详细说明：数据来源署名、完整地址，以及查询失败时的重试入口。
 * 「位置名称」那一行在 lib/placeFormat.ts 里。
 */
export default function PlaceNote({ api }: { api: PlaceNameApi }) {
  if (api.status === 'ok' && api.place) {
    return (
      <p className="geo-note geo-note--place">
        <span className="geo-note__extra">{api.place.full}</span>
        <a
          className="geo-note__link"
          href={PLACE_ATTRIBUTION_URL}
          target="_blank"
          rel="noreferrer"
        >
          {PLACE_ATTRIBUTION}
        </a>
      </p>
    )
  }

  if (api.status === 'error') {
    return (
      <p className="geo-note">
        {api.error}
        <button type="button" className="link-btn geo-note__retry" onClick={api.retry}>
          再查一次
        </button>
      </p>
    )
  }

  if (api.status === 'loading') {
    return <p className="geo-note">正在根据坐标查这一带叫什么名字…</p>
  }

  return null
}
