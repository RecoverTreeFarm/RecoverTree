-- ============================================================================
-- Security hardening: handle_new_profile() is a trigger function (runs
-- automatically after a profiles insert) and was never meant to be called
-- directly. Because no migration explicitly revoked the default PUBLIC
-- execute grant, the Supabase advisor flagged it as callable by the
-- unauthenticated `anon` role via /rest/v1/rpc/handle_new_profile.
--
-- Revoking EXECUTE here does NOT affect the trigger: Postgres invokes trigger
-- functions directly as part of executing the triggering statement, which
-- does not require the invoking role to hold EXECUTE on the function (this
-- mirrors the same revoke-from-public-and-anon pattern already used on every
-- other internal-only helper in this codebase, e.g. assert_own_tree()).
-- ============================================================================

revoke execute on function public.handle_new_profile() from public, anon, authenticated;
