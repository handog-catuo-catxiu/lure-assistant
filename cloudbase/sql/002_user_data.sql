-- ============================================================================
-- LureMate 个人数据表
--
-- 所有私人数据都通过 user_id 归属到 CloudBase Auth 的稳定 uid（session.user.id），
-- 不使用手机号作为身份依据。
--
-- 安全设计（服务端强制，不依赖前端隐藏）：
-- 1. 每张表 user_id text not null default auth.uid()
--    （CloudBase 的 auth.uid() RETURNS text，auth.users.id 是 VARCHAR(64)，不是 uuid）
-- 2. before insert/update 触发器强制把 user_id 改成 auth.uid()，
--    即使客户端伪造别人的 user_id 也会被覆盖
-- 3. RLS：select / insert / update 都只能操作自己的行
-- 4. anon 角色没有任何权限；未登录用户拿不到私人数据
-- 5. 删除使用 deleted_at 墓碑（软删除），不物理删除，便于多设备同步
--
-- 关系字段（spot_id / gear_ids / rod_id 等）只保存稳定 id，故意不加外键：
-- 离线同步时记录到达顺序不固定，且官方图鉴下架、装备删除都不应连带删除历史记录。
-- 应用层已经保证了这些 id 的引用关系，同步时原样保留。
--
-- 本文件只生成变更内容，不自动执行。
-- ============================================================================

-- 防止客户端伪造 user_id。auth.uid() 为空时（例如服务端迁移）保留原值。
create or replace function public.enforce_row_owner()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

/*
 * 真正的「后写者胜」：客户端带的 client_updated_at 比数据库里旧时，
 * 直接跳过这次更新（返回 NULL），避免时钟较慢的旧设备把新数据覆盖掉。
 *
 * 冲突基准是客户端修改时间，所以设备时钟最好保持自动同步；
 * 相同时间戳允许更新（例如同一次保存里的多个字段）。
 */
create or replace function public.enforce_client_lww()
returns trigger
language plpgsql
as $$
begin
  if new.client_updated_at < old.client_updated_at then
    return null;
  end if;
  return new;
end;
$$;

/* -------------------------------- 装备 -------------------------------- */

create table if not exists public.user_gears (
  user_id text not null default auth.uid(),
  id text not null,
  -- 只保留官方图鉴 id 关联，不复制官方产品字段；官方下架也不影响这件装备
  catalog_id text,
  category text not null check (category in ('rod', 'reel', 'lure', 'accessory')),
  brand text not null default '',
  name text not null,
  spec jsonb not null default '{}'::jsonb,
  note text not null default '',
  purchased_at text not null default '',
  favorite boolean not null default false,
  show_image_on_home boolean not null default false,
  -- 对象存储里的私有路径，不存图片二进制
  image_path text,
  image_updated_at bigint,
  client_updated_at bigint not null,
  device_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create index if not exists user_gears_sync_idx
  on public.user_gears (user_id, updated_at, id);

comment on table public.user_gears is '用户个人装备。catalog_id 只是可选关联，不设外键';
comment on column public.user_gears.client_updated_at is '客户端最后修改时间（毫秒），用于最后写入优先冲突处理';

/* -------------------------------- 钓点 -------------------------------- */

create table if not exists public.user_spots (
  user_id text not null default auth.uid(),
  id text not null,
  name text not null,
  note text not null default '',
  latitude double precision,
  longitude double precision,
  place_name text,
  client_created_at bigint not null,
  client_updated_at bigint not null,
  device_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  constraint user_spots_coordinate_check check (
    (latitude is null and longitude is null)
    or (
      latitude is not null and longitude is not null
      and latitude between -90 and 90
      and longitude between -180 and 180
    )
  )
);

create index if not exists user_spots_sync_idx
  on public.user_spots (user_id, updated_at, id);

/* -------------------------------- 出勤 -------------------------------- */

create table if not exists public.user_trips (
  user_id text not null default auth.uid(),
  id text not null,
  spot_id text not null default '',
  spot_name text not null default '',
  gear_ids text[] not null default '{}',
  started_at bigint not null,
  ended_at bigint,
  status text not null check (status in ('active', 'completed')),
  source text check (source in ('web', 'ios', 'watch')),
  steps integer,
  cast_count integer,
  client_created_at bigint not null,
  client_updated_at bigint not null,
  device_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  constraint user_trips_ended_check check (
    (status = 'active' and ended_at is null)
    or (status = 'completed' and ended_at is not null)
  )
);

create index if not exists user_trips_sync_idx
  on public.user_trips (user_id, updated_at, id);
create index if not exists user_trips_spot_idx
  on public.user_trips (user_id, spot_id);

/* -------------------------------- 渔获 -------------------------------- */

create table if not exists public.user_catches (
  user_id text not null default auth.uid(),
  id text not null,
  session_id text not null,
  spot_id text not null default '',
  caught_at bigint not null,
  species text not null default '',
  length_cm double precision,
  weight_g double precision,
  rod_id text,
  reel_id text,
  lure_id text,
  note text not null default '',
  latitude double precision,
  longitude double precision,
  location_recorded_at bigint,
  location_accuracy integer,
  client_created_at bigint not null,
  client_updated_at bigint not null,
  device_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  constraint user_catches_location_check check (
    (latitude is null and longitude is null)
    or (
      latitude is not null and longitude is not null
      and latitude between -90 and 90
      and longitude between -180 and 180
    )
  )
);

create index if not exists user_catches_sync_idx
  on public.user_catches (user_id, updated_at, id);
create index if not exists user_catches_trip_idx
  on public.user_catches (user_id, session_id);

/* ------------------------------- 轨迹点 ------------------------------- */

create table if not exists public.user_track_points (
  user_id text not null default auth.uid(),
  id text not null,
  session_id text not null,
  latitude double precision not null,
  longitude double precision not null,
  recorded_at bigint not null,
  accuracy double precision,
  client_updated_at bigint not null,
  device_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint user_track_points_coordinate_check check (
    latitude between -90 and 90 and longitude between -180 and 180
  )
);

create index if not exists user_track_points_sync_idx
  on public.user_track_points (user_id, updated_at, id);
create index if not exists user_track_points_session_idx
  on public.user_track_points (user_id, session_id, recorded_at);

comment on table public.user_track_points is
  'GPS 轨迹点。只追加不修改；删除出勤时按 session_id 清理';

/* -------------------------------- 偏好 -------------------------------- */

create table if not exists public.user_preferences (
  user_id text not null default auth.uid(),
  -- 偏好键，例如 home.refSpot / home.water；沿用 id 方便统一增量游标
  id text not null,
  value jsonb,
  client_updated_at bigint not null,
  device_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

create index if not exists user_preferences_sync_idx
  on public.user_preferences (user_id, updated_at, id);

comment on table public.user_preferences is
  '跨设备偏好。天气缓存、定位、当前页面等临时状态不放在这里';

/* ------------------------------ 图片索引 ------------------------------ */

create table if not exists public.user_images (
  user_id text not null default auth.uid(),
  -- gear:<gearId>:original / catch:<catchId>:original
  id text not null,
  entity_type text not null check (entity_type in ('gear', 'catch')),
  entity_id text not null,
  kind text not null default 'original',
  -- 对象存储私有路径，第一段必须是 user_id
  storage_path text,
  mime_type text,
  byte_size bigint,
  content_hash text,
  client_updated_at bigint not null,
  device_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  constraint user_images_path_owner_check check (
    storage_path is null
    or split_part(storage_path, '/', 1) = user_id::text
  )
);

create index if not exists user_images_sync_idx
  on public.user_images (user_id, updated_at, id);
create index if not exists user_images_entity_idx
  on public.user_images (user_id, entity_type, entity_id);

comment on table public.user_images is
  '图片元数据。图片二进制在对象存储的私有桶，不存 PostgreSQL';

/* ------------------------------ 触发器 ------------------------------ */

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'user_gears', 'user_spots', 'user_trips', 'user_catches',
    'user_track_points', 'user_preferences', 'user_images'
  ]
  loop
    execute format(
      'drop trigger if exists %I on public.%I',
      table_name || '_owner', table_name
    );
    execute format(
      'create trigger %I before insert or update on public.%I
         for each row execute function public.enforce_row_owner()',
      table_name || '_owner', table_name
    );

    execute format(
      'drop trigger if exists %I on public.%I',
      table_name || '_lww', table_name
    );
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.enforce_client_lww()',
      table_name || '_lww', table_name
    );

    execute format(
      'drop trigger if exists %I on public.%I',
      table_name || '_touch', table_name
    );
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.touch_updated_at()',
      table_name || '_touch', table_name
    );
  end loop;
end;
$$;

/* ------------------------------ 权限 ------------------------------ */

revoke all on public.user_gears from anon, authenticated;
revoke all on public.user_spots from anon, authenticated;
revoke all on public.user_trips from anon, authenticated;
revoke all on public.user_catches from anon, authenticated;
revoke all on public.user_track_points from anon, authenticated;
revoke all on public.user_preferences from anon, authenticated;
revoke all on public.user_images from anon, authenticated;

-- 私人表连 anon 的 select 权限都不给；未登录请求直接失败
grant select, insert, update on public.user_gears to authenticated;
grant select, insert, update on public.user_spots to authenticated;
grant select, insert, update on public.user_trips to authenticated;
grant select, insert, update on public.user_catches to authenticated;
grant select, insert, update, delete on public.user_track_points to authenticated;
grant select, insert, update on public.user_preferences to authenticated;
grant select, insert, update on public.user_images to authenticated;

alter table public.user_gears enable row level security;
alter table public.user_spots enable row level security;
alter table public.user_trips enable row level security;
alter table public.user_catches enable row level security;
alter table public.user_track_points enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_images enable row level security;

drop policy if exists user_gears_own_select on public.user_gears;
create policy user_gears_own_select on public.user_gears
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_gears_own_insert on public.user_gears;
create policy user_gears_own_insert on public.user_gears
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists user_gears_own_update on public.user_gears;
create policy user_gears_own_update on public.user_gears
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists user_spots_own_select on public.user_spots;
create policy user_spots_own_select on public.user_spots
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_spots_own_insert on public.user_spots;
create policy user_spots_own_insert on public.user_spots
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists user_spots_own_update on public.user_spots;
create policy user_spots_own_update on public.user_spots
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists user_trips_own_select on public.user_trips;
create policy user_trips_own_select on public.user_trips
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_trips_own_insert on public.user_trips;
create policy user_trips_own_insert on public.user_trips
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists user_trips_own_update on public.user_trips;
create policy user_trips_own_update on public.user_trips
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists user_catches_own_select on public.user_catches;
create policy user_catches_own_select on public.user_catches
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_catches_own_insert on public.user_catches;
create policy user_catches_own_insert on public.user_catches
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists user_catches_own_update on public.user_catches;
create policy user_catches_own_update on public.user_catches
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists user_track_points_own_select on public.user_track_points;
create policy user_track_points_own_select on public.user_track_points
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_track_points_own_insert on public.user_track_points;
create policy user_track_points_own_insert on public.user_track_points
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists user_track_points_own_update on public.user_track_points;
create policy user_track_points_own_update on public.user_track_points
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists user_track_points_own_delete on public.user_track_points;
create policy user_track_points_own_delete on public.user_track_points
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_preferences_own_select on public.user_preferences;
create policy user_preferences_own_select on public.user_preferences
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_preferences_own_insert on public.user_preferences;
create policy user_preferences_own_insert on public.user_preferences
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists user_preferences_own_update on public.user_preferences;
create policy user_preferences_own_update on public.user_preferences
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists user_images_own_select on public.user_images;
create policy user_images_own_select on public.user_images
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists user_images_own_insert on public.user_images;
create policy user_images_own_insert on public.user_images
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists user_images_own_update on public.user_images;
create policy user_images_own_update on public.user_images
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
