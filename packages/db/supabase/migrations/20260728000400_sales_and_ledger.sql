-- Sales, sale lines, and the append-only stock ledger.

create type public.payment_method  as enum ('cash', 'mobile_money', 'card', 'mixed');
create type public.sale_status     as enum ('completed', 'voided');
create type public.movement_reason as enum ('sale', 'restock', 'adjustment', 'void', 'stocktake');

create table public.sales (
  id         uuid primary key default extensions.gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  cashier_id uuid references public.users (id) on delete set null,

  -- Idempotency key generated on the device before the sale is attempted.
  -- A retry after a dropped connection carries the same one, which is what
  -- stops a flaky network from charging a customer twice.
  client_id  text not null check (length(client_id) between 8 and 64),

  subtotal_cents integer not null check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  tax_cents      integer not null default 0 check (tax_cents >= 0),
  total_cents    integer not null check (total_cents >= 0),

  payment_method public.payment_method not null,
  status         public.sale_status not null default 'completed',

  -- Snapshot of the shop's setting at the time of sale. Shelf prices in these
  -- markets usually include tax, in which case tax_cents is the component
  -- already inside subtotal rather than an amount added on top — and the two
  -- cases balance differently, hence the conditional constraint below.
  tax_inclusive  boolean not null default true,

  -- Set when the shop allows overselling and this sale took something negative.
  -- Surfaces in the owner's dashboard as stock to reconcile.
  has_oversell   boolean not null default false,

  note        text,
  voided_at   timestamptz,
  voided_by   uuid references public.users (id) on delete set null,

  -- When the sale happened on the device, which is not when the server heard
  -- about it. Reports use created_at; sync diagnostics use synced_at.
  created_at timestamptz not null default now(),
  synced_at  timestamptz not null default now(),

  constraint sales_totals_balance check (
    case
      when tax_inclusive then total_cents = subtotal_cents - discount_cents
      else total_cents = subtotal_cents - discount_cents + tax_cents
    end
  ),
  constraint sales_discount_within_subtotal
    check (discount_cents <= subtotal_cents),
  constraint sales_voided_fields_consistent
    check ((status = 'voided') = (voided_at is not null))
);

create unique index sales_tenant_client_id_key on public.sales (tenant_id, client_id);
create index sales_tenant_created_at_idx on public.sales (tenant_id, created_at desc);
create index sales_tenant_cashier_idx on public.sales (tenant_id, cashier_id, created_at desc);
create index sales_oversell_idx on public.sales (tenant_id) where has_oversell;

create table public.sale_items (
  id         uuid primary key default extensions.gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  sale_id    uuid not null references public.sales (id) on delete cascade,

  -- Kept on restrict: deleting a product must not quietly rewrite history.
  -- Owners deactivate products; they don't delete sold ones.
  product_id uuid not null references public.products (id) on delete restrict,

  quantity          numeric(14,3) not null check (quantity > 0),
  unit_price_cents  integer not null check (unit_price_cents >= 0),
  line_total_cents  integer not null check (line_total_cents >= 0),

  -- Snapshots. A receipt reprinted next year must show what was actually sold
  -- and what it cost then, not what the catalog says today.
  name_at_sale      text not null,
  unit_cost_cents   integer not null default 0,

  created_at timestamptz not null default now()
);

create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_tenant_product_idx on public.sale_items (tenant_id, product_id);

-- ---------------------------------------------------------------------------
-- Stock ledger
--
-- Append-only. products.stock_on_hand is a cache of sum(delta) here; when the
-- two disagree this table wins.
-- ---------------------------------------------------------------------------

create table public.stock_movements (
  id         uuid primary key default extensions.gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,

  delta      numeric(14,3) not null check (delta <> 0),
  reason     public.movement_reason not null,

  -- sale_id for 'sale' and 'void', restock/adjustment id otherwise. Deliberately
  -- not a foreign key: it points at different tables depending on reason.
  reference_id uuid,

  -- Purchase price per unit on a restock. Feeds the weighted average cost.
  unit_cost_cents integer check (unit_cost_cents >= 0),

  note       text,
  created_at timestamptz not null default now(),
  created_by uuid references public.users (id) on delete set null,

  constraint stock_movements_restock_has_cost
    check (reason <> 'restock' or unit_cost_cents is not null)
);

create index stock_movements_tenant_product_idx
  on public.stock_movements (tenant_id, product_id, created_at desc);
create index stock_movements_reference_idx
  on public.stock_movements (reference_id) where reference_id is not null;

comment on table public.stock_movements is
  'Append-only ledger. Source of truth for stock. Corrections are new rows with '
  'reason = adjustment, never edits.';

-- Enforce append-only at the table, not by convention. RLS grants no UPDATE or
-- DELETE either, but service-role code bypasses RLS and would otherwise be one
-- careless statement away from destroying the audit trail.
create or replace function public.reject_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception
    'stock_movements is append-only; record a compensating adjustment instead'
    using errcode = 'PS405';
end;
$$;

create trigger stock_movements_append_only
  before update or delete on public.stock_movements
  for each row execute function public.reject_ledger_mutation();

-- ---------------------------------------------------------------------------
-- Cache maintenance
-- ---------------------------------------------------------------------------

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.products p
  set
    stock_on_hand = p.stock_on_hand + new.delta,

    -- Weighted average, and only on inbound restocks. A sale must never move
    -- the cost basis, and negative on-hand is clamped to zero so a shop that
    -- oversold doesn't end up with a nonsensical (or divide-by-zero) average.
    cost_cents = case
      when new.reason = 'restock'
       and new.delta > 0
       and new.unit_cost_cents is not null
      then (
        case
          when greatest(p.stock_on_hand, 0) + new.delta > 0 then
            round(
              ( (greatest(p.stock_on_hand, 0) * p.cost_cents)
              + (new.delta * new.unit_cost_cents) )
              / (greatest(p.stock_on_hand, 0) + new.delta)
            )::integer
          else new.unit_cost_cents
        end
      )
      else p.cost_cents
    end,

    updated_at = now()
  where p.id = new.product_id
    and p.tenant_id = new.tenant_id;

  if not found then
    raise exception 'Product % does not belong to tenant %', new.product_id, new.tenant_id
      using errcode = 'PS404';
  end if;

  return new;
end;
$$;

create trigger stock_movements_apply
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- Rebuild the cache from the ledger. Cheap enough to run nightly, and the thing
-- to reach for if a bug ever lets the two drift.
create or replace function public.recompute_stock_on_hand(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_tenant_id is distinct from public.current_tenant_id()
     and auth.role() <> 'service_role' then
    raise exception 'Not permitted for this tenant' using errcode = 'PS403';
  end if;

  with truth as (
    select p.id,
           coalesce(sum(m.delta), 0) as actual
    from public.products p
    left join public.stock_movements m on m.product_id = p.id
    where p.tenant_id = p_tenant_id
    group by p.id
  )
  update public.products p
  set stock_on_hand = t.actual,
      updated_at = now()
  from truth t
  where p.id = t.id
    and p.stock_on_hand is distinct from t.actual;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

comment on function public.recompute_stock_on_hand(uuid) is
  'Rebuilds products.stock_on_hand from the ledger. Returns the number of rows '
  'that were wrong — a healthy shop returns 0.';
