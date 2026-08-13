-- Let a cashier exist without an email address.
--
-- users.id was a hard FK to auth.users, so adding a staff member meant creating
-- a Supabase auth account, which means an email inbox per person. For a shop
-- with three casual staff that is a barrier, and it contradicts the PIN design
-- already in this schema: the PIN was never meant to authenticate against the
-- server, it picks which cashier is standing at an already-signed-in till.
--
-- After this there are two kinds of staff row:
--
--   with a login    users.id IS the auth user's id, set by the signup trigger.
--                   Can sign in to the dashboard.
--   PIN only        users.id is a fresh uuid with no auth account. Exists to be
--                   attributed on sales and to unlock the till with a PIN.
--
-- The important property: auth.uid() can never equal a PIN-only row's id, so
-- current_tenant_id(), current_shop_role(), current_location_id() and every
-- policy that compares `id = auth.uid()` keep working untouched.

alter table public.users
  drop constraint users_id_fkey;

alter table public.users
  alter column id set default extensions.gen_random_uuid();

-- Honest flag rather than making the UI infer it from a table it cannot read:
-- public.users is readable under RLS, auth.users is not.
alter table public.users
  add column login_enabled boolean not null default false;

comment on column public.users.login_enabled is
  'True when this row corresponds to an auth account and id equals that account''s '
  'uid. False for PIN-only staff, who work the till but cannot sign in.';

comment on column public.users.id is
  'For staff with a login this is deliberately the same value as their auth.users '
  'id, which is what lets auth.uid() comparisons resolve without a join. For '
  'PIN-only staff it is an independent uuid.';

-- Everyone who exists today got here through signup, so they all have logins.
update public.users set login_enabled = true;

-- Signup still mints the row, and now marks it as having a login.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, name, login_enabled)
  values (
    new.id,
    new.email,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''),
    true
  )
  on conflict (id) do update
    set email = excluded.email,
        login_enabled = true;
  return new;
end;
$$;

-- Dropping the FK also dropped ON DELETE CASCADE. That is the behaviour we
-- want: deleting a login must not delete the person, because sales reference
-- them and history should keep its cashier. Revoke the login instead.
create or replace function public.handle_deleted_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users
  set login_enabled = false,
      is_active = false
  where id = old.id;
  return old;
end;
$$;

create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_deleted_auth_user();

-- ---------------------------------------------------------------------------
-- Attributing a sale to a cashier who has no session of their own
-- ---------------------------------------------------------------------------

-- The till runs signed in as the shop. When a PIN picks a cashier, the sale
-- belongs to that person, not to whoever's session the device is holding.
drop function if exists public.process_sale(text, jsonb, public.payment_method, integer, timestamptz, text, uuid, jsonb, uuid);

create function public.process_sale(
  p_client_id      text,
  p_items          jsonb,
  p_payment_method public.payment_method,
  p_discount_cents integer default 0,
  p_created_at     timestamptz default now(),
  p_note           text default null,
  p_shift_id       uuid default null,
  p_payments       jsonb default null,
  p_location_id    uuid default null,
  p_cashier_id     uuid default null
)
returns public.sales
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id   uuid := public.current_tenant_id();
  v_uid         uuid := auth.uid();
  v_cashier     uuid;
  v_location    uuid := coalesce(p_location_id, public.default_location_id());
  v_tenant      public.tenants;
  v_sale        public.sales;
  v_item        jsonb;
  v_product     public.products;
  v_on_hand     numeric(14,3);
  v_qty         numeric(14,3);
  v_unit_price  integer;
  v_line_total  integer;
  v_subtotal    integer := 0;
  v_taxable     integer;
  v_tax         integer;
  v_total       integer;
  v_oversell    boolean := false;
  v_lines       jsonb := '[]'::jsonb;
  v_paid        integer;
  v_method      public.payment_method;
  v_shift       public.shifts;
begin
  if v_tenant_id is null then
    raise exception 'No shop on this session' using errcode = 'PS401';
  end if;
  if v_location is null then
    raise exception 'This shop has no location set up' using errcode = 'PS422';
  end if;

  -- A caller may name any active staff member in their own shop, and nobody
  -- outside it. Falling back to the session's own user keeps existing callers
  -- working unchanged.
  if p_cashier_id is not null then
    select id into v_cashier from public.users
    where id = p_cashier_id and tenant_id = v_tenant_id and is_active;
    if not found then
      raise exception 'That cashier is not on this shop''s staff' using errcode = 'PS404';
    end if;
  else
    v_cashier := v_uid;
  end if;

  select * into v_sale
  from public.sales
  where tenant_id = v_tenant_id and client_id = p_client_id;

  if found then
    return v_sale;
  end if;

  select * into v_tenant from public.tenants where id = v_tenant_id;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'A sale needs at least one line' using errcode = 'PS422';
  end if;

  if p_shift_id is not null then
    select * into v_shift from public.shifts
    where id = p_shift_id and tenant_id = v_tenant_id;
    if not found then
      raise exception 'Shift not found' using errcode = 'PS404';
    end if;
    if v_shift.status <> 'open' then
      raise exception 'That shift is closed - open a new one' using errcode = 'PS405';
    end if;
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items) as t(value)
    order by (value ->> 'product_id')::uuid
  loop
    v_qty        := (v_item ->> 'quantity')::numeric;
    v_unit_price := (v_item ->> 'unit_price_cents')::integer;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Line quantity must be positive' using errcode = 'PS422';
    end if;

    select * into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid and tenant_id = v_tenant_id;

    if not found then
      raise exception 'Product % is not in this shop', v_item ->> 'product_id'
        using errcode = 'PS404';
    end if;

    select ls.on_hand into v_on_hand
    from public.location_stock ls
    where ls.location_id = v_location and ls.product_id = v_product.id
    for update;

    v_on_hand := coalesce(v_on_hand, 0);

    if v_unit_price is null then
      v_unit_price := v_product.price_cents;
    end if;

    if v_on_hand - v_qty < 0 then
      if not v_tenant.allow_oversell then
        raise exception 'Only % of "%" left here', v_on_hand, v_product.name
          using errcode = 'PS422', detail = v_product.id::text;
      end if;
      v_oversell := true;
    end if;

    v_line_total := round(v_qty * v_unit_price)::integer;
    v_subtotal   := v_subtotal + v_line_total;

    v_lines := v_lines || jsonb_build_object(
      'product_id',       v_product.id,
      'quantity',         v_qty,
      'unit_price_cents', v_unit_price,
      'line_total_cents', v_line_total,
      'name_at_sale',     v_product.name,
      'unit_cost_cents',  v_product.cost_cents
    );
  end loop;

  p_discount_cents := least(greatest(coalesce(p_discount_cents, 0), 0), v_subtotal);
  v_taxable := v_subtotal - p_discount_cents;

  if v_tenant.tax_inclusive then
    v_tax   := round(v_taxable * v_tenant.tax_rate / (1 + v_tenant.tax_rate))::integer;
    v_total := v_taxable;
  else
    v_tax   := round(v_taxable * v_tenant.tax_rate)::integer;
    v_total := v_taxable + v_tax;
  end if;

  if p_payments is not null and jsonb_array_length(p_payments) > 0 then
    select coalesce(sum((e ->> 'amount_cents')::integer), 0) into v_paid
    from jsonb_array_elements(p_payments) as t(e);

    if v_paid <> v_total then
      raise exception 'Payments total % but the sale is %', v_paid, v_total
        using errcode = 'PS422';
    end if;

    if jsonb_array_length(p_payments) = 1 then
      v_method := (p_payments -> 0 ->> 'method')::public.payment_method;
    else
      v_method := 'mixed';
    end if;
  else
    v_method := coalesce(p_payment_method, 'cash');
  end if;

  insert into public.sales (
    tenant_id, location_id, cashier_id, client_id, shift_id, kind,
    subtotal_cents, discount_cents, tax_cents, total_cents,
    payment_method, tax_inclusive, has_oversell, note, created_at
  )
  values (
    v_tenant_id, v_location, v_cashier, p_client_id, p_shift_id, 'sale',
    v_subtotal, p_discount_cents, v_tax, v_total,
    v_method, v_tenant.tax_inclusive, v_oversell, p_note,
    coalesce(p_created_at, now())
  )
  returning * into v_sale;

  insert into public.sale_items (
    tenant_id, sale_id, product_id, quantity,
    unit_price_cents, line_total_cents, name_at_sale, unit_cost_cents
  )
  select v_tenant_id, v_sale.id, l.product_id, l.quantity,
         l.unit_price_cents, l.line_total_cents, l.name_at_sale, l.unit_cost_cents
  from jsonb_to_recordset(v_lines) as l(
    product_id uuid, quantity numeric, unit_price_cents integer,
    line_total_cents integer, name_at_sale text, unit_cost_cents integer
  );

  if p_payments is not null and jsonb_array_length(p_payments) > 0 then
    insert into public.sale_payments (tenant_id, sale_id, method, amount_cents, tendered_cents, reference)
    select v_tenant_id, v_sale.id,
           (e ->> 'method')::public.payment_method,
           (e ->> 'amount_cents')::integer,
           nullif(e ->> 'tendered_cents', '')::integer,
           nullif(e ->> 'reference', '')
    from jsonb_array_elements(p_payments) as t(e);
  else
    insert into public.sale_payments (tenant_id, sale_id, method, amount_cents)
    values (v_tenant_id, v_sale.id, v_method, v_total);
  end if;

  insert into public.stock_movements (
    tenant_id, location_id, product_id, delta, reason, reference_id, created_by
  )
  select v_tenant_id, v_location, l.product_id, -l.quantity, 'sale', v_sale.id, v_cashier
  from jsonb_to_recordset(v_lines) as l(product_id uuid, quantity numeric);

  return v_sale;

exception
  when unique_violation then
    select * into v_sale from public.sales
    where tenant_id = v_tenant_id and client_id = p_client_id;
    if found then
      return v_sale;
    end if;
    raise;
end;
$$;

revoke all on function public.process_sale(text, jsonb, public.payment_method, integer, timestamptz, text, uuid, jsonb, uuid, uuid) from public;
grant execute on function public.process_sale(text, jsonb, public.payment_method, integer, timestamptz, text, uuid, jsonb, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Managing staff
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so a PIN can be set on a row the owner is allowed to manage
-- without granting clients any way to read pin_hash back out.
create or replace function public.upsert_staff(
  p_id          uuid,
  p_name        text,
  p_role        public.shop_role,
  p_location_id uuid default null,
  p_email       text default null
)
returns public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_staff     public.users;
begin
  if v_tenant_id is null then
    raise exception 'No shop on this session' using errcode = 'PS401';
  end if;
  if public.current_shop_role() <> 'owner' then
    raise exception 'Only an owner can manage staff' using errcode = 'PS403';
  end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Give the staff member a name' using errcode = 'PS422';
  end if;
  if p_location_id is not null
     and not exists (select 1 from public.locations
                     where id = p_location_id and tenant_id = v_tenant_id) then
    raise exception 'That location is not in this shop' using errcode = 'PS404';
  end if;

  if p_id is null then
    insert into public.users (tenant_id, name, role, location_id, email, login_enabled)
    values (v_tenant_id, btrim(p_name), p_role, p_location_id,
            nullif(btrim(coalesce(p_email, '')), ''), false)
    returning * into v_staff;
  else
    select * into v_staff from public.users
    where id = p_id and tenant_id = v_tenant_id;
    if not found then
      raise exception 'No such staff member in this shop' using errcode = 'PS404';
    end if;

    -- The last-owner trigger guards demotion, but naming the rule here gives a
    -- better message than a constraint violation.
    if v_staff.role = 'owner' and p_role <> 'owner'
       and (select count(*) from public.users
            where tenant_id = v_tenant_id and role = 'owner' and is_active) <= 1 then
      raise exception 'This is the shop''s only owner' using errcode = 'PS403';
    end if;

    update public.users
    set name = btrim(p_name),
        role = p_role,
        location_id = p_location_id,
        email = coalesce(nullif(btrim(coalesce(p_email, '')), ''), email)
    where id = p_id
    returning * into v_staff;
  end if;

  return v_staff;
end;
$$;

revoke all on function public.upsert_staff(uuid, text, public.shop_role, uuid, text) from public;
grant execute on function public.upsert_staff(uuid, text, public.shop_role, uuid, text) to authenticated;

create or replace function public.set_staff_active(p_id uuid, p_active boolean)
returns public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_staff     public.users;
begin
  if public.current_shop_role() <> 'owner' then
    raise exception 'Only an owner can manage staff' using errcode = 'PS403';
  end if;

  select * into v_staff from public.users
  where id = p_id and tenant_id = v_tenant_id;
  if not found then
    raise exception 'No such staff member in this shop' using errcode = 'PS404';
  end if;

  if not p_active and v_staff.id = auth.uid() then
    raise exception 'You cannot deactivate yourself' using errcode = 'PS403';
  end if;

  update public.users set is_active = p_active where id = p_id
  returning * into v_staff;

  return v_staff;
end;
$$;

revoke all on function public.set_staff_active(uuid, boolean) from public;
grant execute on function public.set_staff_active(uuid, boolean) to authenticated;

-- Clearing a PIN is a separate verb from setting one, so "remove access to the
-- till" does not require inventing a placeholder PIN.
create or replace function public.clear_staff_pin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_shop_role() <> 'owner' then
    raise exception 'Only an owner can manage staff PINs' using errcode = 'PS403';
  end if;

  update public.users
  set pin_hash = null
  where id = p_user_id and tenant_id = public.current_tenant_id();

  if not found then
    raise exception 'No such staff member in this shop' using errcode = 'PS404';
  end if;
end;
$$;

revoke all on function public.clear_staff_pin(uuid) from public;
grant execute on function public.clear_staff_pin(uuid) to authenticated;

-- Who can be picked at the till: active, holds a PIN, and either works at this
-- location or is not tied to one. Never exposes pin_hash.
create or replace function public.till_staff(p_location_id uuid default null)
returns table (id uuid, name text, role public.shop_role)
language sql
stable
set search_path = ''
as $$
  select u.id, u.name, u.role
  from public.users u
  where u.tenant_id = public.current_tenant_id()
    and u.is_active
    and u.pin_hash is not null
    and (u.location_id is null
         or u.location_id = coalesce(p_location_id, public.default_location_id()))
  order by u.name
$$;

grant execute on function public.till_staff(uuid) to authenticated;
