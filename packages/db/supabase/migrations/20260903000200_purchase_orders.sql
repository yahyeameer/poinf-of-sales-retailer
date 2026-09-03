-- Purchase orders: the loop between "these lines are low" and "the stock arrived".
--
-- Everything needed to spot a reorder already exists — v_low_stock knows what
-- is under its threshold per location, and restock_product folds a delivery
-- into the weighted average cost. What is missing is the document in between.
-- Without it an owner reads the low-stock list, writes the order on paper or in
-- WhatsApp, and then a week later types each delivered line back in by hand
-- with no record of what was ordered, what arrived, or what is still owed.
--
-- A purchase order is that record. Two things it must get right:
--
--   1. Receiving goes through the ledger, not round it. Every received line
--      writes a `restock` movement carrying its unit cost, so the same trigger
--      that maintains products.cost_cents does the averaging. There is no
--      second implementation of cost to drift from the first.
--
--   2. Partial delivery is the normal case, not an error. A supplier who sends
--      8 of 10 leaves the order open for 2. Receiving is therefore per-line and
--      repeatable, and the status is derived from what is outstanding.

set search_path = public, extensions;

create type public.purchase_order_status as enum (
  'draft',      -- being built, not yet placed
  'sent',       -- placed with the supplier, nothing arrived
  'partial',    -- some lines delivered, some outstanding
  'received',   -- everything ordered has arrived
  'cancelled'   -- abandoned; never becomes anything else
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.purchase_orders (
  id          uuid primary key default extensions.gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,

  -- Where the goods are expected to land. Receiving writes the ledger here, so
  -- a delivery into the warehouse cannot silently credit the shop floor.
  location_id uuid not null references public.locations (id),

  -- Per-tenant counter, so the first order a shop places is PO-0001 rather
  -- than a uuid nobody can read down a phone line. Assigned under an advisory
  -- lock in create_purchase_order().
  seq       integer not null,
  reference text generated always as ('PO-' || lpad(seq::text, 4, '0')) stored,

  status public.purchase_order_status not null default 'draft',

  expected_at date,
  note        text,

  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  sent_at      timestamptz,
  received_at  timestamptz,
  cancelled_at timestamptz,

  constraint purchase_orders_seq_unique unique (tenant_id, seq),

  -- A terminal status must carry its timestamp, and vice versa. Without this
  -- a cancelled order with no cancelled_at is indistinguishable from a bug.
  constraint purchase_orders_cancelled_consistent
    check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint purchase_orders_received_consistent
    check (status <> 'received' or received_at is not null)
);

create index purchase_orders_tenant_idx   on public.purchase_orders (tenant_id, created_at desc);
create index purchase_orders_supplier_idx on public.purchase_orders (supplier_id, created_at desc);
create index purchase_orders_location_idx on public.purchase_orders (location_id, created_at desc);
create index purchase_orders_open_idx     on public.purchase_orders (tenant_id, status)
  where status in ('draft', 'sent', 'partial');

create trigger purchase_orders_touch_updated_at
  before update on public.purchase_orders
  for each row execute function public.touch_updated_at();

create table public.purchase_order_lines (
  id                uuid primary key default extensions.gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  product_id        uuid not null references public.products (id) on delete restrict,

  -- numeric, not integer: the catalog sells rice by the kilo and so do its
  -- suppliers.
  quantity_ordered  numeric(14,3) not null check (quantity_ordered > 0),
  quantity_received numeric(14,3) not null default 0 check (quantity_received >= 0),

  -- What the supplier quoted, which is not necessarily what the product
  -- currently averages. This is the figure the ledger records on receipt.
  unit_cost_cents integer not null check (unit_cost_cents >= 0),

  -- Over-delivery is rejected rather than absorbed; see receive_purchase_order.
  constraint purchase_order_lines_not_over_received
    check (quantity_received <= quantity_ordered),

  -- One line per product per order. Two lines for the same thing is a mistake
  -- that makes "how many are still owed" ambiguous.
  constraint purchase_order_lines_one_per_product unique (purchase_order_id, product_id)
);

create index purchase_order_lines_po_idx      on public.purchase_order_lines (purchase_order_id);
create index purchase_order_lines_product_idx on public.purchase_order_lines (product_id);

comment on table public.purchase_orders is
  'What was ordered from whom. Receiving writes restock movements against the '
  'ledger; this table never holds stock figures of its own.';

-- ---------------------------------------------------------------------------
-- RLS
--
-- Owners and managers only, for reads as well as writes: a purchase order is
-- a list of what the shop pays for its goods, and cost is not something a
-- cashier needs. Location-scoped on top of that, so a manager pinned to one
-- branch sees that branch's orders — the same rule 20260817000200 applied to
-- every other table carrying a location.
-- ---------------------------------------------------------------------------

alter table public.purchase_orders      enable row level security;
alter table public.purchase_orders      force  row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.purchase_order_lines force  row level security;

create policy "managers read purchase orders"
  on public.purchase_orders for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
    and public.can_see_location(location_id)
  );

create policy "managers manage purchase orders"
  on public.purchase_orders for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
    and public.can_see_location(location_id)
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
    and public.can_see_location(location_id)
  );

-- Lines have no location of their own; the order they hang off does.
create policy "managers read purchase order lines"
  on public.purchase_order_lines for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
    and exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_lines.purchase_order_id
        and public.can_see_location(po.location_id)
    )
  );

create policy "managers manage purchase order lines"
  on public.purchase_order_lines for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
    and exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_lines.purchase_order_id
        and public.can_see_location(po.location_id)
    )
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager')
    and exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_lines.purchase_order_id
        and public.can_see_location(po.location_id)
    )
  );

grant select on public.purchase_orders, public.purchase_order_lines to authenticated;

-- ---------------------------------------------------------------------------
-- What to order
--
-- The low-stock list turned into a draft. Quantity is what it takes to get
-- back to the reorder point plus the same again as headroom — ordering exactly
-- up to the threshold means the next sale drops straight back under it.
-- ---------------------------------------------------------------------------

create or replace function public.suggest_purchase_lines(
  p_location_id uuid default null
)
returns table (
  product_id      uuid,
  name            text,
  on_hand         numeric,
  reorder_point   numeric,
  suggested_qty   numeric,
  unit_cost_cents integer
)
language sql
stable
set search_path = ''
as $$
  select
    ls.product_id,
    p.name,
    ls.on_hand,
    coalesce(ls.reorder_point, p.reorder_point) as reorder_point,
    ceil(greatest(coalesce(ls.reorder_point, p.reorder_point) * 2 - ls.on_hand, 1))::numeric
      as suggested_qty,
    p.cost_cents as unit_cost_cents
  from public.location_stock ls
  join public.products  p on p.id = ls.product_id
  join public.locations l on l.id = ls.location_id
  where p.is_active
    and l.is_active
    and ls.location_id = coalesce(p_location_id, public.default_location_id())
    and ls.on_hand <= coalesce(ls.reorder_point, p.reorder_point)
  order by p.name
$$;

comment on function public.suggest_purchase_lines(uuid) is
  'Draft order lines for everything at or under its reorder point at one '
  'location. Suggests twice the reorder point less what is on hand, so the '
  'delivery does not arrive already back at the threshold.';

revoke all on function public.suggest_purchase_lines(uuid) from public, anon;
grant execute on function public.suggest_purchase_lines(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Create
-- ---------------------------------------------------------------------------

create or replace function public.create_purchase_order(
  p_supplier_id uuid,
  p_location_id uuid default null,
  p_lines       jsonb default '[]'::jsonb,
  p_expected_at date default null,
  p_note        text default null,
  p_send        boolean default false
)
returns public.purchase_orders
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_location  uuid := coalesce(p_location_id, public.default_location_id());
  v_po        public.purchase_orders;
  v_seq       integer;
  v_line      jsonb;
  v_count     integer := 0;
begin
  if v_tenant_id is null then
    raise exception 'No shop on this session' using errcode = 'PS401';
  end if;

  if public.current_shop_role() not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can place orders' using errcode = 'PS403';
  end if;

  if v_location is null then
    raise exception 'This shop has no location set up' using errcode = 'PS422';
  end if;

  if not exists (
    select 1 from public.suppliers
    where id = p_supplier_id and tenant_id = v_tenant_id and is_active
  ) then
    raise exception 'No such supplier in this shop' using errcode = 'PS404';
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'An order needs at least one line' using errcode = 'PS422';
  end if;

  -- Serialise numbering per tenant. Two managers pressing Create at the same
  -- instant would otherwise both read the same max(seq) and one would lose to
  -- the unique constraint — a confusing failure for something the shop does
  -- rarely enough that a brief lock costs nothing.
  perform pg_advisory_xact_lock(hashtextextended(v_tenant_id::text, 0));

  select coalesce(max(seq), 0) + 1 into v_seq
  from public.purchase_orders where tenant_id = v_tenant_id;

  insert into public.purchase_orders (
    tenant_id, supplier_id, location_id, seq, status,
    expected_at, note, created_by, sent_at
  )
  values (
    v_tenant_id, p_supplier_id, v_location, v_seq,
    (case when p_send then 'sent' else 'draft' end)::public.purchase_order_status,
    p_expected_at, nullif(btrim(p_note), ''), auth.uid(),
    case when p_send then now() else null end
  )
  returning * into v_po;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    if not exists (
      select 1 from public.products
      where id = (v_line ->> 'product_id')::uuid and tenant_id = v_tenant_id
    ) then
      raise exception 'Product % is not in this catalog', v_line ->> 'product_id'
        using errcode = 'PS404';
    end if;

    if coalesce((v_line ->> 'quantity')::numeric, 0) <= 0 then
      raise exception 'Every line needs a quantity above zero' using errcode = 'PS422';
    end if;

    insert into public.purchase_order_lines (
      tenant_id, purchase_order_id, product_id, quantity_ordered, unit_cost_cents
    )
    values (
      v_tenant_id, v_po.id,
      (v_line ->> 'product_id')::uuid,
      (v_line ->> 'quantity')::numeric,
      greatest(coalesce((v_line ->> 'unit_cost_cents')::integer, 0), 0)
    );

    v_count := v_count + 1;
  end loop;

  return v_po;

exception
  -- Two lines for the same product in one submitted order.
  when unique_violation then
    raise exception 'The same product appears twice on this order'
      using errcode = 'PS422';
end;
$$;

revoke all on function public.create_purchase_order(uuid, uuid, jsonb, date, text, boolean) from public, anon;
grant execute on function public.create_purchase_order(uuid, uuid, jsonb, date, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Send
-- ---------------------------------------------------------------------------

create or replace function public.send_purchase_order(p_id uuid)
returns public.purchase_orders
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_po        public.purchase_orders;
begin
  if public.current_shop_role() not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can place orders' using errcode = 'PS403';
  end if;

  select * into v_po from public.purchase_orders
  where id = p_id and tenant_id = v_tenant_id for update;

  if not found then
    raise exception 'Order not found' using errcode = 'PS404';
  end if;

  if v_po.status = 'sent' then
    return v_po;  -- idempotent: a double tap is not an error
  end if;

  if v_po.status <> 'draft' then
    raise exception 'Only a draft can be sent' using errcode = 'PS405';
  end if;

  update public.purchase_orders
  set status = 'sent', sent_at = now()
  where id = p_id
  returning * into v_po;

  return v_po;
end;
$$;

revoke all on function public.send_purchase_order(uuid) from public, anon;
grant execute on function public.send_purchase_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Receive
--
-- The point of the whole feature. Writes one restock movement per received
-- line, at the line's quoted cost and the order's location, tagged with the
-- supplier and referencing the order — so the ledger's own trigger does the
-- weighted-average arithmetic and the movement can be traced back to the
-- document that caused it.
--
-- p_lines null means "everything still outstanding arrived", which is the
-- common case and saves the UI from having to echo the whole order back.
-- ---------------------------------------------------------------------------

create or replace function public.receive_purchase_order(
  p_id    uuid,
  p_lines jsonb default null,
  p_note  text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id  uuid := public.current_tenant_id();
  v_po         public.purchase_orders;
  v_line       public.purchase_order_lines;
  v_incoming   jsonb;
  v_qty        numeric;
  v_lines_done integer := 0;
  v_units      numeric := 0;
  v_outstanding numeric;
begin
  if public.current_shop_role() not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can receive a delivery' using errcode = 'PS403';
  end if;

  select * into v_po from public.purchase_orders
  where id = p_id and tenant_id = v_tenant_id for update;

  if not found then
    raise exception 'Order not found' using errcode = 'PS404';
  end if;

  if v_po.status = 'cancelled' then
    raise exception 'That order was cancelled' using errcode = 'PS405';
  end if;

  if v_po.status = 'received' then
    raise exception 'Everything on that order has already been received'
      using errcode = 'PS405';
  end if;

  for v_line in
    select * from public.purchase_order_lines
    where purchase_order_id = p_id
    order by id
    for update
  loop
    if p_lines is null then
      -- Whole outstanding balance of every line.
      v_qty := v_line.quantity_ordered - v_line.quantity_received;
    else
      select value into v_incoming
      from jsonb_array_elements(p_lines) as value
      where (value ->> 'line_id')::uuid = v_line.id;

      v_qty := coalesce((v_incoming ->> 'quantity')::numeric, 0);
    end if;

    if v_qty is null or v_qty <= 0 then
      continue;  -- nothing arrived for this line this time
    end if;

    v_outstanding := v_line.quantity_ordered - v_line.quantity_received;

    -- Rejected rather than absorbed. Quietly accepting more than was ordered
    -- makes "what is still owed" meaningless, and a genuine over-delivery is
    -- rare enough to be worth recording as its own restock with a note.
    if v_qty > v_outstanding then
      raise exception
        'Only % of that line is still outstanding — record the extra as a restock',
        v_outstanding using errcode = 'PS422';
    end if;

    -- Through the ledger, so apply_stock_movement() folds the delivered cost
    -- into products.cost_cents. There is no second cost implementation here.
    insert into public.stock_movements (
      tenant_id, location_id, product_id, delta, reason,
      unit_cost_cents, supplier_id, reference_id, created_by, note
    )
    values (
      v_tenant_id, v_po.location_id, v_line.product_id, v_qty, 'restock',
      v_line.unit_cost_cents, v_po.supplier_id, v_po.id, auth.uid(),
      coalesce(nullif(btrim(p_note), ''), 'Received on ' || v_po.reference)
    );

    update public.purchase_order_lines
    set quantity_received = quantity_received + v_qty
    where id = v_line.id;

    v_lines_done := v_lines_done + 1;
    v_units      := v_units + v_qty;
  end loop;

  if v_lines_done = 0 then
    raise exception 'Nothing on this delivery to record' using errcode = 'PS422';
  end if;

  -- Status is derived, never set by the caller: it is a statement about what
  -- is outstanding, and anything else can disagree with the lines.
  select coalesce(sum(quantity_ordered - quantity_received), 0) into v_outstanding
  from public.purchase_order_lines where purchase_order_id = p_id;

  update public.purchase_orders
  set status      = (case when v_outstanding <= 0 then 'received' else 'partial' end)::public.purchase_order_status,
      received_at = case when v_outstanding <= 0 then now() else received_at end,
      -- A delivery against a draft means it was placed, whatever the UI did.
      sent_at     = coalesce(sent_at, now())
  where id = p_id
  returning * into v_po;

  return jsonb_build_object(
    'purchase_order_id', v_po.id,
    'reference',         v_po.reference,
    'status',            v_po.status,
    'lines_received',    v_lines_done,
    'units_received',    v_units,
    'units_outstanding', v_outstanding
  );
end;
$$;

revoke all on function public.receive_purchase_order(uuid, jsonb, text) from public, anon;
grant execute on function public.receive_purchase_order(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Cancel
-- ---------------------------------------------------------------------------

create or replace function public.cancel_purchase_order(
  p_id     uuid,
  p_reason text default null
)
returns public.purchase_orders
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_po        public.purchase_orders;
begin
  if public.current_shop_role() not in ('owner', 'manager') then
    raise exception 'Only an owner or manager can cancel an order' using errcode = 'PS403';
  end if;

  select * into v_po from public.purchase_orders
  where id = p_id and tenant_id = v_tenant_id for update;

  if not found then
    raise exception 'Order not found' using errcode = 'PS404';
  end if;

  if v_po.status = 'cancelled' then
    return v_po;  -- idempotent
  end if;

  -- A partly-delivered order has ledger entries against it. Cancelling would
  -- claim the delivery never happened while the stock sits on the shelf.
  if v_po.status = 'received'
     or exists (
       select 1 from public.purchase_order_lines
       where purchase_order_id = p_id and quantity_received > 0
     ) then
    raise exception 'Stock has already been received against this order'
      using errcode = 'PS405';
  end if;

  update public.purchase_orders
  set status = 'cancelled',
      cancelled_at = now(),
      note = coalesce(nullif(btrim(p_reason), ''), note)
  where id = p_id
  returning * into v_po;

  return v_po;
end;
$$;

revoke all on function public.cancel_purchase_order(uuid, text) from public, anon;
grant execute on function public.cancel_purchase_order(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading list
-- ---------------------------------------------------------------------------

create view public.v_purchase_orders
with (security_invoker = on) as
select
  po.id,
  po.tenant_id,
  po.reference,
  po.status,
  po.expected_at,
  po.created_at,
  po.received_at,
  po.note,
  po.supplier_id,
  s.name as supplier_name,
  po.location_id,
  l.name as location_name,
  count(pol.id)                                                as lines,
  coalesce(sum(pol.quantity_ordered), 0)                       as units_ordered,
  coalesce(sum(pol.quantity_received), 0)                      as units_received,
  coalesce(sum(pol.quantity_ordered * pol.unit_cost_cents), 0)::bigint as total_cost_cents
from public.purchase_orders po
join public.suppliers s on s.id = po.supplier_id
join public.locations l on l.id = po.location_id
left join public.purchase_order_lines pol on pol.purchase_order_id = po.id
group by po.id, s.name, l.name;

comment on view public.v_purchase_orders is
  'One row per order with its totals. total_cost_cents is what was ordered, '
  'not what has arrived — compare units_received against units_ordered for that.';
