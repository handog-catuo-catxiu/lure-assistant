import type { ReactNode } from 'react'
import TopBar from '../components/TopBar'
import { FishIcon, LayersIcon, RodIcon, RulerIcon, WeightIcon } from '../components/icons'
import { useNow } from '../hooks/useNow'
import { findSpecies } from '../lib/fish/encyclopedia'
import type { SpeciesEntry } from '../lib/fish/encyclopedia/types'
import { SEASON_LABELS, WATER_LABELS, type Season } from '../lib/fish/species'
import { seasonOf } from '../lib/fish/recommend'
import './SpeciesPage.css'

/**
 * 鱼类百科详情页。
 *
 * 所有鱼种共用一个模板（需求里的十项内容都在），内容全部来自
 * `lib/fish/encyclopedia` 里写死的资料 —— 打开页面读本地数据，
 * 不联网、不调用 AI 重新生成，所以同一条鱼每次看到的解释都一样。
 *
 * 没有可靠来源的内容宁可不写：比如没有授权图片的鱼种，这里就显示
 * 「暂无图片」的占位，不拿别的鱼的照片顶上。
 */

interface SpeciesPageProps {
  speciesId: string
  onBack: () => void
  backLabel?: string
}

const SEASON_ORDER: Season[] = ['spring', 'summer', 'autumn', 'winter']

/** 难度 → 样式名。类名只用英文，中文类名在压缩和工具链里都不好惹 */
const DIFFICULTY_CLASS: Record<SpeciesEntry['difficulty'], string> = {
  入门: 'easy',
  进阶: 'medium',
  较高: 'hard',
}

/** 当前季节：目标用户在中国大陆，季节一律按北半球算（推荐规则那边会按纬度判半球） */
function currentSeasonOf(now: number): Season {
  return seasonOf(new Date(now).getMonth() + 1, 'n')
}

export default function SpeciesPage({ speciesId, onBack, backLabel }: SpeciesPageProps) {
  const now = useNow(60_000)
  const entry = findSpecies(speciesId)

  if (!entry) {
    return (
      <div className="species">
        <TopBar title="鱼类百科" onBack={onBack} backLabel={backLabel} />
        <div className="species-missing">
          <p className="species-missing__title">这条鱼还没有百科条目</p>
          <p className="species-missing__hint">
            资料库只收录有公开来源可查的鱼种。没有依据的内容我们不会现编一段补上。
          </p>
        </div>
      </div>
    )
  }

  const season = currentSeasonOf(now)

  return (
    <div className="species">
      <TopBar title={entry.name} subtitle="鱼类百科" onBack={onBack} backLabel={backLabel} />

      {/* ------------------------------ 基础信息 ------------------------------ */}
      <section className="species-hero">
        <div className="species-photo">
          {entry.image ? (
            <img className="species-photo__img" src={entry.image} alt={`${entry.name}的照片`} />
          ) : (
            <div className="species-photo__empty" role="img" aria-label={`${entry.name}暂无图片`}>
              <FishIcon size={30} />
              <span>暂无图片</span>
            </div>
          )}
        </div>

        <div className="species-hero__text">
          <h1 className="species-hero__name">{entry.name}</h1>
          <p className="species-hero__sci">
            学名：{entry.scientificNameFull ?? entry.scientificName}
          </p>
          {entry.aliases.length > 0 && (
            <p className="species-hero__alias">
              别名：
              {entry.aliases.map((alias) => (
                <span className="species-tag" key={alias}>
                  {alias}
                </span>
              ))}
            </p>
          )}
          <p className="species-hero__diff">
            路亚难度
            <span className={`species-diff species-diff--${DIFFICULTY_CLASS[entry.difficulty]}`}>
              {entry.difficulty}
            </span>
          </p>
        </div>
      </section>

      {entry.imageCredit && <p className="species-credit">{entry.imageCredit}</p>}

      {/* ------------------------------ 外形 / 习性 / 食性 ------------------------------ */}
      <Section title="外形特征">
        <p>{entry.appearance}</p>
      </Section>

      <Section title="生活习性">
        <p>{entry.habits}</p>
      </Section>

      <Section title="食性">
        <p>{entry.diet}</p>
      </Section>

      {/* ------------------------------ 体型 ------------------------------ */}
      <Section title="常见体长与重量">
        <div className="species-size">
          <div className="species-size__item">
            <RulerIcon size={15} />
            <span className="species-size__label">体长</span>
            <span className="species-size__value">
              {entry.size.lengthCm[0]}–{entry.size.lengthCm[1]} cm
            </span>
          </div>
          <div className="species-size__item">
            <WeightIcon size={15} />
            <span className="species-size__label">体重</span>
            <span className="species-size__value">
              {entry.size.weightKg[0]}–{entry.size.weightKg[1]} kg
            </span>
          </div>
        </div>
        {entry.size.note && <p className="species-note">{entry.size.note}</p>}
      </Section>

      {/* ------------------------------ 分布 ------------------------------ */}
      <Section title="中国大陆分布">
        <p>{entry.distribution}</p>
        <div className="species-chips">
          {entry.water.map((water) => (
            <span className="species-chip" key={water}>
              {WATER_LABELS[water]}
            </span>
          ))}
        </div>
        {entry.legalNote && <p className="species-warn">{entry.legalNote}</p>}
      </Section>

      {/* ------------------------------ 四季 ------------------------------ */}
      <Section title="四季活动特点">
        <ul className="species-seasons">
          {SEASON_ORDER.map((item) => (
            <li
              className={`species-season${item === season ? ' species-season--now' : ''}`}
              key={item}
            >
              <span className="species-season__label">
                {SEASON_LABELS[item]}
                {item === season && <em className="species-season__now">当前季节</em>}
              </span>
              <span className="species-season__text">{entry.seasons[item]}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* ------------------------------ 路亚玩法 ------------------------------ */}
      <Section title="推荐拟饵">
        <div className="species-chips">
          {entry.luring.lures.map((lure) => (
            <span className="species-chip species-chip--accent" key={lure}>
              {lure}
            </span>
          ))}
        </div>
        <div className="species-rows">
          <Row label="操作手法" text={entry.luring.retrieve} />
          <Row label="装备" text={entry.luring.gear} />
          <Row label="钓位" text={entry.luring.spots} />
        </div>
      </Section>

      <Section title="注意事项">
        <ul className="species-bullets">
          {entry.cautions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      {/* ------------------------------ 资料来源 ------------------------------ */}
      <Section title="资料来源">
        <ul className="species-sources">
          {entry.sources.map((source) => (
            <li key={source.label}>
              <span className="species-sources__label">{source.label}</span>
              {source.detail && <span className="species-sources__detail">{source.detail}</span>}
            </li>
          ))}
        </ul>
        <p className="species-note">资料最后核对：{entry.reviewedAt}</p>
      </Section>

      <p className="species-foot">
        百科内容按公开资料整理，只作参考；出钓前请以当地渔业主管部门的公告为准。
      </p>
    </div>
  )
}

/* ------------------------------ 小组件 ------------------------------ */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="species-card" aria-label={title}>
      <h2 className="species-card__title">
        <LayersIcon size={15} />
        {title}
      </h2>
      <div className="species-card__body">{children}</div>
    </section>
  )
}

function Row({ label, text }: { label: string; text: string }) {
  return (
    <div className="species-row">
      <span className="species-row__label">
        <RodIcon size={13} />
        {label}
      </span>
      <span className="species-row__text">{text}</span>
    </div>
  )
}
