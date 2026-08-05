-- Phase 1: the things that make this a till rather than a dashboard.
--
--   shifts + cash_movements  who opened the drawer, with how much, and what
--                            was in it at close
--   sale_payments            one sale, several tenders
--   refunds                  sales that carry negative signs
--   parked_sales             the customer who forgot their wallet
--
-- The shift is the part people forget until it hurts. Without it shrinkage is
-- invisible, which is the exact problem this product claims to solve.

-- ---------------------------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------------------------

create type public.shift_status as enum ('open', 'closed');

create table public.shifts (
  id         uuid primary key default extensions.gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,

  opened_by  uuid references public.users (id) on delete set null,
  opened_at  timestamptz not null default now(),
  opening_float_cents integer not null default 0 check (opening_float_cents >= 0),

  closed_by  uuid references public.users (id) on delete set null,
  closed_at  timestamptz,

  -- Counted first, expected revealed afterwards. A cashier who can see the
  -- target before counting will, sooner or later, count to it.
  counted_cash_cents  integer check (counted_cash_cents >= 0),
  expected_cash_cents integer,
  variance_cents      integer,

  status public.shift_status not null default 'open',
  note   text,

  constraint shifts_closed_fields_consistent check (
    (status = 'closed') = (closed_at is not null)
  ),
  constraint shifts_closed_has_count check (
    status = 'open' or counted_cash_cents is not null
  )
);

-- One open shift per shop. The partial unique index is what actually enforces
-- it; without this two devices can both "open" and the drawer never balances.
create unique index shifts_one_open_per_tenant
  on public.shifts (tenant_id) where status = 'open';

create index shifts_tenant_opened_idx on public.shifts (tenant_id, opened_at desc);

comment on table public.shifts is
  'A cashier session against the cash drawer. expected_cash_cents is computed at '
  'close from float + cash taken - cash refunded + pay-ins - pay-outs.';

-- ---------------------------------------------------------------------------
-- Cash that moves without being a sale
-- ---------------------------------------------------------------------------

create type public.cash_movement_kind as enum ('pay_in', 'pay_out', 'drop');

create table public.cash_movements (
  id         uuid primary key default extensions.gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  shift_id   uuid not null references public.shifts (id) on delete cascade,

  kind   public.cash_movement_kind not null,
  -- Always positive; the kind carries the direction. Storing a signed amount
  -- invites a pay-out recorded as a positive number that quietly inflates the
  -- expected drawer.
  amount_cents integer not null check (amount_cents > 0),
  reason text not null check (length(btrim(reason)) between 1 and 200),

  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index cash_movements_shift_idx on public.cash_movements (shift_id, created_at);

comment on column public.cash_movements.kind is
  'pay_in adds to the drawer, pay_out and drop remove from it. A drop is cash '
  'moved to the safe mid-shift, tracked separately so it is not read as an expense.';

-- ---------------------------------------------------------------------------
-- Split tender
-- ---------------------------------------------------------------------------

create table public.sale_payments (
  id        uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  sale_id   uuid not null references public.sales (id) on delete cascade,

  method       public.payment_method not null,
  -- Negative on a refund, so a sale and its refund net to zero here too.
  amount_cents integer not null check (amount_cents <> 0),

  -- What the customer handed over, when it was cash. Change is tendered minus
  -- amount; storing it means the receipt can be reprinted exactly.
  tendered_cents integer check (tendered_cents >= 0),

  reference text,   -- mobile-money transaction id, card auth code
  created_at timestamptz not null default now()
);

create index sale_payments_sale_idx on public.sale_payments (sale_id);
create index sale_payments_tenant_method_idx on public.sale_payments (tenant_id, method);

comment on table public.sale_payments is
  'One row per tender. sales.payment_method stays as a denormalised summary and '
  'reads "mixed" when there is more than one row here.';

-- ---------------------------------------------------------------------------
-- Refunds
--
-- A refund is a sale with negative signs, not a separate document. That way
-- every revenue figure in the system is still sum(total_cents) and nets
-- correctly with no special-casing in a single report.
-- ---------------------------------------------------------------------------

create type public.sale_kind as enum ('sale', 'refund');

alter table public.sales
  add column kind public.sale_kind not null default 'sale',
  add column original_sale_id uuid references public.sales (id) on delete restrict,
  add column shift_id uuid references public.shifts (id) on delete set null;

create index sales_original_idx on public.sales (original_sale_id) where original_sale_id is not null;
create index sales_shift_idx on public.sales (shift_id) where shift_id is not null;

-- The amount checks assumed a sale can only ever be positive. Replace them with
-- sign rules that follow the kind.
alter table public.sales
  drop constraint sales_subtotal_cents_check,
  drop constraint sales_discount_cents_check,
  drop constraint sales_tax_cents_check,
  drop constraint sales_total_cents_check,
  drop constraint sales_discount_within_subtotal;

alter table public.sales
  add constraint sales_amounts_follow_kind check (
    case kind
      when 'refund' then
        subtotal_cents <= 0 and discount_cents <= 0
        and tax_cents <= 0 and total_cents <= 0
      else
        subtotal_cents >= 0 and discount_cents >= 0
        and tax_cents >= 0 and total_cents >= 0
    end
  ),
  add constraint sales_discount_within_subtotal
    check (abs(discount_cents) <= abs(subtotal_cents)),
  add constraint sales_refund_references_original
    check ((kind = 'refund') = (original_sale_id is not null));

-- Line quantities go negative on a refund, so units sold nets out across a sale
-- and its return without the reports having to know refunds exist.
alter table public.sale_items
  drop constraint sale_items_quantity_check,
  drop constraint sale_items_line_total_cents_check;

alter table public.sale_items
  add constraint sale_items_quantity_nonzero check (quantity <> 0),
  add constraint sale_items_line_total_matches_sign
    check (sign(line_total_cents)::numeric = sign(quantity) or line_total_cents = 0);

-- Stock coming back needs its own reason, distinct from a void of the whole sale.
alter type public.movement_reason add value if not exists 'refund';

-- ---------------------------------------------------------------------------
-- Parked sales
--
-- Deliberately not part of the ledger: nothing has been sold, no stock has
-- moved. It is a cart on a shelf, so it lives as a blob and is deleted on resume.
-- ---------------------------------------------------------------------------

create table public.parked_sales (
  id         uuid primary key default extensions.gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  parked_by  uuid references public.users (id) on delete set null,
  label      text not null check (length(btrim(label)) between 1 and 60),
  cart       jsonb not null,
  created_at timestamptz not null default now()
);

create index parked_sales_tenant_idx on public.parked_sales (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS — same shape as everything else: tenant scope, role gates writes
-- ---------------------------------------------------------------------------

alter table public.shifts         enable row level security;
alter table public.cash_movements enable row level security;
alter table public.sale_payments  enable row level security;
alter table public.parked_sales   enable row level security;

alter table public.shifts         force row level security;
alter table public.cash_movements force row level security;
alter table public.sale_payments  force row level security;

create policy "members read shifts"
  on public.shifts for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "staff run shifts"
  on public.shifts for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager', 'cashier')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager', 'cashier')
  );

create policy "members read cash movements"
  on public.cash_movements for select to authenticated
  using (tenant_id = public.current_tenant_id());

-- Insert only. A pay-out that turns out to be wrong is corrected with an
-- opposing entry, exactly like the stock ledger.
create policy "staff record cash movements"
  on public.cash_movements for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager', 'cashier')
  );

create policy "members read sale payments"
  on public.sale_payments for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy "staff record sale payments"
  on public.sale_payments for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager', 'cashier')
  );

create policy "staff manage parked sales"
  on public.parked_sales for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager', 'cashier')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_shop_role() in ('owner', 'manager', 'cashier')
  );
