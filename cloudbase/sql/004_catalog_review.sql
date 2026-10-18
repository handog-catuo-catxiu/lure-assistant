-- ============================================================================
-- LureMate 官方图鉴审核 / 发布函数
--
-- 批量导入默认写入 review_status = 'pending_review'。
-- 本文件提供受控的「通过 / 驳回」入口，供以后的管理工具或临时 SQL 调用，
-- 而不是让管理员手工拼 update，避免漏掉 verified_at / review_note 等字段。
--
-- 安全：
-- * 函数是 security definer，会绕过 RLS，因此第一行必须先检查
--   public.is_catalog_admin()（JWT 里的 app_metadata.role = catalog_admin）
-- * 普通登录用户即使知道函数名，调用也会被拒绝
-- * anon 没有 execute 权限
-- * 函数只接受 id 数组，不接收 user_id / 手机号等身份参数
--
-- 本文件只生成变更内容，不自动执行。
-- ============================================================================

/* --------------------------- 发布 / 驳回产品 --------------------------- */

create or replace function public.catalog_publish_gear(
  p_ids text[],
  p_reviewer text default ''
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed integer;
begin
  if not public.is_catalog_admin() then
    raise exception '没有官方图鉴审核权限' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  update public.catalog_gear
     set review_status = 'approved',
         review_note = '',
         verified_at = now(),
         verified_by = coalesce(nullif(btrim(p_reviewer), ''), 'catalog_admin'),
         image_verified_at = case
           when image_path is not null or image_url is not null
             then coalesce(image_verified_at, now())
           else image_verified_at
         end
   where id = any(p_ids)
     and status <> 'hidden'
     and source_url is not null
     and btrim(source_url) <> '';

  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.catalog_reject_gear(
  p_ids text[],
  p_note text default ''
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed integer;
begin
  if not public.is_catalog_admin() then
    raise exception '没有官方图鉴审核权限' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  update public.catalog_gear
     set review_status = 'rejected',
         review_note = coalesce(p_note, ''),
         verified_at = null,
         verified_by = ''
   where id = any(p_ids);

  get diagnostics changed = row_count;
  return changed;
end;
$$;

/* --------------------------- 发布 / 驳回规格 --------------------------- */

create or replace function public.catalog_publish_variants(p_ids text[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed integer;
begin
  if not public.is_catalog_admin() then
    raise exception '没有官方图鉴审核权限' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  -- 规格只有在父产品已经发布后才允许发布，避免出现孤立的规格行
  update public.catalog_gear_variants v
     set review_status = 'approved',
         review_note = '',
         verified_at = now()
   where v.id = any(p_ids)
     and v.status <> 'hidden'
     and v.source_url is not null
     and btrim(v.source_url) <> ''
     and exists (
       select 1
         from public.catalog_gear g
        where g.id = v.gear_id
          and g.review_status = 'approved'
          and g.status <> 'hidden'
     );

  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.catalog_reject_variants(
  p_ids text[],
  p_note text default ''
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed integer;
begin
  if not public.is_catalog_admin() then
    raise exception '没有官方图鉴审核权限' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  update public.catalog_gear_variants
     set review_status = 'rejected',
         review_note = coalesce(p_note, ''),
         verified_at = null
   where id = any(p_ids);

  get diagnostics changed = row_count;
  return changed;
end;
$$;

/* ------------------------------ 执行权限 ------------------------------ */

revoke all on function public.catalog_publish_gear(text[], text) from public, anon;
revoke all on function public.catalog_reject_gear(text[], text) from public, anon;
revoke all on function public.catalog_publish_variants(text[]) from public, anon;
revoke all on function public.catalog_reject_variants(text[], text) from public, anon;

-- 登录用户有 execute 权限，但函数内部会再次检查 catalog_admin
grant execute on function public.catalog_publish_gear(text[], text) to authenticated;
grant execute on function public.catalog_reject_gear(text[], text) to authenticated;
grant execute on function public.catalog_publish_variants(text[]) to authenticated;
grant execute on function public.catalog_reject_variants(text[], text) to authenticated;

-- 使用示例（需要管理员 JWT 或直接在控制台以 postgres 身份执行）：
-- select public.catalog_publish_gear(array['gear-xxxxxxxx'], '审核人');
-- select public.catalog_reject_gear(array['gear-xxxxxxxx'], '官方页面已查不到该型号，待补充来源');
-- select public.catalog_publish_variants(array['var-xxxxxxxx']);
--
-- 审核队列查询：
-- select id, brand_name, series_name, model, name, category,
--        source_url, collected_at, review_note
--   from public.catalog_gear
--  where review_status = 'pending_review'
--  order by collected_at desc nulls last
--  limit 100;
