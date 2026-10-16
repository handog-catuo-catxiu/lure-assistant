import { useMemo, useState } from 'react'
import {
  ChevronRightIcon,
  ClockIcon,
  CloudIcon,
  DropIcon,
  FishIcon,
  LocateIcon,
  PinIcon,
  RainIcon,
  RefreshIcon,
  RodIcon,
  SnowIcon,
  SunIcon,
  ThermoIcon,
  WindIcon,
} from '../components/icons'
import { useElapsed } from '../hooks/useElapsed'
import { useFishAdvice } from '../hooks/useFishAdvice'
import { useFishingWeather } from '../hooks/useFishingWeather'
import { useNow } from '../hooks/useNow'
import { usePlaceName } from '../hooks/usePlaceName'
import type { SpeciesAdvice } from '../lib/fish/recommend'
import { WATER_LABELS, type WaterType } from '../lib/fish/species'
import { formatDate, formatDateCN, formatTimer } from '../lib/tripFormat'
import type { WeatherKind, WeatherNow } from '../lib/weather'
import type { TripApi } from '../hooks/useTrip'
import type { LiveGeoPoint, Spot } from '../types/trip'
import './HomePage.css'

/**
 * 首页：只有两块内容 —— 今日钓鱼天气、今日推荐鱼种。
 *
 * 天气来自真实接口；鱼种的流程是「本地先筛出当地可能存在的鱼 → 交给
 * DeepSeek 排序写理由 → 结果不合规就退回本地规则」，细节见
 * hooks/useFishAdvice.ts 与 lib/fish/ai。
 *
 * 定位复用出勤那条高德定位循环或一次性定位，首页自己不新建任何监听。
 */

interface HomePageProps {
  trip: TripApi
  /** 出勤中的实时读数（应用级轨迹记录器给的），有就直接用 */
  liveFix: LiveGeoPoint | null
  onResumeTrip: () => void
  /** 点推荐卡片进鱼类百科 */
  onOpenSpecies: (speciesId: string) => void
}

/** 用户手动选的水型，记在本机；没选过就是「自动判断」 */
const WATER_PREF_KEY = 'luremate:fish-water:v1'
/** 用户选中的「参考钓点」，记在本机；没选就是按当前位置做区域鱼情参考 */
const REF_SPOT_KEY = 'luremate:fish-ref-spot:v1'

function loadRefSpot(): string | null {
  try {
    const saved = localStorage.getItem(REF_SPOT_KEY)
    return saved && saved.length > 0 ? saved : null
  } catch {
    // 隐私模式下读不到，按「当前位置」处理
    return null
  }
}

function saveRefSpot(spotId: string | null): void {
  try {
    if (spotId) localStorage.setItem(REF_SPOT_KEY, spotId)
    else localStorage.removeItem(REF_SPOT_KEY)
  } catch {
    // 存不下不影响这次的推荐
  }
}

function loadWaterPref(): WaterType {
  try {
    const saved = localStorage.getItem(WATER_PREF_KEY)
    if (saved === 'still' || saved === 'flowing' || saved === 'sea') return saved
  } catch {
    // 隐私模式下读不到，按自动判断处理
  }
  return 'unknown'
}

function saveWaterPref(value: WaterType): void {
  try {
    localStorage.setItem(WATER_PREF_KEY, value)
  } catch {
    // 存不下也不影响这次的推荐
  }
}

/** 参考位置最多列出几个钓点：再多就不是「顺手挑一个」而是管理列表了 */
const MAX_REF_SPOTS = 6

/** 有坐标的钓点才能当参考位置：拿不到位置的钓点算不出天气，也给不了鱼情 */
function hasCoordinates(spot: Spot): boolean {
  return typeof spot.latitude === 'number' && typeof spot.longitude === 'number'
}

/** 最近改过的排在前面 */
function pickRefSpots(spots: Spot[]): Spot[] {
  return spots
    .filter(hasCoordinates)
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_REF_SPOTS)
}

const WATER_OPTIONS: { value: WaterType; label: string }[] = [
  { value: 'unknown', label: '自动判断' },
  { value: 'still', label: WATER_LABELS.still },
  { value: 'flowing', label: WATER_LABELS.flowing },
  { value: 'sea', label: WATER_LABELS.sea },
]

/** 天气现象 → 图标。同一类现象共用一张图，不为了好看编新图 */
function WeatherGlyph({ kind, size }: { kind: WeatherKind; size: number }) {
  if (kind === 'clear') return <SunIcon size={size} />
  if (kind === 'rain' || kind === 'thunder') return <RainIcon size={size} />
  if (kind === 'snow') return <SnowIcon size={size} />
  return <CloudIcon size={size} />
}

const RATING_CLASS: Record<SpeciesAdvice['rating'], string> = {
  值得尝试: 'high',
  可以关注: 'mid',
  条件一般: 'low',
}

export default function HomePage({
  trip,
  liveFix,
  onResumeTrip,
  onOpenSpecies,
}: HomePageProps) {
  // 日期只用来显示和算月份，一分钟对齐一次就够
  const now = useNow(60_000)
  const month = new Date(now).getMonth() + 1
  const today = formatDate(now)

  const [waterPref, setWaterPref] = useState<WaterType>(() => loadWaterPref())
  const [refSpotId, setRefSpotId] = useState<string | null>(() => loadRefSpot())

  /*
   * 参考位置：默认用当前位置；用户也可以挑一个已有的钓点。
   * 选了钓点就整个换成那个钓点 —— 坐标、地名、天气都按它来，
   * 不会再因为「当前位置」的定位结果把首页悄悄改回去。
   */
  const refSpots = useMemo(() => pickRefSpots(trip.spots), [trip.spots])
  const refSpot = useMemo(
    () => refSpots.find((spot) => spot.id === refSpotId) ?? null,
    [refSpots, refSpotId],
  )
  // 必须是同一个引用：天气 hook 拿它当依赖，每次渲染新对象会导致反复请求
  const overridePoint = useMemo(
    () =>
      refSpot && hasCoordinates(refSpot)
        ? { latitude: refSpot.latitude as number, longitude: refSpot.longitude as number }
        : null,
    [refSpot],
  )

  const weatherApi = useFishingWeather({ liveFix, overridePoint })
  const { weather, point, status, error, locationError, fromCache, approximate } = weatherApi

  // 地区名复用现有的高德逆地理编码（和钓点页是同一套，含同一份缓存）。
  // 选了钓点就不用查了：那个名字是用户自己起的，比反查出来的地名更准。
  const place = usePlaceName(refSpot ? null : point)

  const scope: 'spot' | 'region' = refSpot ? 'spot' : 'region'
  const regionLabel = refSpot
    ? refSpot.name
    : describeRegion(place.status, place.place?.name ?? null, place.place?.area ?? null)
  // 交给 AI 之前要有一个能说清「在哪儿」的名字；地名还没查出来就别硬给
  const placeLabel = refSpot ? refSpot.name : place.place?.name ? regionLabel : null

  const adviceApi = useFishAdvice({
    latitude: point?.latitude ?? null,
    longitude: point?.longitude ?? null,
    // 水型按钓点名 / 地名推断；选了钓点就优先用钓点的名字
    placeName: refSpot ? refSpot.name : (place.place?.name ?? null),
    placeLabel,
    scope,
    month,
    todayLabel: today,
    now,
    waterOverride: waterPref,
    weather,
  })
  const advice = adviceApi.result

  const activeSession = trip.activeSession
  const elapsed = useElapsed(activeSession ? activeSession.startedAt : null)

  function chooseWater(value: WaterType) {
    setWaterPref(value)
    saveWaterPref(value)
  }

  function chooseRefSpot(spotId: string | null) {
    setRefSpotId(spotId)
    saveRefSpot(spotId)
  }

  return (
    <div className="home">
      <header className="home__hero">
        <div className="home__brand">
          <span className="home__logo" aria-hidden="true">
            <RodIcon size={20} />
          </span>
          <div className="home__brand-text">
            <h1 className="home__title">LureMate</h1>
            <p className="home__date">{formatDateCN(now)}</p>
          </div>
        </div>
        <p className="home__slogan">出门前看一眼天气，顺手挑两三个目标鱼种</p>

        {activeSession && (
          <button type="button" className="home__live" onClick={onResumeTrip}>
            <span className="home__live-dot" aria-hidden="true" />
            <span className="home__live-text">
              正在出勤 · {activeSession.spotName || '标点已删除'}
            </span>
            <span className="home__live-time">{formatTimer(elapsed)}</span>
            <ChevronRightIcon size={16} />
          </button>
        )}
      </header>

      {/* ------------------------------ 今日钓鱼天气 ------------------------------ */}

      <section className="home-card" aria-labelledby="home-weather-title">
        <div className="home-card__head">
          <span className="home-card__icon" aria-hidden="true">
            <CloudIcon size={17} />
          </span>
          <h2 className="home-card__title" id="home-weather-title">
            今日钓鱼天气
          </h2>
          <button
            type="button"
            className="home-card__action"
            onClick={weatherApi.refresh}
            disabled={status === 'loading' || status === 'locating'}
            aria-label="刷新天气"
          >
            <RefreshIcon size={16} />
          </button>
        </div>

        {status === 'locating' && (
          <p className="home-card__state">
            <LocateIcon size={15} />
            正在通过高德定位获取当前位置…
          </p>
        )}

        {status === 'error' && locationError && (
          <div className="home-card__state home-card__state--error">
            <p>{locationError}</p>
            <button type="button" className="home-card__retry" onClick={weatherApi.refresh}>
              重新定位
            </button>
          </div>
        )}

        {status === 'error' && !locationError && (
          <div className="home-card__state home-card__state--error">
            <p>{error ?? '天气暂时取不到。'}</p>
            <button type="button" className="home-card__retry" onClick={weatherApi.refresh}>
              重试
            </button>
          </div>
        )}

        {status === 'loading' && !weather && (
          <p className="home-card__state">正在获取天气数据…</p>
        )}

        {status === 'ready' && weather && (
          <WeatherBody
            weather={weather}
            regionLabel={regionLabel}
            today={today}
            fromCache={fromCache}
            failed={error !== null}
            approximate={approximate}
          />
        )}

        {status === 'loading' && weather && (
          <p className="home-card__note">正在更新天气…</p>
        )}
      </section>

      {/* ------------------------------ 今日推荐鱼种 ------------------------------ */}

      <section className="home-card" aria-labelledby="home-fish-title">
        <div className="home-card__head">
          <span className="home-card__icon home-card__icon--warm" aria-hidden="true">
            <FishIcon size={17} />
          </span>
          <h2 className="home-card__title" id="home-fish-title">
            今日推荐鱼种
          </h2>
          <button
            type="button"
            className="home-card__action"
            onClick={adviceApi.retry}
            disabled={adviceApi.aiStatus === 'loading' || adviceApi.throttled}
            aria-label="重新分析鱼情"
          >
            <RefreshIcon size={16} />
          </button>
        </div>

        {/* 没选具体钓点时如实说明这是区域参考，不假装精确到某个点 */}
        <p
          className={`scope-note${scope === 'spot' ? ' scope-note--spot' : ''}`}
          data-scope={scope}
        >
          {scope === 'spot' ? (
            <>
              <PinIcon size={13} />
              参考位置：{refSpot?.name}
            </>
          ) : (
            <>
              <LocateIcon size={13} />
              区域鱼情参考（当前位置，未选择具体钓点）
            </>
          )}
        </p>

        {refSpots.length > 0 && (
          <div className="water-picker" role="group" aria-label="选择参考位置">
            <button
              type="button"
              className={`water-picker__item${refSpotId === null ? ' water-picker__item--on' : ''}`}
              onClick={() => chooseRefSpot(null)}
              aria-pressed={refSpotId === null}
            >
              当前位置
            </button>
            {refSpots.map((spot) => (
              <button
                key={spot.id}
                type="button"
                className={`water-picker__item${
                  refSpotId === spot.id ? ' water-picker__item--on' : ''
                }`}
                onClick={() => chooseRefSpot(spot.id)}
                aria-pressed={refSpotId === spot.id}
              >
                {spot.name}
              </button>
            ))}
          </div>
        )}

        <div className="water-picker" role="group" aria-label="选择水域类型">
          {WATER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`water-picker__item${
                waterPref === option.value ? ' water-picker__item--on' : ''
              }`}
              onClick={() => chooseWater(option.value)}
              aria-pressed={waterPref === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>

        {adviceApi.aiMessage && (
          <p className="advice-status" data-status={adviceApi.aiStatus}>
            {adviceApi.aiMessage}
          </p>
        )}

        {advice.status === 'ok' ? (
          <ul className="advice-list">
            {advice.advice.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="advice"
                  onClick={() => onOpenSpecies(item.id)}
                  aria-label={`查看${item.name}的鱼类百科`}
                >
                  <span className="advice__top">
                    <span className="advice__name">{item.name}</span>
                    <span className={`advice__rating advice__rating--${RATING_CLASS[item.rating]}`}>
                      {item.rating}
                    </span>
                  </span>
                  <span className="advice__reasons">
                    {item.reasons.map((reason) => (
                      <span className="advice__reason" key={reason}>
                        {reason}
                      </span>
                    ))}
                  </span>
                  <span className="advice__meta">
                    <ClockIcon size={13} />
                    关注时间段：{item.timeWindow}
                  </span>
                  <span className="advice__tip">{item.tip}</span>
                  <span className="advice__more">
                    查看百科
                    <ChevronRightIcon size={14} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="advice-empty">
            <p className="advice-empty__title">{advice.message}</p>
            <p className="advice-empty__hint">{advice.hint}</p>
          </div>
        )}

        <div className="home-card__basis">
          {advice.lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
          {adviceApi.candidateCount !== null && (
            <span>
              候选鱼种：本地按分布、季节、水温与水域筛出 {adviceApi.candidateCount} 种
            </span>
          )}
        </div>
        <p className="home-card__note">
          {adviceApi.source === 'ai'
            ? '推荐由 DeepSeek 在上面这些当地鱼种里排序得出（结合真实天气与季节），仅供参考，不保证上鱼。'
            : '推荐由本地规则按季节、纬度、气温与水域类型推算，仅供参考，不保证上鱼。'}
        </p>
      </section>
    </div>
  )
}

/* ------------------------------ 天气卡片正文 ------------------------------ */

function describeRegion(
  status: string,
  name: string | null,
  area: string | null,
): string {
  if (status === 'loading') return '正在确认地区…'
  if (status === 'ok' && name) return area ? `${name}（${area}）` : name
  if (status === 'idle') return '尚未定位'
  // 地名查不到就说查不到，不拿坐标编一个
  return '已定位（地名暂不可用）'
}

interface WeatherBodyProps {
  weather: WeatherNow
  regionLabel: string
  /** 今天的日期（由 useNow 提供，渲染里不直接读时钟） */
  today: string
  fromCache: boolean
  failed: boolean
  approximate: boolean
}

function WeatherBody({
  weather,
  regionLabel,
  today,
  fromCache,
  failed,
  approximate,
}: WeatherBodyProps) {
  const metrics: { label: string; value: string; Icon: typeof WindIcon }[] = [
    {
      label: '风向',
      value: weather.windDirection ? `${weather.windDirection}风` : '—',
      Icon: WindIcon,
    },
    {
      label: '风力',
      value: weather.windPower !== null ? `${weather.windPower} 级` : '—',
      Icon: WindIcon,
    },
    {
      label: '湿度',
      value: weather.humidityPercent !== null ? `${Math.round(weather.humidityPercent)}%` : '—',
      Icon: DropIcon,
    },
    {
      label: '降水',
      value: weather.precipitationMm !== null ? `${weather.precipitationMm.toFixed(1)} mm` : '—',
      Icon: RainIcon,
    },
  ]

  return (
    <div className="weather">
      <div className="weather__region">
        <LocateIcon size={14} />
        <span className="weather__region-name">{regionLabel}</span>
      </div>

      <div className="weather__main">
        <span className="weather__glyph" aria-hidden="true">
          <WeatherGlyph kind={weather.kind} size={38} />
        </span>
        <div className="weather__reading">
          <p className="weather__temp">
            {Math.round(weather.temperatureC)}
            <span className="weather__unit">℃</span>
          </p>
          <p className="weather__condition">
            {weather.condition}
            {weather.apparentC !== null && (
              <span className="weather__feels">
                <ThermoIcon size={12} /> 体感 {Math.round(weather.apparentC)}℃
              </span>
            )}
          </p>
        </div>
      </div>

      <dl className="weather__metrics">
        {metrics.map(({ label, value, Icon }) => (
          <div className="weather__metric" key={label}>
            <dt>
              <Icon size={13} />
              {label}
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <p className="weather__foot">
        {weather.observedLabel ? `更新于 ${weather.observedLabel}` : '更新时间暂缺'}
        {weather.observedDate && weather.observedDate !== today && (
          <span className="weather__stale">（数据日期 {weather.observedDate}）</span>
        )}
        {fromCache && <span className="weather__stale">· 缓存数据</span>}
      </p>

      {failed && (
        <p className="home-card__note home-card__note--warn">
          这次没更新成功，上面是上一次取到的数据。
        </p>
      )}
      {approximate && (
        <p className="home-card__note">当前位置是高德退回的 IP 大致位置，天气代表的是城市范围。</p>
      )}
      <p className="home-card__source">
        天气数据来源：
        <a href={weather.sourceUrl} target="_blank" rel="noreferrer noopener">
          {weather.source}
        </a>
      </p>
    </div>
  )
}
