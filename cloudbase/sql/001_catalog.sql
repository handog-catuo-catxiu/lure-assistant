-- ============================================================================
-- LureMate 官方装备图鉴（公开只读）
--
-- 目标：
-- * 官方资料与个人装备完全分开，所有用户共享一份，不复制进个人账号
-- * 品牌 / 系列 / 产品型号 / 规格版本分层，方便以后扩充
-- * 每个产品、规格版本都有稳定 id
-- * 记录原始来源 URL、采集时间、核实时间、审核状态
-- * 只有 review_status = 'approved' 且未隐藏的数据对普通用户可见
-- * 图片必须标记授权状态；未授权的图片不允许写入数据库
-- * 普通用户只读；管理员通过 JWT 中的 catalog_admin 角色写入
--
-- 本文件只生成变更内容，不自动执行。确认后再由你授权执行。
-- ============================================================================

-- pg_trgm 用于加速「包含关键词」的模糊搜索。
-- 如果当前数据库角色没有扩展权限，下面的索引会自动跳过，查询仍然可用（只是稍慢）。
do $$
begin
  begin
    create extension if not exists pg_trgm;
  exception when others then
    raise notice 'pg_trgm 不可用，跳过模糊搜索索引：%', sqlerrm;
  end;
end;
$$;

-- 统一维护 updated_at（与个人数据表共用）
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 只有服务端签发的 JWT 才能带 app_metadata.role，普通用户无法自行伪造
create or replace function public.is_catalog_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'catalog_admin';
$$;

/* ------------------------------- 品牌 ------------------------------- */

create table if not exists public.catalog_brands (
  id text primary key,
  name text not null,
  name_en text not null default '',
  country text,
  website text,
  logo_path text,
  sort_order integer not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.catalog_brands is '官方装备品牌。id 稳定，后续新增品牌不需要改表结构';

/* ------------------------------- 系列 ------------------------------- */

create table if not exists public.catalog_series (
  id text primary key,
  brand_id text not null references public.catalog_brands(id) on delete restrict,
  name text not null,
  description text not null default '',
  sort_order integer not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists catalog_series_brand_idx
  on public.catalog_series (brand_id, sort_order);

comment on table public.catalog_series is '品牌下的产品系列；系列可以留空，产品直接挂品牌也可以';

/* ------------------------------ 产品型号 ------------------------------ */

create table if not exists public.catalog_gear (
  id text primary key,
  brand_id text references public.catalog_brands(id) on delete set null,
  brand_name text not null default '',
  series_id text references public.catalog_series(id) on delete set null,
  series_name text not null default '',
  category text not null
    check (category in ('rod', 'reel', 'lure', 'accessory')),
  model text not null default '',
  name text not null,
  spec jsonb not null default '{}'::jsonb,
  description text not null default '',

  -- 图片：只有明确授权/官方新闻素材才允许写路径或 URL
  image_path text,
  image_url text,
  image_credit text not null default '',
  image_license text not null default '',
  image_license_status text not null default 'unknown'
    check (image_license_status in (
      'unknown', 'authorized', 'official_press', 'licensed', 'not_allowed'
    )),
  image_source_url text,
  image_verified_at timestamptz,

  -- 资料来源与核实
  official_source text not null default '',
  source_url text,
  collected_at timestamptz,
  verified_at timestamptz,
  verified_by text not null default '',
  review_status text not null default 'pending_review'
    check (review_status in (
      'draft', 'pending_review', 'approved', 'rejected', 'archived'
    )),
  -- 审核备注：驳回原因、需要补充的资料等；审核通过时清空
  review_note text not null default '',
  status text not null default 'active'
    check (status in ('active', 'discontinued', 'hidden')),

  has_variants boolean not null default false,
  sort_order integer not null default 1000,

  search_text text generated always as (
    lower(
      coalesce(brand_name, '') || ' ' ||
      coalesce(series_name, '') || ' ' ||
      coalesce(model, '') || ' ' ||
      coalesce(name, '') || ' ' ||
      coalesce(description, '')
    )
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 数据库层的最后一道保险：没有授权就不能有图片
  constraint catalog_gear_image_license_check check (
    (image_path is null and image_url is null)
    or image_license_status in ('authorized', 'official_press', 'licensed')
  ),
  -- 已发布的数据必须能追溯来源并有人核实过
  constraint catalog_gear_approved_source_check check (
    review_status <> 'approved'
    or (source_url is not null and length(btrim(source_url)) > 0)
  ),
  constraint catalog_gear_approved_verified_check check (
    review_status <> 'approved' or verified_at is not null
  )
);

create index if not exists catalog_gear_public_idx
  on public.catalog_gear (category, sort_order, brand_name, model)
  where review_status = 'approved' and status <> 'hidden';

create index if not exists catalog_gear_brand_idx
  on public.catalog_gear (brand_id, sort_order);

create index if not exists catalog_gear_series_idx
  on public.catalog_gear (series_id, sort_order);

-- 审核队列：批量导入后先看这里，不会出现在普通用户查询中
create index if not exists catalog_gear_review_idx
  on public.catalog_gear (review_status, updated_at desc)
  where review_status in ('draft', 'pending_review');

do $$
begin
  begin
    create index if not exists catalog_gear_search_idx
      on public.catalog_gear using gin (search_text gin_trgm_ops);
  exception when undefined_object then
    raise notice '未安装 pg_trgm，跳过 catalog_gear_search_idx';
  end;
end;
$$;

comment on table public.catalog_gear is
  '官方产品型号。spec 是型号级默认规格；有多个规格版本时放 catalog_gear_variants，通过 has_variants 标记';

/* ------------------------------ 规格版本 ------------------------------ */

create table if not exists public.catalog_gear_variants (
  id text primary key,
  gear_id text not null references public.catalog_gear(id) on delete cascade,
  name text not null default '',
  variant_key text not null default 'default',
  spec jsonb not null default '{}'::jsonb,
  sku text,
  barcode text,

  source_url text,
  collected_at timestamptz,
  verified_at timestamptz,
  review_status text not null default 'pending_review'
    check (review_status in (
      'draft', 'pending_review', 'approved', 'rejected', 'archived'
    )),
  review_note text not null default '',
  status text not null default 'active'
    check (status in ('active', 'discontinued', 'hidden')),

  sort_order integer not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint catalog_gear_variants_unique_key unique (gear_id, variant_key),
  constraint catalog_gear_variants_approved_source_check check (
    review_status <> 'approved'
    or (source_url is not null and length(btrim(source_url)) > 0)
  )
);

create index if not exists catalog_gear_variants_gear_idx
  on public.catalog_gear_variants (gear_id, sort_order);

create index if not exists catalog_gear_variants_review_idx
  on public.catalog_gear_variants (review_status, updated_at desc)
  where review_status in ('draft', 'pending_review');

comment on table public.catalog_gear_variants is
  '同一型号的不同规格版本（尺寸 / 速比 / 颜色等），每个版本独立稳定 id';

/* ------------------------------ 来源记录 ------------------------------ */

create table if not exists public.catalog_import_batches (
  id text primary key,
  file_name text not null default '',
  imported_at timestamptz not null default now(),
  total_rows integer not null default 0,
  accepted_rows integer not null default 0,
  rejected_rows integer not null default 0,
  status text not null default 'imported'
    check (status in ('imported', 'reviewed', 'rejected')),
  notes text not null default ''
);

create table if not exists public.catalog_sources (
  id text primary key,
  entity_type text not null
    check (entity_type in ('brand', 'series', 'gear', 'variant')),
  entity_id text not null,
  source_url text not null,
  source_type text not null default 'official_website'
    check (source_type in (
      'official_website', 'official_catalog_pdf', 'authorized_distributor',
      'press_kit', 'manual', 'other'
    )),
  collected_at timestamptz not null default now(),
  collected_by text not null default '',
  content_hash text,
  verified_at timestamptz,
  verified_by text not null default '',
  notes text not null default '',
  batch_id text references public.catalog_import_batches(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists catalog_sources_entity_idx
  on public.catalog_sources (entity_type, entity_id);

-- 来源记录可能包含内部备注，不对普通用户开放；管理员用 postgres / service role 读取
revoke all on public.catalog_sources from anon, authenticated;
revoke all on public.catalog_import_batches from anon, authenticated;

/* ------------------------------ 触发器 ------------------------------ */

drop trigger if exists catalog_brands_touch on public.catalog_brands;
create trigger catalog_brands_touch
  before update on public.catalog_brands
  for each row execute function public.touch_updated_at();

drop trigger if exists catalog_series_touch on public.catalog_series;
create trigger catalog_series_touch
  before update on public.catalog_series
  for each row execute function public.touch_updated_at();

drop trigger if exists catalog_gear_touch on public.catalog_gear;
create trigger catalog_gear_touch
  before update on public.catalog_gear
  for each row execute function public.touch_updated_at();

drop trigger if exists catalog_gear_variants_touch on public.catalog_gear_variants;
create trigger catalog_gear_variants_touch
  before update on public.catalog_gear_variants
  for each row execute function public.touch_updated_at();

/* ------------------------------ 权限与 RLS ------------------------------ */

revoke all on public.catalog_brands from anon, authenticated;
revoke all on public.catalog_series from anon, authenticated;
revoke all on public.catalog_gear from anon, authenticated;
revoke all on public.catalog_gear_variants from anon, authenticated;

grant select on public.catalog_brands to anon, authenticated;
grant select on public.catalog_series to anon, authenticated;
grant select on public.catalog_gear to anon, authenticated;
grant select on public.catalog_gear_variants to anon, authenticated;

-- 管理员未来通过后台工具写入；是否真的管理员由 JWT 里的服务端 claim 决定
grant insert, update, delete on public.catalog_brands to authenticated;
grant insert, update, delete on public.catalog_series to authenticated;
grant insert, update, delete on public.catalog_gear to authenticated;
grant insert, update, delete on public.catalog_gear_variants to authenticated;

alter table public.catalog_brands enable row level security;
alter table public.catalog_series enable row level security;
alter table public.catalog_gear enable row level security;
alter table public.catalog_gear_variants enable row level security;

drop policy if exists catalog_brands_public_read on public.catalog_brands;
create policy catalog_brands_public_read on public.catalog_brands
  for select to anon, authenticated
  using (true);

drop policy if exists catalog_series_public_read on public.catalog_series;
create policy catalog_series_public_read on public.catalog_series
  for select to anon, authenticated
  using (true);

-- 未审核 / 已拒绝 / 隐藏的产品不会出现在任何普通用户的查询里
drop policy if exists catalog_gear_public_read on public.catalog_gear;
create policy catalog_gear_public_read on public.catalog_gear
  for select to anon, authenticated
  using (review_status = 'approved' and status <> 'hidden');

drop policy if exists catalog_gear_variants_public_read on public.catalog_gear_variants;
create policy catalog_gear_variants_public_read on public.catalog_gear_variants
  for select to anon, authenticated
  using (
    review_status = 'approved'
    and status <> 'hidden'
    and exists (
      select 1
      from public.catalog_gear g
      where g.id = gear_id
        and g.review_status = 'approved'
        and g.status <> 'hidden'
    )
  );

drop policy if exists catalog_brands_admin_write on public.catalog_brands;
create policy catalog_brands_admin_write on public.catalog_brands
  for all to authenticated
  using (public.is_catalog_admin())
  with check (public.is_catalog_admin());

drop policy if exists catalog_series_admin_write on public.catalog_series;
create policy catalog_series_admin_write on public.catalog_series
  for all to authenticated
  using (public.is_catalog_admin())
  with check (public.is_catalog_admin());

drop policy if exists catalog_gear_admin_write on public.catalog_gear;
create policy catalog_gear_admin_write on public.catalog_gear
  for all to authenticated
  using (public.is_catalog_admin())
  with check (public.is_catalog_admin());

drop policy if exists catalog_gear_variants_admin_write on public.catalog_gear_variants;
create policy catalog_gear_variants_admin_write on public.catalog_gear_variants
  for all to authenticated
  using (public.is_catalog_admin())
  with check (public.is_catalog_admin());

-- 说明：
-- 1. 普通用户即使知道表名，也只能 select，且只能看到 approved 的行。
-- 2. 写入策略要求 JWT 的 app_metadata.role = catalog_admin，
--    app_metadata 只能由服务端签发，客户端无法自行添加。
-- 3. 批量导入脚本写入的数据默认 review_status = pending_review，
--    在人工核实并执行发布 SQL 之前不会公开。
