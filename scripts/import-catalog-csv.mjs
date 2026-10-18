#!/usr/bin/env node
/**
 * 官方装备图鉴 CSV 批量导入（只生成 SQL，不连数据库、不执行）。
 *
 * 这个脚本是给「未来 AI 批量采集 + 人工审核」准备的安全入口：
 * - 批量读取合规来源整理出的 CSV
 * - 校验字段、来源 URL、图片授权状态
 * - 用稳定 id 去重，同一份 CSV 重复执行不会产生重复产品
 * - 所有导入数据一律写成 review_status = 'pending_review'
 *   在人工核实并单独执行发布 SQL 之前，RLS 不会让普通用户看到
 * - 默认 ON CONFLICT DO NOTHING；只有显式 --update 才更新已有记录，
 *   并且更新会把记录重新置为 pending_review，重新走审核
 *
 * 用法：
 *   node scripts/import-catalog-csv.mjs \
 *     --input cloudbase/catalog/catalog.csv \
 *     --out cloudbase/sql/catalog_import.generated.sql
 *
 * 可选：
 *   --update        允许更新已存在的品牌/系列/产品/规格（会重新进入待审核）
 *   --dry-run       只输出统计，不写 SQL 文件
 *   --batch-label   批次备注，例如 "2026-10 秋季新品"
 *   --out -         把 SQL 打到标准输出
 *
 * 不支持的字段会被忽略；缺少必需字段、来源不是 https、图片未授权时，
 * 对应行会被拒绝并写入 <out>.rejected.json，不会进入 SQL。
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const CATEGORIES = new Set(['rod', 'reel', 'lure', 'accessory'])
const IMAGE_LICENSES = new Set([
  'authorized',
  'official_press',
  'licensed',
])
// 与数据库 catalog_gear_image_license_status_check 保持一致。
// 即使是空图片行，也不允许写入拼错的列值（常见于 CSV 少了一个逗号）。
const IMAGE_LICENSE_STATUSES = new Set([
  'unknown',
  'authorized',
  'official_press',
  'licensed',
  'not_allowed',
])
const STATUSES = new Set(['active', 'discontinued', 'hidden'])
const SOURCE_TYPES = new Set([
  'official_website',
  'official_catalog_pdf',
  'authorized_distributor',
  'press_kit',
  'manual',
  'other',
])

function parseArgs(argv) {
  const args = {
    input: 'cloudbase/catalog/catalog.csv',
    out: 'cloudbase/sql/catalog_import.generated.sql',
    update: false,
    dryRun: false,
    batchLabel: '',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--input') args.input = argv[++i]
    else if (arg === '--out') args.out = argv[++i]
    else if (arg === '--update') args.update = true
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--batch-label') args.batchLabel = argv[++i] ?? ''
    else if (arg === '--help' || arg === '-h') args.help = true
    else throw new Error(`未知参数：${arg}`)
  }
  return args
}

function printHelp() {
  console.log(`用法：
  node scripts/import-catalog-csv.mjs --input <csv> [--out <sql>] [--update] [--dry-run]

CSV 必需列：
  brand_name, category, name, source_url

推荐列：
  brand_id, brand_name_en, series_id, series_name, product_id,
  model, spec_json, description, official_source, source_type, collected_at,
  image_url, image_path, image_credit, image_license, image_license_status,
  image_source_url, status, sort_order,
  variant_id, variant_name, variant_key, variant_spec_json,
  variant_sku, variant_barcode

说明：
  product_id / variant_id 建议显式提供；不提供时会根据品牌+系列+型号等生成稳定 id。
  同一 product_id 可以有多行，用 variant_* 列描述不同规格版本。
  所有导入记录都会进入 pending_review，人工核实后才能发布。`)
}

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') inQuotes = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function clean(value) {
  return String(value ?? '').trim()
}

function hash(value, length = 20) {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

function sql(value) {
  if (value === null || value === undefined) return 'null'
  return `'${String(value).replace(/'/g, "''")}'`
}

function sqlJson(value) {
  return `${sql(JSON.stringify(value))}::jsonb`
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname)
  } catch {
    return false
  }
}

function parseJsonObject(value, fieldName) {
  const text = clean(value)
  if (!text) return {}
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${fieldName} 不是合法 JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${fieldName} 必须是 JSON 对象`)
  }
  return parsed
}

function safePath(value) {
  const text = clean(value)
  if (!text) return null
  if (text.startsWith('/') || text.includes('..') || text.includes('\\')) {
    throw new Error('image_path 必须是桶内相对路径，不能以 / 开头或包含 ..')
  }
  return text
}

function toInt(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback
  const number = Number(value)
  if (!Number.isInteger(number)) throw new Error(`需要整数：${value}`)
  return number
}

function buildProducts(rows, headers) {
  const products = new Map()
  const brands = new Map()
  const series = new Map()
  const variantIds = new Map()
  const rejected = []
  let acceptedRows = 0

  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index]
    if (raw.every((cell) => clean(cell) === '')) continue
    const line = index + 2 // 表头占第 1 行
    const record = {}
    headers.forEach((header, column) => {
      record[header] = clean(raw[column])
    })

    try {
      const brandName = clean(record.brand_name)
      const name = clean(record.name)
      const category = clean(record.category)
      const sourceUrl = clean(record.source_url)

      if (!brandName) throw new Error('缺少 brand_name')
      if (!name) throw new Error('缺少 name')
      if (!CATEGORIES.has(category)) {
        throw new Error(`category 必须是 rod / reel / lure / accessory`)
      }
      if (!isHttpsUrl(sourceUrl)) {
        throw new Error('source_url 必须是完整的 https 地址')
      }

      let sourceType = clean(record.source_type) || 'official_website'
      if (!SOURCE_TYPES.has(sourceType)) sourceType = 'other'

      const imageLicenseStatus =
        clean(record.image_license_status) || 'unknown'
      if (!IMAGE_LICENSE_STATUSES.has(imageLicenseStatus)) {
        throw new Error(
          'image_license_status 必须是 unknown / authorized / official_press / licensed / not_allowed',
        )
      }
      const imageUrl = clean(record.image_url) || null
      const imagePath = safePath(record.image_path)
      if ((imageUrl || imagePath) && !IMAGE_LICENSES.has(imageLicenseStatus)) {
        throw new Error(
          '存在图片但 image_license_status 未标记为 authorized / official_press / licensed',
        )
      }
      if (imageUrl && !isHttpsUrl(imageUrl)) {
        throw new Error('image_url 必须是 https 地址')
      }
      if (clean(record.image_source_url) && !isHttpsUrl(record.image_source_url)) {
        throw new Error('image_source_url 必须是 https 地址')
      }

      const spec = parseJsonObject(record.spec_json, 'spec_json')
      const status = clean(record.status) || 'active'
      if (!STATUSES.has(status)) throw new Error('status 不合法')

      const brandId =
        clean(record.brand_id) || `brand-${hash(brandName.toLowerCase())}`
      const existingBrand = brands.get(brandId)
      if (existingBrand && existingBrand.name !== brandName) {
        throw new Error(`brand_id ${brandId} 对应了两个不同品牌名`)
      }
      brands.set(brandId, {
        id: brandId,
        name: brandName,
        name_en: clean(record.brand_name_en),
        country: clean(record.brand_country) || null,
        website: clean(record.brand_website) || null,
        logo_path: safePath(record.brand_logo_path),
        sort_order: toInt(record.brand_sort_order, 1000),
      })

      const seriesName = clean(record.series_name)
      const seriesId =
        clean(record.series_id) ||
        (seriesName
          ? `series-${hash(`${brandId}|${seriesName.toLowerCase()}`)}`
          : null)
      if (seriesId) {
        if (!seriesName) throw new Error('提供了 series_id 但没有 series_name')
        const existingSeries = series.get(seriesId)
        if (existingSeries && existingSeries.name !== seriesName) {
          throw new Error(`series_id ${seriesId} 对应了两个不同系列名`)
        }
        series.set(seriesId, {
          id: seriesId,
          brand_id: brandId,
          name: seriesName,
          description: clean(record.series_description),
          sort_order: toInt(record.series_sort_order, 1000),
        })
      }

      const productId =
        clean(record.product_id) ||
        `gear-${hash(
          [
            brandId,
            seriesId ?? '',
            category,
            clean(record.model),
            name,
          ].join('|'),
        )}`

      const productCore = {
        id: productId,
        brand_id: brandId,
        brand_name: brandName,
        series_id: seriesId,
        series_name: seriesName,
        category,
        model: clean(record.model),
        name,
        spec,
        description: clean(record.description),
        image_path: imagePath,
        image_url: imageUrl,
        image_credit: clean(record.image_credit),
        image_license: clean(record.image_license),
        image_license_status: imageLicenseStatus,
        image_source_url: clean(record.image_source_url) || null,
        official_source: clean(record.official_source) || brandName,
        source_url: sourceUrl,
        source_type: sourceType,
        collected_at: clean(record.collected_at) || new Date().toISOString(),
        status,
        sort_order: toInt(record.sort_order, 1000),
      }

      const variantName = clean(record.variant_name)
      const variantKey = clean(record.variant_key) || 'default'
      const hasVariant =
        Boolean(variantName) ||
        variantKey !== 'default' ||
        Boolean(clean(record.variant_spec_json)) ||
        Boolean(clean(record.variant_sku)) ||
        Boolean(clean(record.variant_barcode))

      const variant = hasVariant
        ? {
            id:
              clean(record.variant_id) ||
              `var-${hash(`${productId}|${variantKey}|${variantName}`)}`,
            gear_id: productId,
            name: variantName || variantKey,
            variant_key: variantKey,
            spec: parseJsonObject(
              record.variant_spec_json,
              'variant_spec_json',
            ),
            sku: clean(record.variant_sku) || null,
            barcode: clean(record.variant_barcode) || null,
            source_url: clean(record.variant_source_url) || sourceUrl,
            collected_at: clean(record.collected_at) || new Date().toISOString(),
            status: clean(record.variant_status) || status,
            sort_order: toInt(record.variant_sort_order, 1000),
          }
        : null

      if (variant && !STATUSES.has(variant.status)) {
        throw new Error('variant_status 不合法')
      }
      if (variant) {
        const owner = variantIds.get(variant.id)
        if (owner && (owner.gearId !== productId || owner.key !== variantKey)) {
          throw new Error(
            `variant_id ${variant.id} 被多个产品/规格重复使用`,
          )
        }
        variantIds.set(variant.id, { gearId: productId, key: variantKey })
      }

      const existing = products.get(productId)
      if (!existing) {
        products.set(productId, {
          core: productCore,
          variants: new Map(),
          sourceUrls: new Map(),
        })
      } else {
        const previous = withoutVolatile(existing.core)
        const current = withoutVolatile(productCore)
        if (JSON.stringify(previous) !== JSON.stringify(current)) {
          throw new Error('同一 product_id 的核心字段前后不一致')
        }
      }

      const product = products.get(productId)
      if (variant) {
        const seenVariant = product.variants.get(variant.variant_key)
        if (seenVariant && seenVariant.id !== variant.id) {
          throw new Error(`同一产品的 variant_key ${variant.variant_key} 重复`)
        }
        product.variants.set(variant.variant_key, variant)
      }

      const sourceId = `src-${hash(
        `${'gear'}|${productId}|${sourceUrl}`,
      )}`
      product.sourceUrls.set(sourceId, {
        id: sourceId,
        entity_type: 'gear',
        entity_id: productId,
        source_url: sourceUrl,
        source_type: sourceType,
        collected_at: productCore.collected_at,
        content_hash: hash(JSON.stringify(productCore), 64),
      })

      if (clean(record.image_source_url)) {
        const imageSourceId = `src-${hash(
          `${'gear'}|${productId}|${clean(record.image_source_url)}`,
        )}`
        product.sourceUrls.set(imageSourceId, {
          id: imageSourceId,
          entity_type: 'gear',
          entity_id: productId,
          source_url: clean(record.image_source_url),
          source_type: 'press_kit',
          collected_at: productCore.collected_at,
          content_hash: null,
        })
      }

      acceptedRows += 1
    } catch (error) {
      rejected.push({ line, reason: error.message, row: record })
    }
  }

  return { products, brands, series, rejected, acceptedRows }
}

function withoutVolatile(core) {
  const copy = { ...core }
  delete copy.collected_at
  delete copy.source_url
  delete copy.source_type
  delete copy.official_source
  return copy
}

function conflictClause(updateColumns) {
  if (updateColumns.length === 0) return 'on conflict (id) do nothing'
  return `on conflict (id) do update set ${updateColumns
    .map((column) => `${column} = excluded.${column}`)
    .join(', ')}, updated_at = now()`
}

function buildSql({
  products,
  brands,
  series,
  acceptedRows,
  rejected,
  batchLabel,
  batchId,
  fileName,
  update,
}) {
  const lines = []
  const now = new Date().toISOString()

  lines.push('-- ============================================================================')
  lines.push('-- 由 scripts/import-catalog-csv.mjs 生成。')
  lines.push(`-- 生成时间：${now}`)
  lines.push(`-- 批次：${batchId}${batchLabel ? `（${batchLabel}）` : ''}`)
  lines.push(`-- CSV 接受行：${acceptedRows}；拒绝行：${rejected.length}`)
  lines.push('--')
  lines.push('-- 所有记录默认 review_status = pending_review，普通用户在审核发布前看不到。')
  lines.push('-- 人工核实来源和图片授权后，再单独执行发布 SQL（见文件末尾注释）。')
  lines.push('-- ============================================================================')
  lines.push('')
  lines.push('begin;')
  lines.push('')
  lines.push(
    `insert into public.catalog_import_batches (id, file_name, total_rows, accepted_rows, rejected_rows, status, notes)
values (${sql(batchId)}, ${sql(fileName)}, ${acceptedRows + rejected.length}, ${acceptedRows}, ${rejected.length}, 'imported', ${sql(batchLabel)})
on conflict (id) do nothing;`,
  )
  lines.push('')

  for (const brand of brands.values()) {
    lines.push(
      `insert into public.catalog_brands (id, name, name_en, country, website, logo_path, sort_order)
values (${sql(brand.id)}, ${sql(brand.name)}, ${sql(brand.name_en)}, ${sql(brand.country)}, ${sql(brand.website)}, ${sql(brand.logo_path)}, ${brand.sort_order})
${conflictClause(update ? ['name', 'name_en', 'country', 'website', 'logo_path', 'sort_order'] : [])};`,
    )
  }
  lines.push('')

  for (const item of series.values()) {
    lines.push(
      `insert into public.catalog_series (id, brand_id, name, description, sort_order)
values (${sql(item.id)}, ${sql(item.brand_id)}, ${sql(item.name)}, ${sql(item.description)}, ${item.sort_order})
${conflictClause(update ? ['brand_id', 'name', 'description', 'sort_order'] : [])};`,
    )
  }
  lines.push('')

  for (const product of products.values()) {
    const core = product.core
    const hasVariants = product.variants.size > 0
    const reviewReset = update
      ? `review_status = 'pending_review', review_note = '', verified_at = null, verified_by = '', image_verified_at = null`
      : ''
    const columns = [
      'id',
      'brand_id',
      'brand_name',
      'series_id',
      'series_name',
      'category',
      'model',
      'name',
      'spec',
      'description',
      'image_path',
      'image_url',
      'image_credit',
      'image_license',
      'image_license_status',
      'image_source_url',
      'official_source',
      'source_url',
      'collected_at',
      'review_status',
      'status',
      'has_variants',
      'sort_order',
    ]
    const values = [
      sql(core.id),
      sql(core.brand_id),
      sql(core.brand_name),
      sql(core.series_id),
      sql(core.series_name),
      sql(core.category),
      sql(core.model),
      sql(core.name),
      sqlJson(core.spec),
      sql(core.description),
      sql(core.image_path),
      sql(core.image_url),
      sql(core.image_credit),
      sql(core.image_license),
      sql(core.image_license_status),
      sql(core.image_source_url),
      sql(core.official_source),
      sql(core.source_url),
      `${sql(core.collected_at)}::timestamptz`,
      `'pending_review'`,
      sql(core.status),
      hasVariants ? 'true' : 'false',
      core.sort_order,
    ]

    if (update) {
      lines.push(
        `insert into public.catalog_gear (${columns.join(', ')})
values (${values.join(', ')})
on conflict (id) do update set ${columns
          .filter((column) => column !== 'id' && column !== 'review_status')
          .map((column) => `${column} = excluded.${column}`)
          .join(', ')}, ${reviewReset}, updated_at = now();`,
      )
    } else {
      lines.push(
        `insert into public.catalog_gear (${columns.join(', ')})
values (${values.join(', ')})
on conflict (id) do nothing;`,
      )
    }
  }
  lines.push('')

  for (const product of products.values()) {
    for (const variant of product.variants.values()) {
      const columns = [
        'id',
        'gear_id',
        'name',
        'variant_key',
        'spec',
        'sku',
        'barcode',
        'source_url',
        'collected_at',
        'review_status',
        'status',
        'sort_order',
      ]
      const values = [
        sql(variant.id),
        sql(variant.gear_id),
        sql(variant.name),
        sql(variant.variant_key),
        sqlJson(variant.spec),
        sql(variant.sku),
        sql(variant.barcode),
        sql(variant.source_url),
        `${sql(variant.collected_at)}::timestamptz`,
        `'pending_review'`,
        sql(variant.status),
        variant.sort_order,
      ]
      if (update) {
        lines.push(
          `insert into public.catalog_gear_variants (${columns.join(', ')})
values (${values.join(', ')})
on conflict (id) do update set ${columns
            .filter((column) => column !== 'id' && column !== 'review_status')
            .map((column) => `${column} = excluded.${column}`)
            .join(', ')}, review_status = 'pending_review', review_note = '', verified_at = null, updated_at = now();`,
        )
      } else {
        lines.push(
          `insert into public.catalog_gear_variants (${columns.join(', ')})
values (${values.join(', ')})
on conflict (id) do nothing;`,
        )
      }
    }
  }
  lines.push('')

  for (const product of products.values()) {
    for (const source of product.sourceUrls.values()) {
      lines.push(
        `insert into public.catalog_sources (id, entity_type, entity_id, source_url, source_type, collected_at, content_hash, batch_id)
values (${sql(source.id)}, ${sql(source.entity_type)}, ${sql(source.entity_id)}, ${sql(source.source_url)}, ${sql(source.source_type)}, ${sql(source.collected_at)}::timestamptz, ${sql(source.content_hash)}, ${sql(batchId)})
on conflict (id) do nothing;`,
      )
    }
  }

  lines.push('')
  lines.push('commit;')
  lines.push('')
  lines.push('-- ----------------------------------------------------------------------------')
  lines.push('-- 人工审核通过后，单独执行类似下面的语句（本脚本不会自动发布）：')
  lines.push('-- update public.catalog_gear')
  lines.push("--    set review_status = 'approved', verified_at = now(), verified_by = '审核人'")
  lines.push("--  where id in ('gear-xxxx');")
  lines.push('-- update public.catalog_gear_variants')
  lines.push("--    set review_status = 'approved', verified_at = now()")
  lines.push("--  where gear_id in ('gear-xxxx');")
  lines.push('-- ----------------------------------------------------------------------------')

  return lines.join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const inputPath = resolve(args.input)
  const csv = readFileSync(inputPath, 'utf8')
  const table = parseCsv(csv)
  if (table.length === 0) throw new Error('CSV 是空的')

  // 列名大小写不敏感，方便 AI / 表格工具导出
  const headers = table[0].map((header) => clean(header).toLowerCase())
  const required = ['brand_name', 'category', 'name', 'source_url']
  const missing = required.filter((header) => !headers.includes(header))
  if (missing.length > 0) {
    throw new Error(`CSV 缺少必需列：${missing.join(', ')}`)
  }

  const result = buildProducts(table.slice(1), headers)
  const batchId = `batch-${new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14)}-${hash(
    String(result.acceptedRows) + String(result.rejected.length) + String(Date.now()),
    6,
  )}`

  const summary = {
    input: inputPath,
    brands: result.brands.size,
    series: result.series.size,
    products: result.products.size,
    variants: [...result.products.values()].reduce(
      (sum, product) => sum + product.variants.size,
      0,
    ),
    acceptedRows: result.acceptedRows,
    rejectedRows: result.rejected.length,
    updateMode: args.update,
    output: args.dryRun ? null : args.out,
  }

  if (result.rejected.length > 0) {
    console.warn(`有 ${result.rejected.length} 行未通过校验，未写入 SQL。`)
  }

  if (args.dryRun) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }

  const sqlText = buildSql({
    ...result,
    batchLabel: args.batchLabel,
    batchId,
    fileName: basename(inputPath),
    update: args.update,
  })

  if (args.out === '-') {
    process.stdout.write(sqlText)
    return
  }

  const outPath = resolve(args.out)
  writeFileSync(outPath, sqlText, 'utf8')
  console.log(JSON.stringify({ ...summary, batchId }, null, 2))

  if (result.rejected.length > 0) {
    const reportPath = outPath.replace(/\.sql$/i, '') + '.rejected.json'
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          input: inputPath,
          generatedAt: new Date().toISOString(),
          rejected: result.rejected,
        },
        null,
        2,
      ),
      'utf8',
    )
    console.log(`拒绝明细：${reportPath}`)
  }
}

try {
  main()
} catch (error) {
  console.error(`导入失败：${error.message}`)
  process.exitCode = 1
}
