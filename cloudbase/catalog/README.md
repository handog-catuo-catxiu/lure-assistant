# 官方装备图鉴：数据结构与 CSV 批量导入

这个目录只放「官方图鉴」的导入模板和说明，不包含任何真实产品数据，也不包含 AI 爬虫或管理后台。

目标是把未来从品牌官网、官方产品目录、授权经销商资料里整理出的数据，通过一个安全、可重复、默认不公开的入口进入 CloudBase PostgreSQL。

## 1. 数据分层

| 表 | 作用 | 对普通用户 |
| --- | --- | --- |
| `catalog_brands` | 品牌 | 公开读 |
| `catalog_series` | 品牌下的系列 | 公开读 |
| `catalog_gear` | 产品型号（路亚竿 / 渔轮 / 拟饵 / 周边） | 只读 `approved` 且未隐藏的行 |
| `catalog_gear_variants` | 同一型号的规格版本（长度 / 速比 / 颜色等） | 只读已发布且父产品已发布的规格 |
| `catalog_sources` | 每条资料的原始 URL、采集时间、来源类型、内容哈希 | 不对普通用户开放 |
| `catalog_import_batches` | 每次批量导入的文件名、行数、接受 / 拒绝数量 | 不对普通用户开放 |

关系：

```
catalog_brands 1 ── n catalog_series
catalog_brands 1 ── n catalog_gear
catalog_series 1 ── n catalog_gear
catalog_gear   1 ── n catalog_gear_variants
catalog_gear   1 ── n catalog_sources（逻辑关联，entity_type + entity_id）
```

个人装备表 `user_gears` 只保存可选的 `catalog_id`，不复制官方字段。官方资料更新或下架都不会覆盖、删除个人装备。

## 2. 稳定 ID 与去重

建议在 CSV 里显式提供：

- `brand_id`：例如 `brand-shimano`
- `series_id`：例如 `series-shimano-stella`
- `product_id`：例如 `gear-shimano-stella-2022`
- `variant_id`：例如 `var-stella-2022-c3000xg`

没有提供时，脚本会生成确定性的哈希 ID：

- 品牌：`brand-` + `sha256(小写品牌名)` 前 20 位
- 系列：`series-` + `sha256(brand_id|小写系列名)` 前 20 位
- 产品：`gear-` + `sha256(brand_id|series_id|category|model|name)` 前 20 位
- 规格：`var-` + `sha256(product_id|variant_key|variant_name)` 前 20 位

注意：自动生成的产品 ID 依赖这些字段。如果以后修改了型号或名称，会生成新的 ID，看起来像新产品。长期维护时建议显式写入 `product_id`，并在后续批次中保持不变。

去重规则：

- 同一份 CSV 重复执行，使用 `on conflict (id) do nothing`，不会产生重复品牌 / 系列 / 产品 / 规格。
- 同一个 `product_id` 可以出现多行，用 `variant_*` 列描述不同规格。
- 同一 `product_id` 的多行必须保持产品级字段一致（品牌、系列、分类、型号、名称、规格、描述、图片、来源等），否则该行会被拒绝。只有 `variant_*` 和 `collected_at` 可以不同。
- 同一个产品下 `variant_key` 不能重复；`variant_id` 也不能被多个产品复用。

## 3. 校验规则

脚本不会连接数据库，只读取 CSV 并生成 SQL。以下情况整行拒绝：

- 缺少 `brand_name`、`name`、`category`、`source_url`
- `category` 不是 `rod` / `reel` / `lure` / `accessory`
- `source_url`、`image_url`、`image_source_url` 不是完整的 `https://` 地址
- 提供了 `image_url` 或 `image_path`，但 `image_license_status` 不是
  `authorized` / `official_press` / `licensed`
- `spec_json` / `variant_spec_json` 不是 JSON 对象
- `status` / `variant_status` 非法
- `image_path` 以 `/` 开头或包含 `..`

被拒绝的行会写入 `<输出文件名>.rejected.json`，包含原始行号和原因，方便修正后重新导入。被拒绝的行不会进入 SQL。

## 4. 图片授权

数据库有一条检查约束：

> 只要 `image_path` 或 `image_url` 非空，`image_license_status` 必须是
> `authorized`、`official_press` 或 `licensed`。

`unknown` 和 `not_allowed` 的图片不能写入。

推荐流程：

1. 先只导入文字资料，图片字段留空。
2. 拿到品牌方书面授权、官方新闻素材许可或明确授权后，再单独更新图片字段。
3. 官方图鉴图片放在公开读桶 `luremate-catalog`，只有服务端 / 管理员能上传；客户端没有写权限。
4. 不要默认抓取第三方电商图、社交媒体图并直接发布。

## 5. 批量导入步骤

```bash
# 1. 复制模板，填入数据（模板只有表头，避免把示例当成真实产品）
cp cloudbase/catalog/catalog.template.csv cloudbase/catalog/catalog.csv

# 2. 只做校验和统计，不生成文件
node scripts/import-catalog-csv.mjs \
  --input cloudbase/catalog/catalog.csv \
  --dry-run

# 3. 生成 SQL（不执行）
node scripts/import-catalog-csv.mjs \
  --input cloudbase/catalog/catalog.csv \
  --out cloudbase/sql/catalog_import.generated.sql \
  --batch-label "2026-10 秋季新品"

# 4. 人工检查生成的 SQL
#    确认品牌、型号、来源 URL、图片授权、拒绝明细都正确
```

生成的 SQL 包含：

- 一条 `catalog_import_batches` 批次记录
- 品牌、系列、产品、规格的 `insert ... on conflict`
- 来源记录 `catalog_sources`
- 文件末尾注释形式的「人工审核后发布」示例

脚本永远不会自动执行 SQL，也不会连接 CloudBase。

### 增量更新

默认模式只新增，不修改已有记录。

如果需要更新已存在的产品（例如修正规格、补充描述），加 `--update`：

```bash
node scripts/import-catalog-csv.mjs \
  --input cloudbase/catalog/catalog.csv \
  --out cloudbase/sql/catalog_update.generated.sql \
  --update
```

`--update` 会把被更新的产品 / 规格重新置为 `pending_review`，并清空 `verified_at`。这是故意的：任何字段变化都要重新审核，不能悄悄改掉已经发布的内容。

### 执行 SQL

执行需要高权限，只能在服务端 / 控制台进行，**不要把数据库管理员密码或 Service Role 密钥放进前端或 GitHub Actions**。

本仓库不自动执行。等你确认生成的 SQL 后，可以用 CloudBase CLI 以 `postgres` 角色执行（具体命令在最终报告中给出），或在控制台 SQL 编辑器里执行。

## 6. 审核与发布

导入后的数据全部是 `pending_review`，普通用户看不到。

审核队列查询：

```sql
select id, brand_name, series_name, model, name, category,
       source_url, collected_at, review_note
  from public.catalog_gear
 where review_status = 'pending_review'
 order by collected_at desc nulls last
 limit 100;
```

人工确认来源和图片授权后，用受控函数发布：

```sql
-- 通过
select public.catalog_publish_gear(array['gear-xxxxxxxx'], '审核人');

-- 驳回并写明原因
select public.catalog_reject_gear(
  array['gear-xxxxxxxx'],
  '官方页面已查不到该型号，待补充来源'
);

-- 规格必须在父产品发布后单独发布
select public.catalog_publish_variants(array['var-xxxxxxxx']);
```

函数在 `security definer` 下执行，但会先检查 `public.is_catalog_admin()`。普通登录用户即使知道函数名也无法调用。管理员身份来自服务端签发的 JWT `app_metadata.role = catalog_admin`，客户端不能自行伪造。

也可以通过 `tcb db execute --role postgres` 以数据库管理员身份直接执行这些函数或 SQL。管理员操作不经过前端。

## 7. CSV 字段

| 列 | 必需 | 说明 |
| --- | --- | --- |
| `brand_id` | 否 | 稳定品牌 ID；不填则按品牌名生成 |
| `brand_name` | 是 | 品牌名 |
| `brand_name_en` | 否 | 品牌英文名 |
| `brand_country` | 否 | 品牌国家 / 地区 |
| `brand_website` | 否 | 品牌官网 |
| `brand_logo_path` | 否 | `luremate-catalog` 桶内相对路径 |
| `brand_sort_order` | 否 | 排序，默认 1000 |
| `series_id` | 否 | 稳定系列 ID |
| `series_name` | 否 | 系列名；填了系列就需要 |
| `series_description` | 否 | 系列说明 |
| `series_sort_order` | 否 | 排序，默认 1000 |
| `product_id` | 否 | 稳定产品 ID；长期维护建议填写 |
| `category` | 是 | `rod` / `reel` / `lure` / `accessory` |
| `model` | 否 | 型号，例如 `C3000XG` |
| `name` | 是 | 产品名称 |
| `spec_json` | 否 | JSON 对象，例如 `{"length":"2.1m","power":"ML"}` |
| `description` | 否 | 产品说明 |
| `official_source` | 否 | 官方来源名称 |
| `source_url` | 是 | 产品原始资料页，必须 https；审核通过后仍会保留 |
| `source_type` | 否 | `official_website` / `official_catalog_pdf` / `authorized_distributor` / `press_kit` / `manual` / `other` |
| `collected_at` | 否 | ISO 时间；不填用当前时间 |
| `image_url` | 否 | 授权图片外链，必须 https |
| `image_path` | 否 | 官方图鉴桶内路径 |
| `image_credit` | 否 | 图片署名 |
| `image_license` | 否 | 授权说明 |
| `image_license_status` | 有图片时必需 | `authorized` / `official_press` / `licensed` |
| `image_source_url` | 否 | 图片原始页面 |
| `status` | 否 | `active` / `discontinued` / `hidden`，默认 `active` |
| `sort_order` | 否 | 排序，默认 1000 |
| `variant_id` | 否 | 规格稳定 ID |
| `variant_name` | 否 | 规格显示名 |
| `variant_key` | 否 | 规格唯一键，同一产品内不能重复；默认 `default` |
| `variant_spec_json` | 否 | 规格 JSON 对象 |
| `variant_sku` | 否 | SKU |
| `variant_barcode` | 否 | 条码 |
| `variant_source_url` | 否 | 规格来源 |
| `variant_status` | 否 | `active` / `discontinued` / `hidden` |
| `variant_sort_order` | 否 | 排序，默认 1000 |

列名大小写不敏感。未列出的字段会被忽略。

## 8. 扩充品牌和装备类型

- 新品牌、新系列只是新增行，不需要改表结构。
- 新装备类型需要修改 `catalog_gear.category` 的检查约束，并同步修改前端 `GearCategory` 类型和展示文案。这是有意的白名单，避免采集脚本把任意字符串写进分类。
- 产品与规格分层后，新增颜色 / 尺寸 / 速比只需要新增 `catalog_gear_variants` 行。
- 未来管理后台可以直接调用本目录的导入 SQL 和审核函数，不需要重新设计表。

## 9. 成本

这些表和索引都很小。图片放在对象存储，主要成本是存储和下行流量；PostgreSQL 只保存文本、规格 JSON 和图片路径。批量导入本身不产生额外云服务费用。
