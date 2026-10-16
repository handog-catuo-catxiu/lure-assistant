import { useMemo, useState } from 'react'
import TopBar from '../components/TopBar'
import { ChevronRightIcon, FishIcon, SearchIcon } from '../components/icons'
import { ALL_SPECIES } from '../lib/fish/encyclopedia'
import type { SpeciesEntry } from '../lib/fish/encyclopedia/types'
import './SpeciesListPage.css'

/**
 * 鱼类百科目录。
 *
 * 数据就是本地的资料库（lib/fish/encyclopedia），一共十来条，所以
 * 搜索直接在前端过滤，不联网、不打扰任何接口。
 * 按水域分组只是为了好找，不代表鱼只生活在那一种水域里。
 */

interface SpeciesListPageProps {
  onBack: () => void
  onOpenSpecies: (speciesId: string) => void
}

type GroupKey = 'still' | 'flowing' | 'sea'

const GROUP_LABELS: Record<GroupKey, string> = {
  still: '湖库静水',
  flowing: '江河溪流',
  sea: '近海与河口',
}

const GROUP_ORDER: GroupKey[] = ['still', 'flowing', 'sea']

/** 归组只看「主要生活在哪儿」，一条鱼出现在两个分组里没有意义 */
function groupOf(entry: SpeciesEntry): GroupKey {
  if (entry.water.includes('sea')) return 'sea'
  // 静水、流水都行的（翘嘴、鳜鱼、大口黑鲈…）归到湖库，和用户平时下竿的场景更接近
  return entry.water.includes('still') ? 'still' : 'flowing'
}

export default function SpeciesListPage({ onBack, onOpenSpecies }: SpeciesListPageProps) {
  const [keyword, setKeyword] = useState('')

  const groups = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    const matched = query
      ? ALL_SPECIES.filter(
          (entry) =>
            entry.name.toLowerCase().includes(query) ||
            entry.scientificName.toLowerCase().includes(query) ||
            entry.aliases.some((alias) => alias.toLowerCase().includes(query)),
        )
      : ALL_SPECIES

    return GROUP_ORDER.map((key) => ({
      key,
      label: GROUP_LABELS[key],
      items: matched.filter((entry) => groupOf(entry) === key),
    })).filter((group) => group.items.length > 0)
  }, [keyword])

  const total = groups.reduce((sum, group) => sum + group.items.length, 0)

  return (
    <div className="species-list">
      <TopBar
        title="鱼类百科"
        subtitle={`共 ${ALL_SPECIES.length} 种，资料来自公开来源`}
        onBack={onBack}
      />

      <div className="species-search">
        <SearchIcon size={16} />
        <input
          className="species-search__input"
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜鱼名、学名或别名"
          aria-label="搜索鱼种"
        />
      </div>

      {total === 0 ? (
        <div className="species-list__empty">
          <p className="species-list__empty-title">没有找到匹配的鱼种</p>
          <p className="species-list__empty-hint">
            资料库只收录了常见路亚对象鱼。换个名字试试，或者清空关键词看看全部。
          </p>
          <button type="button" className="species-list__clear" onClick={() => setKeyword('')}>
            清空关键词
          </button>
        </div>
      ) : (
        groups.map((group) => (
          <section className="species-group" key={group.key}>
            <h2 className="species-group__title">
              {group.label}
              <span className="species-group__count">{group.items.length}</span>
            </h2>
            <ul className="species-group__list">
              {group.items.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="species-item"
                    onClick={() => onOpenSpecies(entry.id)}
                  >
                    <span className="species-item__icon" aria-hidden="true">
                      <FishIcon size={18} />
                    </span>
                    <span className="species-item__text">
                      <span className="species-item__name">{entry.name}</span>
                      <span className="species-item__sci">{entry.scientificName}</span>
                      {entry.aliases.length > 0 && (
                        <span className="species-item__alias">
                          别名：{entry.aliases.slice(0, 3).join('、')}
                        </span>
                      )}
                    </span>
                    <span className="species-item__diff">{entry.difficulty}</span>
                    <ChevronRightIcon size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <p className="species-list__foot">
        百科内容按公开资料整理，只作参考；没有可靠来源的内容不会收录。
      </p>
    </div>
  )
}
