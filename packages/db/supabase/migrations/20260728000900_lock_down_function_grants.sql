-- Lock down EXECUTE on functions that were never meant to be API endpoints.
--
-- Supabase grants anon and authenticated EXECUTE on everything in `public` by
-- default. `revoke ... from public` does not undo that, because those are
-- direct grants to named roles rather than to PUBLIC — so every function in
-- this schema was quietly reachable at /rest/v1/rpc/<name>, including the
-- trigger functions and the PIN check.
--
-- None of these were exploitable: verify_staff_pin is scoped by
-- current_tenant_id(), which is NULL for anon, so it matched no row and
-- returned false. But an unauthenticated brute-force endpoint that happens to
-- always say no is still an endpoint nobody asked for.

-- PUBLIC has to be named explicitly. Postgres grants EXECUTE to PUBLIC on every
-- function at creation, and anon inherits through that, so revoking from the
-- named roles alone leaves the privilege exactly where it was.
--
-- Trigger functions. Never call these directly; Postgres invokes them.
revoke all on function public.handle_new_auth_user()          from public, anon, authenticated;
revoke all on function public.guard_last_owner()              from public, anon, authenticated;
revoke all on function public.touch_updated_at()              from public, anon, authenticated;
revoke all on function public.normalize_product_identifiers() from public, anon, authenticated;
revoke all on function public.apply_stock_movement()          from public, anon, authenticated;
revoke all on function public.reject_ledger_mutation()        from public, anon, authenticated;

-- Internal helpers.
--
-- These MUST stay executable by `authenticated`. A policy's function calls run
-- with the *caller's* privileges, not the table owner's, so revoking EXECUTE
-- here does not hide the function — it makes every single query against every
-- RLS-protected table fail outright with "permission denied for function
-- current_tenant_id". Learned by doing it and watching the dashboard 500.
--
-- anon is a different matter: every policy in this schema is `to authenticated`,
-- so an anonymous request never evaluates these, and there is no reason to leave
-- them on the public API surface.
revoke all on function public.current_tenant_id()  from public, anon;
revoke all on function public.current_shop_role()  from public, anon;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.current_shop_role() to authenticated;

-- Real RPCs: signed-in users only. Each already re-checks the caller's tenant
-- and role internally; this just stops anon reaching them at all.
revoke all on function public.provision_tenant(text, char, numeric)   from anon;
revoke all on function public.process_sale(text, jsonb, public.payment_method, integer, timestamptz, text) from anon;
revoke all on function public.void_sale(uuid, text)                   from anon;
revoke all on function public.restock_product(uuid, numeric, integer, text) from anon;
revoke all on function public.match_products(vector, integer, double precision) from anon;
revoke all on function public.set_staff_pin(uuid, text)               from anon;
revoke all on function public.verify_staff_pin(uuid, text)            from anon;
-- This one never had its PUBLIC grant revoked when it was created, so it needs
-- PUBLIC named here too rather than just anon.
revoke all on function public.recompute_stock_on_hand(uuid)           from public, anon;
grant execute on function public.recompute_stock_on_hand(uuid)        to authenticated;
revoke all on function public.weekly_report_stats(uuid, date)         from anon;

-- New functions should not inherit the blanket grant either. This governs
-- objects created later by the migration role, so it is the durable half of
-- the fix — without it the next `create function` re-opens the same hole.
alter default privileges in schema public
  revoke execute on functions from anon, authenticated;
