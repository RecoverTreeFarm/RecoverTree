-- ============================================================================
-- Security hardening (from Supabase advisor after initial schema):
-- 1. Pin search_path on trigger functions so they can't be hijacked by
--    schema shadowing.
-- 2. is_admin() stays executable by 'authenticated' (RLS policies need it,
--    and it only reveals whether the CALLER is an admin), but anon/public
--    have no reason to call it.
-- ============================================================================

alter function public.set_updated_at() set search_path = '';
alter function public.protect_privileged_profile_columns() set search_path = '';
alter function public.is_admin() set search_path = 'public';

revoke execute on function public.is_admin() from anon;
revoke execute on function public.is_admin() from public;
