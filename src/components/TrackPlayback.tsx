import TripMap from './TripMap'
import { PauseIcon, PlayIcon, RefreshIcon } from './icons'
import { useTrackPlayback } from '../hooks/useTrackPlayback'
import { formatClockSec } from '../lib/tripFormat'
import type { CatchRecord, Spot, TrackPoint } from '../types/trip'
import './TrackPlayback.css'

interface TrackPlaybackProps {
  /** 这场出勤已经保存下来的轨迹点，按时间升序 */
  points: TrackPoint[]
  /** 这场出勤的渔获：到点上鱼的时候会在地图上出现 */
  catches: CatchRecord[]
  spots?: Spot[]
  height?: number
}

/**
 * 轨迹回放。
 *
 * 只放**已经存下来的**真实轨迹点：播放过程不会去请求一次新的定位，
 * 也不会把两次定位之间的空白连成直线——时间断点处线就是断的。
 * 渔获按真实的上鱼时间出现在地图上。
 */
export default function TrackPlayback({
  points,
  catches,
  spots = [],
  height = 240,
}: TrackPlaybackProps) {
  const playback = useTrackPlayback(points, catches)

  const playLabel = playback.playing
    ? '暂停'
    : playback.finished || playback.progress >= 1
      ? '重播'
      : '播放轨迹'

  return (
    <div className="track-playback">
      <TripMap
        points={playback.visiblePoints}
        head={playback.head}
        spots={spots}
        catches={playback.visibleCatches}
        height={height}
        emptyText="这场出勤没有可回放的轨迹点"
      />

      <div className="track-playback__controls">
        <button
          type="button"
          className="track-playback__btn track-playback__btn--primary"
          onClick={() => (playback.playing ? playback.pause() : playback.play())}
          disabled={!playback.canPlay}
        >
          {playback.playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          {playLabel}
        </button>

        <button
          type="button"
          className="track-playback__btn"
          onClick={playback.restart}
          disabled={!playback.canPlay}
        >
          <RefreshIcon size={16} />
          从头
        </button>

        <span className="track-playback__time">
          {playback.currentTime !== null
            ? formatClockSec(playback.currentTime)
            : formatClockSec(points[0]?.recordedAt ?? 0)}
        </span>
      </div>

      <input
        className="track-playback__range"
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(playback.progress * 1000)}
        onChange={(event) => playback.seek(Number(event.target.value) / 1000)}
        disabled={!playback.canPlay}
        aria-label="回放进度"
      />

      <p className="track-playback__note">
        {playback.canPlay
          ? `按真实时间顺序回放，全程压缩到约 ${Math.round(
              playback.playbackMs / 1000,
            )} 秒（${playback.speed} 倍速）；中间断开的两次定位之间不会连线。`
          : '轨迹点太少，暂时没法回放。至少要有两个点、并且中间隔了一点时间。'}
      </p>
    </div>
  )
}
