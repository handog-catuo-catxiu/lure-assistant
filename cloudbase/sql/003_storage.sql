-- ============================================================================
-- LureMate 对象存储配置
--
-- 两个桶：
-- * luremate-user-media  私有：用户装备照片 / 渔获照片，路径第一段是 uid
-- * luremate-catalog     公开读：官方图鉴图片，只有服务端/管理员能上传
--
-- 安全边界：
-- 1. 用户桶私有，RLS 限制「路径第一段 = 当前 uid」
-- 2. 即使用户拿到别人的图片路径，也读不到
-- 3. 目录桶允许匿名读，但不给客户端任何写入权限（restrictive policy 双重保险）
-- 4. 图片二进制不进入 PostgreSQL
--
-- 本文件只生成变更内容，不自动执行。
-- ============================================================================

insert into storage.buckets (id, name, public, created_at, updated_at)
values ('luremate-user-media', 'luremate-user-media', false, now(), now())
on conflict (id) do update
  set public = excluded.public,
      updated_at = now();

insert into storage.buckets (id, name, public, created_at, updated_at)
values ('luremate-catalog', 'luremate-catalog', true, now(), now())
on conflict (id) do update
  set public = excluded.public,
      updated_at = now();

alter table storage.objects enable row level security;

/* --------------------------- 用户私有图片桶 --------------------------- */

-- 先删掉本方案曾经创建过的策略，重复执行不会报错
drop policy if exists luremate_user_media_select_own on storage.objects;
drop policy if exists luremate_user_media_insert_own on storage.objects;
drop policy if exists luremate_user_media_update_own on storage.objects;
drop policy if exists luremate_user_media_delete_own on storage.objects;

create policy luremate_user_media_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'luremate-user-media'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );

create policy luremate_user_media_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'luremate-user-media'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );

create policy luremate_user_media_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'luremate-user-media'
    and split_part(name, '/', 1) = (select auth.uid())::text
  )
  with check (
    bucket_id = 'luremate-user-media'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );

create policy luremate_user_media_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'luremate-user-media'
    and split_part(name, '/', 1) = (select auth.uid())::text
  );

/* ----------------------------- 官方图鉴桶 ----------------------------- */

drop policy if exists luremate_catalog_public_read on storage.objects;
create policy luremate_catalog_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'luremate-catalog');

/*
 * restrictive policy：与其它策略是「并且」关系。
 * 即使将来 storage 上存在其它宽松的 authenticated 策略，
 * 客户端也不能写官方图鉴桶。管理员上传请用控制台 / service role。
 */
drop policy if exists luremate_catalog_no_client_insert on storage.objects;
create policy luremate_catalog_no_client_insert on storage.objects
  as restrictive
  for insert to anon, authenticated
  with check (bucket_id <> 'luremate-catalog');

drop policy if exists luremate_catalog_no_client_update on storage.objects;
create policy luremate_catalog_no_client_update on storage.objects
  as restrictive
  for update to anon, authenticated
  using (bucket_id <> 'luremate-catalog')
  with check (bucket_id <> 'luremate-catalog');

drop policy if exists luremate_catalog_no_client_delete on storage.objects;
create policy luremate_catalog_no_client_delete on storage.objects
  as restrictive
  for delete to anon, authenticated
  using (bucket_id <> 'luremate-catalog');

/*
 * 用户桶的额外限制：防止其它宽松策略让某个登录用户写到别人的目录。
 * 只约束 luremate-user-media 这一个桶，不影响其它业务。
 */
drop policy if exists luremate_user_media_no_cross_user on storage.objects;
create policy luremate_user_media_no_cross_user on storage.objects
  as restrictive
  for all to authenticated
  using (
    bucket_id <> 'luremate-user-media'
    or split_part(name, '/', 1) = (select auth.uid())::text
  )
  with check (
    bucket_id <> 'luremate-user-media'
    or split_part(name, '/', 1) = (select auth.uid())::text
  );

-- 未登录用户不能读取用户私有桶（即使将来出现其它宽松策略）
drop policy if exists luremate_user_media_anon_deny on storage.objects;
create policy luremate_user_media_anon_deny on storage.objects
  as restrictive
  for select to anon
  using (bucket_id <> 'luremate-user-media');

-- 说明：
-- 1. 前端上传路径固定为 <uid>/gear/<gearId>/original 和 <uid>/catch/<catchId>/original，
--    第一段必须等于登录 uid，否则 RLS 拒绝。
-- 2. 文件名使用固定路径 + upsert，重复上传同一张照片不会产生多份对象。
-- 3. 删除照片时只删这个固定路径；数据库里的 user_images 行保留墓碑，供其它设备同步。
