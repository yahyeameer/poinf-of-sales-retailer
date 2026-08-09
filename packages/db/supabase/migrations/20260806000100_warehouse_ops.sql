-- Warehouse operations: moving stock between locations, and counting it.
--
-- Both are expressed as ledger movements rather than new document tables. A
-- transfer is a pair of opposing entries under one reference_id; a stocktake is
-- the difference between what was counted and what the ledger believed. Nothing
-- here can set a balance directly -- that is still the trigger's job, driven off
-- movements, which is what keeps the cache honest.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Multi-line transfers
--
-- transfer_stock() moves one product. A real consignment is a pallet of thirty
-- lines that has to arrive as one document, so this does the whole thing in one
-- transaction under a shared reference_id.
-- ---------------------------------------------------------------------------

create or replace function public.transfer_stock_batch(
  p_from_location uuid,
  p_to_location   uuid,
  p_lines         jsonb,   -- [{ "product_id": uuid, "quantity": number }]
  p_note          text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_ref       uuid := extensions.gen_random_uuid();
  v_line      jsonb;
  v_qty       numeric(14,3);
  v_product   uuid;
  v_available numeric(14,3);
  v_name      text;
  v_count     integer := 0;
  v_units     numeric(14,3) := 0;
begin
  if v_tenant_id is null then
    raise exception 'No shop on this session' using errcode = 'PS401';
  end if;
  if public.current_shop_role() not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can move stock between locations'
      using errcode = 'PS403';
  end if;
  if p_from_location = p_to_location then
    raise exception 'Pick two different locations' using errcode = 'PS422';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one product to the transfer' using errcode = 'PS422';
  end if;

  -- Both ends must belong to this shop. RLS would stop a cross-tenant write at
  -- the movement insert, but failing here names the problem instead of throwing
  -- a policy violation at someone who mistyped an id.
  if not exists (select 1 from public.locations
                 where id = p_from_location and tenant_id = v_tenant_id and is_active)
     or not exists (select 1 from public.locations
                 where id = p_to_location and tenant_id = v_tenant_id and is_active) then
    raise exception 'One of those locations is not in this shop' using errcode = 'PS404';
  end if;

  -- Ordered by product_id so two transfers touching the same products from
  -- opposite directions cannot deadlock against each other.
  for v_line in
    select value from jsonb_array_elements(p_lines) as t(value)
    order by (value ->> 'product_id')::uuid
  loop
    v_product := (v_line ->> 'product_id')::uuid;
    v_qty     := (v_line ->> 'quantity')::numeric;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Every line needs a quantity above zero' using errcode = 'PS422';
    end if;

    select p.name into v_name from public.products p
    where p.id = v_product and p.tenant_id = v_tenant_id;
    if not found then
      raise exception 'Product % is not in this shop', v_product using errcode = 'PS404';
    end if;

    select ls.on_hand into v_available
    from public.location_stock ls
    where ls.location_id = p_from_location and ls.product_id = v_product
    for update;

    -- A transfer is not a sale, so allow_oversell does not apply: you cannot
    -- put stock on a lorry that is not on the shelf, whatever the setting says.
    if coalesce(v_available, 0) < v_qty then
      raise exception 'Only % of "%" at the source location', coalesce(v_available, 0), v_name
        using errcode = 'PS422', detail = v_product::text;
    end if;

    insert into public.stock_movements
      (tenant_id, location_id, product_id, delta, reason, reference_id, created_by, note)
    values
      (v_tenant_id, p_from_location, v_product, -v_qty, 'adjustment', v_ref, auth.uid(),
       coalesce(nullif(btrim(p_note), '') || ' ', '') || '(transfer out)'),
      (v_tenant_id, p_to_location,   v_product,  v_qty, 'adjustment', v_ref, auth.uid(),
       coalesce(nullif(btrim(p_note), '') || ' ', '') || '(transfer in)');

    v_count := v_count + 1;
    v_units := v_units + v_qty;
  end loop;

  return jsonb_build_object(
    'reference_id', v_ref,
    'lines', v_count,
    'units', v_units
  );
end;
$$;

revoke all on function public.transfer_stock_batch(uuid, uuid, jsonb, text) from public;
grant execute on function public.transfer_stock_batch(uuid, uuid, jsonb, text) to authenticated;

comment on function public.transfer_stock_batch(uuid, uuid, jsonb, text) is
  'Moves several products between two locations in one transaction under a shared '
  'reference_id. Refuses to move more than the source holds regardless of the '
  'shop''s allow_oversell setting -- overselling a shelf is a business decision, '
  'loading a lorry with stock that is not there is not.';

-- ---------------------------------------------------------------------------
-- Stocktake
--
-- Takes counted quantities and writes only the DIFFERENCE from what the ledger
-- believed. Writing an absolute figure would silently discard whatever happened
-- between the count starting and being submitted.
-- ---------------------------------------------------------------------------

create or replace function public.apply_stocktake(
  p_location_id uuid,
  p_counts      jsonb,   -- [{ "product_id": uuid, "counted": number }]
  p_note        text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_ref       uuid := extensions.gen_random_uuid();
  v_line      jsonb;
  v_product   uuid;
  v_counted   numeric(14,3);
  v_expected  numeric(14,3);
  v_delta     numeric(14,3);
  v_adjusted  integer := 0;
  v_shrink    numeric(14,3) := 0;
  v_surplus   numeric(14,3) := 0;
begin
  if v_tenant_id is null then
    raise exception 'No shop on this session' using errcode = 'PS401';
  end if;
  if public.current_shop_role() not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can commit a stocktake'
      using errcode = 'PS403';
  end if;
  if not exists (select 1 from public.locations
                 where id = p_location_id and tenant_id = v_tenant_id) then
    raise exception 'That location is not in this shop' using errcode = 'PS404';
  end if;

  for v_line in
    select value from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) as t(value)
    order by (value ->> 'product_id')::uuid
  loop
    v_product := (v_line ->> 'product_id')::uuid;
    v_counted := (v_line ->> 'counted')::numeric;

    if v_counted is null or v_counted < 0 then
      raise exception 'A counted quantity cannot be negative' using errcode = 'PS422';
    end if;

    select coalesce(ls.on_hand, 0) into v_expected
    from public.location_stock ls
    where ls.location_id = p_location_id and ls.product_id = v_product
    for update;

    v_expected := coalesce(v_expected, 0);
    v_delta    := v_counted - v_expected;

    -- A line that already agrees needs no ledger entry. Writing zero-deltas
    -- would bloat the ledger with noise on every count.
    if v_delta = 0 then
      continue;
    end if;

    insert into public.stock_movements
      (tenant_id, location_id, product_id, delta, reason, reference_id, created_by, note)
    values
      (v_tenant_id, p_location_id, v_product, v_delta, 'stocktake', v_ref, auth.uid(),
       coalesce(nullif(btrim(p_note), ''), 'Stocktake')
         || ' (counted ' || v_counted || ', expected ' || v_expected || ')');

    v_adjusted := v_adjusted + 1;
    if v_delta < 0 then
      v_shrink := v_shrink + (-v_delta);
    else
      v_surplus := v_surplus + v_delta;
    end if;
  end loop;

  return jsonb_build_object(
    'reference_id',   v_ref,
    'lines_adjusted', v_adjusted,
    'units_missing',  v_shrink,
    'units_surplus',  v_surplus
  );
end;
$$;

revoke all on function public.apply_stocktake(uuid, jsonb, text) from public;
grant execute on function public.apply_stocktake(uuid, jsonb, text) to authenticated;

comment on function public.apply_stocktake(uuid, jsonb, text) is
  'Writes the difference between counted and expected, never an absolute figure, '
  'so a sale that happens while the count is in progress is not erased by it.';

-- ---------------------------------------------------------------------------
-- Transfers as documents
--
-- The ledger stores a transfer as opposing pairs. This puts them back together
-- so the UI can show "12 lines, Main -> Warehouse, Tuesday" instead of 24 rows.
-- ---------------------------------------------------------------------------

create or replace view public.v_transfers
with (security_invoker = on) as
select
  m.reference_id,
  m.tenant_id,
  min(m.created_at)                              as moved_at,
  -- uuid has no max() aggregate; every row in a group shares a created_by
  -- anyway, so take the first.
  (array_agg(m.created_by))[1]                   as moved_by,
  max(from_loc.name) filter (where m.delta < 0)  as from_location,
  max(to_loc.name)   filter (where m.delta > 0)  as to_location,
  (array_agg(m.location_id) filter (where m.delta < 0))[1] as from_location_id,
  (array_agg(m.location_id) filter (where m.delta > 0))[1] as to_location_id,
  count(*) filter (where m.delta > 0)            as lines,
  sum(m.delta) filter (where m.delta > 0)        as units,
  -- A transfer must net to zero: same goods, different shelf. Anything else
  -- means a half-written document and is worth surfacing rather than hiding.
  sum(m.delta)                                   as net_delta
from public.stock_movements m
left join public.locations from_loc on from_loc.id = m.location_id and m.delta < 0
left join public.locations to_loc   on to_loc.id   = m.location_id and m.delta > 0
where m.reason = 'adjustment'
  and m.reference_id is not null
  and m.note like '%(transfer %'
group by m.reference_id, m.tenant_id
having count(*) filter (where m.delta > 0) > 0
   and count(*) filter (where m.delta < 0) > 0;

comment on view public.v_transfers is
  'Reassembles paired ledger entries into transfer documents. net_delta should '
  'always be zero; a non-zero value means the pair is broken.';

create or replace view public.v_stocktakes
with (security_invoker = on) as
select
  m.reference_id,
  m.tenant_id,
  m.location_id,
  max(l.name)                             as location_name,
  min(m.created_at)                       as counted_at,
  (array_agg(m.created_by))[1]            as counted_by,
  count(*)                                as lines_adjusted,
  sum(-m.delta) filter (where m.delta < 0) as units_missing,
  sum(m.delta)  filter (where m.delta > 0) as units_surplus
from public.stock_movements m
join public.locations l on l.id = m.location_id
where m.reason = 'stocktake'
  and m.reference_id is not null
group by m.reference_id, m.tenant_id, m.location_id;
