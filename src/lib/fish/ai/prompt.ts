/**
 * 提示词。规则写得很死，目的只有一个：**不给 AI 编鱼种的机会**。
 *
 * - 候选列表是唯一的可选集合，提示词里反复强调「只能从这里选」；
 * - 要求输出严格的 JSON，且只允许 speciesId / rating / reason / tip 四个字段；
 * - 返回后再用 parse.ts 逐条校验（id 必须在候选里、rating 必须在白名单里），
 *   任何一条对不上就让这次 AI 结果作废，退回本地规则。
 *
 * 提示词里不放任何密钥，也不放用户的原始坐标精度 —— 只给到城市/钓点级的描述。
 */
import type { Grounding } from './grounding'

/** 服务端用这句话确认「这是我们自己的推荐请求」，防止被当成通用大模型代理 */
export const AI_PROMPT_TAG = 'LureMate::fish-advice::v1'

export interface AdviceMessages {
  system: string
  user: string
}

const RESPONSE_SHAPE = `{"regionNote":"一句话区域鱼情概述","items":[{"speciesId":"候选里的 id","rating":"high|mid|low","reason":"理由","tip":"操作建议"}]}`

function systemPrompt(): string {
  return [
    `你是 LureMate 的路亚顾问，只服务中国大陆的休闲路亚钓友。${AI_PROMPT_TAG}`,
    '',
    '【最重要的规则】',
    '1. 只能从用户给出的候选鱼种列表里挑选，speciesId 必须原样照抄列表里的 id。',
    '   列表之外的中国鱼种、外来鱼种，一律不许出现，也不许把 id 改成别的写法。',
    '2. 不要推荐列表里没有的鱼，不要编造新的鱼。如果觉得候选都不合适，就少选几条。',
    '3. 候选 3 条以上时选 3–4 条；候选不足 3 条时把它们全部列出。',
    '',
    '【判断要求】',
    '4. 必须结合：用户所在地区、当前月份与季节、实时天气（气温/天气现象/风力）、水域类型，',
    '   以及每条候选自带的当地分布与习性。理由里要能对上这些真实数值。',
    '5. 不确定就降低 rating，不要为了凑数把不合适的鱼放进推荐。',
    '6. 不许出现「保证上鱼」「一定能钓到」「必爆护」这类话术；钓鱼本来就有运气成分。',
    '',
    '【输出格式】',
    '7. 只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字。',
    `8. JSON 结构固定为：${RESPONSE_SHAPE}`,
    '9. rating 只能是 high（当前条件最值得去试）、mid（可以关注）、low（条件一般）。',
    '10. reason 不超过 60 个字，说清「为什么现在、在这个地方值得钓它」。',
    '11. tip 不超过 40 个字，给一句能马上执行的操作建议（拟饵、手法或钓位）。',
    '12. regionNote 不超过 50 个字，描述这片水域当下的整体鱼情；拿不准就写空字符串。',
  ].join('\n')
}

function weatherLine(grounding: Grounding): string {
  const w = grounding.weather
  if (!w) return '天气数据暂时取不到：只能按季节、纬度与水域类型判断，理由里请写明这一点。'
  const bits: string[] = [`气温 ${Math.round(w.temperatureC)}℃`]
  if (w.apparentC !== null) bits.push(`体感 ${Math.round(w.apparentC)}℃`)
  if (w.humidityPercent !== null) bits.push(`湿度 ${Math.round(w.humidityPercent)}%`)
  if (w.windDirection || w.windPower !== null) {
    bits.push(`${w.windDirection ?? ''}风 ${w.windPower ?? '—'} 级`)
  }
  if (w.precipitationMm !== null) bits.push(`近一小时降水 ${w.precipitationMm.toFixed(1)} mm`)
  return `${w.condition} · ${bits.join(' · ')}`
}

function candidateBlock(grounding: Grounding): string {
  return grounding.candidates
    .map((item, index) => {
      const lines = [
        `${index + 1}. ${item.id} ${item.name}${item.scientificName ? `（${item.scientificName}）` : ''}`,
      ]
      if (item.aliases.length > 0) lines.push(`   别名：${item.aliases.join('、')}`)
      lines.push(`   中国大陆分布：${item.distribution}`)
      lines.push(`   习性与食性：${item.habitat}；${item.diet}`)
      lines.push(`   当前季节（${grounding.seasonLabel}）：${item.currentSeason}`)
      if (item.sizeText) lines.push(`   常见体型：${item.sizeText}`)
      lines.push(`   常规玩法：${item.lures.join('、')}；钓位：${item.spots}`)
      if (item.difficulty) lines.push(`   路亚难度：${item.difficulty}`)
      if (item.ruleReasons.length > 0) {
        lines.push(`   本地规则算出的依据：${item.ruleReasons.join('；')}`)
      }
      return lines.join('\n')
    })
    .join('\n')
}

function userPrompt(grounding: Grounding): string {
  const { place } = grounding
  const scopeText =
    place.scope === 'spot'
      ? `具体钓点「${place.label}」`
      : `大致区域「${place.label}」（用户尚未选定具体钓点，按区域鱼情参考来分析）`

  return [
    '【位置】',
    `${scopeText}，坐标约 ${place.latitude.toFixed(2)}, ${place.longitude.toFixed(2)}`,
    '',
    '【时间】',
    `${grounding.todayLabel} · ${grounding.month} 月 · ${grounding.seasonLabel}季`,
    '',
    '【天气】',
    weatherLine(grounding),
    '',
    '【水域类型】',
    grounding.waterLabel,
    '',
    '【本地判断依据】',
    grounding.lines.join('\n'),
    '',
    `【候选鱼种（只能从这里选，共 ${grounding.candidates.length} 条）】`,
    candidateBlock(grounding),
    '',
    '请按上面的 JSON 结构给出推荐。',
  ].join('\n')
}

export function buildAdviceMessages(grounding: Grounding): AdviceMessages {
  return { system: systemPrompt(), user: userPrompt(grounding) }
}
