#!/usr/bin/env node
/**
 * 校验「品牌 Logo 登记表」和「public/brand-logos/ 里的实际文件」是否一致。
 *
 * 为什么需要它：CREDITS.md 里写着「文件不存在就不要写 logo 字段」，
 * 但这条规则一直只靠自觉。一旦登记了不存在的文件，浏览器每次加载都会先发一个
 * 无效请求、解码失败之后才回退到文字占位，界面白闪一下（禧玛诺 / Rapala 踩过）。
 *
 * 顺带回答两个日常问题：目录里是不是有文件放进来却忘了登记？还有哪些品牌没有 Logo？
 *
 * 用法：npm run check:logos
 */
import { access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOGO_DIR = path.join(root, 'public', 'brand-logos')
/** public 下的路径前缀，与 brands.ts 里 logo.path 的写法一致 */
const LOGO_URL_PREFIX = '/brand-logos/'

// Node 24 能直接执行 .ts（类型擦除）。brands.ts 只 import type，运行时没有依赖，所以能这样读。
const { BRANDS } = await import(pathToFileURL(path.join(root, 'src', 'data', 'brands.ts')).href)

/**
 * 与 src/lib/brandLogo.ts 的 normalizeBrandKey 保持一致。
 * 那个文件在 Node 里没法直接 import（内部用的是 Vite 风格的无扩展名导入），
 * 所以这里复制一份，只用于查重。改判定规则时两处要一起改。
 */
function normalizeBrandKey(value) {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[（）()[\]【】「」『』《》<>·.、,，/\\|~—\-_+*'"“”]+/g, '')
}

const problems = []
const registered = []
const missingFile = []
const noLogo = []

// 一、登记了 logo 的品牌：路径要落在 public/brand-logos/ 下，且文件必须真的存在
for (const brand of BRANDS) {
  if (!brand.logo) {
    noLogo.push(brand)
    continue
  }
  const { path: logoPath } = brand.logo
  if (!logoPath.startsWith(LOGO_URL_PREFIX)) {
    problems.push(`${brand.id} 的 logo.path 是 ${logoPath}，Logo 应统一放在 ${LOGO_URL_PREFIX} 下`)
    continue
  }
  try {
    await access(path.join(root, 'public', logoPath.replace(/^\//, '')))
    registered.push({ brand, file: path.basename(logoPath) })
  } catch {
    missingFile.push(brand)
  }
}
for (const brand of missingFile) {
  problems.push(
    `${brand.id}（${brand.name}）登记了 ${brand.logo.path}，但文件不存在 —— 先别登记，界面会自动用文字占位`,
  )
}

// 二、目录里有哪些文件没被任何品牌登记（放进来却忘了关联）
const referenced = new Set(registered.map((r) => r.file))
const onDisk = (await readdir(LOGO_DIR)).filter(
  (name) => !name.startsWith('.') && !name.endsWith('.md'),
)
const unreferenced = onDisk.filter((name) => !referenced.has(name))

// 三、id 重复、或者同一个别名被两个品牌占用（匹配是按顺序取第一个，会变成隐式抢注）
const seenIds = new Map()
const seenAliases = new Map()
for (const brand of BRANDS) {
  if (seenIds.has(brand.id)) {
    problems.push(`品牌 id 重复：${brand.id}（${seenIds.get(brand.id)} 和 ${brand.name}）`)
  } else {
    seenIds.set(brand.id, brand.name)
  }
  for (const alias of brand.aliases) {
    const key = normalizeBrandKey(alias)
    if (!key) continue
    const owner = seenAliases.get(key)
    if (owner && owner.id !== brand.id) {
      problems.push(`别名「${alias}」同时被 ${owner.name} 和 ${brand.name} 占用`)
    } else {
      seenAliases.set(key, brand)
    }
  }
}

// 四、输出
console.log(`品牌登记表：${BRANDS.length} 个品牌\n`)

console.log(`已有真实 Logo（${registered.length} 个）`)
for (const { brand, file } of registered) {
  console.log(`  ✅ ${brand.name.padEnd(12, '　')} public/brand-logos/${file}`)
}

console.log(`\n暂无 Logo，界面显示文字占位（${noLogo.length} 个）`)
console.log('  ' + noLogo.map((b) => b.name).join('、'))

if (unreferenced.length > 0) {
  console.log(`\n⚠️  目录里有 ${unreferenced.length} 个文件没有登记到 src/data/brands.ts：`)
  for (const name of unreferenced) console.log(`  · ${name}`)
  console.log('  在 brands.ts 对应品牌上补一个 logo 字段即可（见 public/brand-logos/CREDITS.md 第四节）。')
}

if (problems.length > 0) {
  console.log(`\n❌ 发现 ${problems.length} 个问题：`)
  for (const p of problems) console.log(`  · ${p}`)
  process.exit(1)
}

console.log('\n✅ 登记表与文件一致。')
