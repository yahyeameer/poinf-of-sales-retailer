-- Demo shop for local development.
--
-- Login: owner@demo.shop / demo1234   ·   staff PIN 1234
--
-- Deliberately seeded *through* the RLS policies rather than around them: the
-- catalog and sales below are inserted as the `authenticated` role with a
-- tenant_id claim set, and the sales go through process_sale(). If a policy or
-- the ledger is wrong, `npm run db:reset` fails loudly instead of quietly
-- producing data no real client could have written.

set search_path = public, extensions;

-- Fixed ids so fixtures and manual testing can rely on them.
\set tenant_id  '11111111-1111-4111-8111-111111111111'
\set owner_id   '22222222-2222-4222-8222-222222222222'
\set cashier_id '33333333-3333-4333-8333-333333333333'

begin;

-- ---------------------------------------------------------------------------
-- Auth users. Normally created by GoTrue; here we write them directly.
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000000', :'owner_id', 'authenticated', 'authenticated',
   'owner@demo.shop', crypt('demo1234', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Amina (owner)"}'),
  ('00000000-0000-0000-0000-000000000000', :'cashier_id', 'authenticated', 'authenticated',
   'cashier@demo.shop', crypt('demo1234', gen_salt('bf')),
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Yusuf (cashier)"}');

insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
values
  (:'owner_id',   :'owner_id',
   format('{"sub":"%s","email":"owner@demo.shop"}', :'owner_id')::jsonb,   'email', now(), now()),
  (:'cashier_id', :'cashier_id',
   format('{"sub":"%s","email":"cashier@demo.shop"}', :'cashier_id')::jsonb, 'email', now(), now());

-- ---------------------------------------------------------------------------
-- The shop. 15% VAT, already inside the shelf price.
-- ---------------------------------------------------------------------------

insert into public.tenants (id, name, currency, tax_rate, tax_inclusive, plan, min_margin_pct)
values (:'tenant_id', 'Demo Mini-Mart', 'USD', 0.15, true, 'pro', 12);

-- handle_new_auth_user() already made these rows; attach them to the shop.
update public.users set tenant_id = :'tenant_id', role = 'owner'   where id = :'owner_id';
update public.users set tenant_id = :'tenant_id', role = 'cashier' where id = :'cashier_id';

update public.users
set pin_hash = crypt('1234', gen_salt('bf', 10))
where tenant_id = :'tenant_id';

commit;

-- ---------------------------------------------------------------------------
-- Everything below runs as a signed-in owner, subject to RLS.
-- ---------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',       :'owner_id',
    'role',      'authenticated',
    'tenant_id', :'tenant_id',
    'shop_role', 'owner'
  )::text,
  false
);
set role authenticated;

insert into public.categories (tenant_id, name) values
  (:'tenant_id', 'beverage'),
  (:'tenant_id', 'snack'),
  (:'tenant_id', 'staple'),
  (:'tenant_id', 'personal care'),
  (:'tenant_id', 'household');

insert into public.products
  (tenant_id, category_id, name, sku, barcode, price_cents, unit, reorder_point)
select
  :'tenant_id',
  (select id from public.categories where tenant_id = :'tenant_id'::uuid and name = v.category),
  v.name, v.sku, v.barcode, v.price_cents, v.unit::public.product_unit, v.reorder_point
from (values
  ('Coca-Cola 500ml',          'BEV-001', '5449000000996', 120, 'beverage',      'each', 24),
  ('Fanta Orange 500ml',       'BEV-002', '5449000011527', 120, 'beverage',      'each', 24),
  ('Sprite 500ml',             'BEV-003', '5449000014535', 120, 'beverage',      'each', 24),
  ('Bottled Water 1.5L',       'BEV-004', '6001240100059',  80, 'beverage',      'each', 36),
  ('Mango Juice 1L',           'BEV-005', '6009880110025', 210, 'beverage',      'each', 12),
  ('Energy Drink 250ml',       'BEV-006', '9002490100084', 250, 'beverage',      'each', 12),
  ('Instant Coffee 100g',      'BEV-007', '7613036165327', 480, 'beverage',      'each',  6),
  ('Tea Bags 100ct',           'BEV-008', '6009178740013', 340, 'beverage',      'pack',  6),
  ('Powdered Milk 400g',       'BEV-009', '6001068600014', 520, 'beverage',      'each',  8),
  ('Potato Chips 150g',        'SNK-001', '5000328200019', 180, 'snack',         'each', 18),
  ('Salted Peanuts 100g',      'SNK-002', '6009695780116',  90, 'snack',         'each', 24),
  ('Chocolate Bar 45g',        'SNK-003', '7622300336738', 110, 'snack',         'each', 30),
  ('Biscuits 200g',            'SNK-004', '6001056000015', 140, 'snack',         'pack', 18),
  ('Chewing Gum 10ct',         'SNK-005', '7622210419811',  50, 'snack',         'pack', 40),
  ('Instant Noodles 70g',      'SNK-006', '8888196181017',   60, 'snack',        'each', 48),
  ('Popcorn 80g',              'SNK-007', null,             100, 'snack',        'each', 12),
  ('Rice 5kg',                 'STP-001', '6009182310017', 1450, 'staple',       'pack',  6),
  ('Rice (loose)',             'STP-002', null,             310, 'staple',       'kg',   20),
  ('Sugar 1kg',                'STP-003', '6009178730014',  240, 'staple',       'each', 12),
  ('Cooking Oil 1L',           'STP-004', '6001275000019',  420, 'staple',       'each', 12),
  ('Wheat Flour 2kg',          'STP-005', '6009184920016',  380, 'staple',       'pack',  8),
  ('Beans (loose)',            'STP-006', null,             290, 'staple',       'kg',   15),
  ('Salt 500g',                'STP-007', '6001240300015',   60, 'staple',       'each', 12),
  ('Tomato Paste 400g',        'STP-008', '6111245900017',  130, 'staple',       'each', 18),
  ('Pasta 500g',               'STP-009', '8076809513722',  160, 'staple',       'pack', 12),
  ('Eggs (tray of 30)',        'STP-010', null,             820, 'staple',       'pack',  4),
  ('Bar Soap 175g',            'PER-001', '6001056007014',   95, 'personal care', 'each', 24),
  ('Toothpaste 100ml',         'PER-002', '8901030574016',  210, 'personal care', 'each', 12),
  ('Toothbrush',               'PER-003', '8901030728594',  120, 'personal care', 'each', 12),
  ('Shampoo Sachet 12ml',      'PER-004', null,              25, 'personal care', 'each', 60),
  ('Body Lotion 400ml',        'PER-005', '6001106112349',  480, 'personal care', 'each',  6),
  ('Razor Blades 5ct',         'PER-006', '7702018867349',  190, 'personal care', 'pack', 10),
  ('Sanitary Pads 8ct',        'PER-007', '6009695781014',  230, 'personal care', 'pack', 12),
  ('Tissue Roll',              'PER-008', null,              70, 'personal care', 'each', 36),
  ('Laundry Powder 1kg',       'HOU-001', '6001085001010',  390, 'household',     'each',  8),
  ('Dish Soap 750ml',          'HOU-002', '6001085002017',  260, 'household',     'each', 10),
  ('Bleach 750ml',             'HOU-003', '6001085003014',  180, 'household',     'each', 10),
  ('Matches (10 boxes)',       'HOU-004', null,              40, 'household',     'pack', 20),
  ('Candles 6ct',              'HOU-005', null,             150, 'household',     'pack', 12),
  ('Batteries AA 4ct',         'HOU-006', '5000394001718',  280, 'household',     'pack', 10)
) as v(name, sku, barcode, price_cents, category, unit, reorder_point);

-- ---------------------------------------------------------------------------
-- Opening stock, via the ledger. This is also what sets each product's
-- weighted average cost, so margins in the dashboard are real.
-- ---------------------------------------------------------------------------

insert into public.stock_movements
  (tenant_id, product_id, delta, reason, unit_cost_cents, created_by, note)
select
  :'tenant_id',
  p.id,
  -- Comfortably more than two weeks of trading will consume. The shop does not
  -- allow overselling, so a thin opening stock would make the seed itself fail.
  case p.unit when 'kg' then 150 else 240 end,
  'restock',
  -- ~30% gross margin, jittered a little so the reports aren't suspiciously flat.
  greatest(1, round(p.price_cents * (0.62 + (random() * 0.12)))::integer),
  :'owner_id',
  'Opening stock'
from public.products p
where p.tenant_id = :'tenant_id'::uuid;

-- ---------------------------------------------------------------------------
-- Two weeks of trading.
--
-- Weighted toward late afternoon and toward the weekend, so "busiest day" and
-- "busiest hour" in the weekly digest have something defensible to say.
-- ---------------------------------------------------------------------------

do $$
declare
  v_tenant  uuid := '11111111-1111-4111-8111-111111111111';
  v_day     integer;
  v_sale    integer;
  v_sales_today integer;
  v_lines   jsonb;
  v_ts      timestamptz;
  v_method  public.payment_method;
begin
  perform setseed(0.42);

  for v_day in reverse 13 .. 0 loop
    v_ts := date_trunc('day', now()) - make_interval(days => v_day);

    -- Friday and Saturday run hot.
    v_sales_today := case when extract(dow from v_ts) in (5, 6)
                          then 26 + floor(random() * 12)::integer
                          else 14 + floor(random() * 10)::integer end;

    for v_sale in 1 .. v_sales_today loop
      select jsonb_agg(jsonb_build_object(
               'product_id',       t.id,
               'quantity',         t.qty,
               'unit_price_cents', t.price_cents
             ))
      into v_lines
      from (
        select p.id,
               p.price_cents,
               case when p.unit = 'kg'
                    then round((0.5 + random() * 2)::numeric, 3)
                    else (1 + floor(random() * 3))::numeric end as qty
        from public.products p
        where p.tenant_id = v_tenant
        order by random()
        limit 1 + floor(random() * 5)::integer
      ) t;

      v_method := case
        when random() < 0.55 then 'cash'
        when random() < 0.85 then 'mobile_money'
        else 'card'
      end::public.payment_method;

      perform public.process_sale(
        p_client_id      => 'seed-' || v_day || '-' || v_sale || '-' || md5(random()::text),
        p_items          => v_lines,
        p_payment_method => v_method,
        p_discount_cents => case when random() < 0.06 then 50 else 0 end,
        -- Trading hours 08:00–20:00, busiest around 17:00.
        p_created_at     => v_ts
                            + make_interval(hours  => 8 + floor(power(random(), 0.65) * 12)::integer)
                            + make_interval(mins   => floor(random() * 60)::integer)
      );
    end loop;
  end loop;
end $$;

-- A couple of dead-stock candidates: plenty on the shelf, nothing sold lately.
insert into public.stock_movements (tenant_id, product_id, delta, reason, unit_cost_cents, created_by, note)
select :'tenant_id', p.id, 40, 'restock', round(p.price_cents * 0.7)::integer, :'owner_id',
       'Overordered — do not sell down'
from public.products p
where p.tenant_id = :'tenant_id'::uuid
  and p.sku in ('PER-005', 'HOU-006');

reset role;
select set_config('request.jwt.claims', null, false);

-- Cache and ledger must agree after all that. Returns 0 on a healthy seed.
do $$
declare v_drift integer;
begin
  select public.recompute_stock_on_hand('11111111-1111-4111-8111-111111111111') into v_drift;
  if v_drift <> 0 then
    raise exception 'Seed left % product(s) with stock_on_hand out of step with the ledger', v_drift;
  end if;
  raise notice 'Seed complete: stock cache agrees with the ledger.';
end $$;
