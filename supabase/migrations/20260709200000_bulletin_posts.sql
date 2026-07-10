-- ============================================================================
-- Bulletin board posts (the homepage notice board), admin-managed.
--
-- Posts are PUBLIC read — the homepage is seen by logged-out visitors — but
-- only rows whose publish_at has arrived. That makes scheduling trivial:
-- set publish_at in the future and the post appears on its own.
--
-- Only admins may write, enforced twice: an RLS policy on the table AND an
-- is_admin() re-check inside every SECURITY DEFINER RPC. Writes are
-- audit-logged like every other admin action.
--
-- `category` is deliberately limited to the three admin-selectable types.
-- 'patch' and 'bugfix' exist in the check constraint so older/static content
-- can still be represented, but the admin UI does not offer them.
--
-- ECONOMY: untouched. Bulletin posts are text + an optional sprite image.
-- ============================================================================

create table if not exists public.bulletin_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  body text not null check (length(btrim(body)) between 1 and 1000),
  category text not null default 'update'
    check (category in ('update', 'announcement', 'event', 'patch', 'bugfix')),
  /** a path under /public/sprites (never a UI asset); null = no image */
  image_src text check (image_src is null or image_src like '/sprites/%'),
  publish_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists bulletin_posts_publish_idx
  on public.bulletin_posts (publish_at desc);

alter table public.bulletin_posts enable row level security;

-- Everyone (including logged-out visitors) reads PUBLISHED posts only.
drop policy if exists "bulletin: published readable by all" on public.bulletin_posts;
create policy "bulletin: published readable by all"
  on public.bulletin_posts for select
  to anon, authenticated
  using (publish_at <= now());

-- Admins read everything (including scheduled posts) and write.
drop policy if exists "bulletin: admins read all" on public.bulletin_posts;
create policy "bulletin: admins read all"
  on public.bulletin_posts for select
  to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- Admin RPCs (SECURITY DEFINER; each re-checks is_admin() and audit-logs).
-- ----------------------------------------------------------------------------
create or replace function public.list_admin_bulletin_posts()
returns table (
  id uuid, title text, body text, category text,
  image_src text, publish_at timestamptz, created_at timestamptz,
  is_published boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  return query
    select b.id, b.title, b.body, b.category, b.image_src, b.publish_at,
           b.created_at, (b.publish_at <= now())
    from public.bulletin_posts b
    order by b.publish_at desc;
end;
$$;

create or replace function public.create_bulletin_post(
  p_title text, p_body text, p_category text,
  p_image_src text default null, p_publish_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_when timestamptz := coalesce(p_publish_at, now());
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_category not in ('update', 'announcement', 'event') then
    raise exception 'INVALID_CATEGORY';
  end if;
  if p_image_src is not null and p_image_src not like '/sprites/%' then
    raise exception 'INVALID_IMAGE';
  end if;

  insert into public.bulletin_posts (title, body, category, image_src, publish_at, created_by)
  values (btrim(p_title), btrim(p_body), p_category, p_image_src, v_when, auth.uid())
  returning id into v_id;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
  values (auth.uid(), 'bulletin_post_created', jsonb_build_object(
    'post_id', v_id, 'title', btrim(p_title), 'category', p_category, 'publish_at', v_when));

  return v_id;
end;
$$;

create or replace function public.delete_bulletin_post(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  select title into v_title from public.bulletin_posts where id = p_id;
  if v_title is null then raise exception 'POST_NOT_FOUND'; end if;

  delete from public.bulletin_posts where id = p_id;

  insert into public.admin_audit_logs (actor_user_id, action, metadata_json)
  values (auth.uid(), 'bulletin_post_deleted', jsonb_build_object('post_id', p_id, 'title', v_title));
end;
$$;

revoke execute on function public.list_admin_bulletin_posts() from public, anon;
grant execute on function public.list_admin_bulletin_posts() to authenticated;
revoke execute on function public.create_bulletin_post(text, text, text, text, timestamptz) from public, anon;
grant execute on function public.create_bulletin_post(text, text, text, text, timestamptz) to authenticated;
revoke execute on function public.delete_bulletin_post(uuid) from public, anon;
grant execute on function public.delete_bulletin_post(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Seed the board with the existing static notices (idempotent).
-- ----------------------------------------------------------------------------
insert into public.bulletin_posts (title, body, category, image_src, publish_at)
select * from (values
  ('Cherry blossom trees are blooming',
   'The rare cherry blossom tree has fresh art, its own drifting petals, and a little chime when it appears. Cherries now grow on cherry trees only — every other tree keeps its own fruit. A blossom still pays double Fruits when you harvest it.',
   'update', '/sprites/plants/tree_cherry.png', now()),
  ('A map of the valley',
   'There''s a new map button in the bottom menu. For now it''s just a lovely place to look at — travel and locations are coming later.',
   'announcement', '/sprites/map/world_map.png', now()),
  ('Seasons now cycle: Sparch through Octobrrr',
   'Seasons no longer follow the calendar. Five 30-day seasons loop forever — Sparch, Maypril, Junduly, Suntember, Octobrrr — and every community starts on Sparch. When a season ends, the ceremony hands out medals and badges automatically.',
   'event', '/sprites/goose/egg.png', now())
) as v(title, body, category, image_src, publish_at)
where not exists (select 1 from public.bulletin_posts);
