\set ON_ERROR_STOP on
select public.act_as('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','owner');
set role authenticated;

\echo '=== T1 suggest lines from what is under the reorder point'
select name, on_hand, reorder_point, suggested_qty
from public.suggest_purchase_lines('acacacac-0000-0000-0000-000000000001');

\echo '=== T2 create an order (reference should be PO-0001)'
select reference, status, seq from public.create_purchase_order(
  p_supplier_id => (select id from public.suppliers where name='Nairobi Wholesalers'),
  p_location_id => 'acacacac-0000-0000-0000-000000000001',
  p_lines => '[{"product_id":"9d000000-0000-0000-0000-000000000001","quantity":10,"unit_cost_cents":100000}]'::jsonb,
  p_send => true
);

\echo '=== T3 second order numbers sequentially'
select reference from public.create_purchase_order(
  p_supplier_id => (select id from public.suppliers where name='Nairobi Wholesalers'),
  p_location_id => 'acacacac-0000-0000-0000-000000000001',
  p_lines => '[{"product_id":"9d000000-0000-0000-0000-000000000002","quantity":3,"unit_cost_cents":15000}]'::jsonb
);

\echo '=== T4 duplicate product on one order -> PS422'
do $$ begin
  perform public.create_purchase_order(
    p_supplier_id => (select id from public.suppliers where name='Nairobi Wholesalers'),
    p_location_id => 'acacacac-0000-0000-0000-000000000001',
    p_lines => '[{"product_id":"9d000000-0000-0000-0000-000000000001","quantity":1,"unit_cost_cents":1},
                 {"product_id":"9d000000-0000-0000-0000-000000000001","quantity":2,"unit_cost_cents":2}]'::jsonb);
  raise exception 'FAIL duplicate product accepted';
exception when sqlstate 'PS422' then raise notice 'PASS duplicate product -> PS422'; end $$;

\echo '=== T5 partial receipt: 4 of 10. Cost was 900.00 on 0 units; 4 arrive at 1000.00'
select public.receive_purchase_order(
  (select id from public.purchase_orders where seq=1),
  format('[{"line_id":"%s","quantity":4}]',
    (select pol.id from public.purchase_order_lines pol join public.purchase_orders po on po.id=pol.purchase_order_id where po.seq=1))::jsonb
);
select status from public.purchase_orders where seq=1;
select stock_on_hand, cost_cents as avg_cost from public.products where id='9d000000-0000-0000-0000-000000000001';

\echo '=== T6 over-receipt of the remaining 6 (ask for 7) -> PS422'
do $$ declare v uuid; begin
  select pol.id into v from public.purchase_order_lines pol join public.purchase_orders po on po.id=pol.purchase_order_id where po.seq=1;
  perform public.receive_purchase_order((select id from public.purchase_orders where seq=1),
    format('[{"line_id":"%s","quantity":7}]', v)::jsonb);
  raise exception 'FAIL over-receipt accepted';
exception when sqlstate 'PS422' then raise notice 'PASS over-receipt -> PS422'; end $$;

\echo '=== T7 receive the rest (null = everything outstanding) -> status received'
select public.receive_purchase_order((select id from public.purchase_orders where seq=1));
select status, received_at is not null as has_timestamp from public.purchase_orders where seq=1;
select stock_on_hand, cost_cents as avg_cost from public.products where id='9d000000-0000-0000-0000-000000000001';

\echo '=== T8 receiving an already-complete order -> PS405'
do $$ begin
  perform public.receive_purchase_order((select id from public.purchase_orders where seq=1));
  raise exception 'FAIL re-receive accepted';
exception when sqlstate 'PS405' then raise notice 'PASS re-receive -> PS405'; end $$;

\echo '=== T9 cancelling a partly-received order -> PS405'
do $$ begin
  perform public.cancel_purchase_order((select id from public.purchase_orders where seq=1), 'nope');
  raise exception 'FAIL cancel of received order accepted';
exception when sqlstate 'PS405' then raise notice 'PASS cancel of received -> PS405'; end $$;

\echo '=== T10 cancelling an untouched order works, and is idempotent'
select status from public.cancel_purchase_order((select id from public.purchase_orders where seq=2), 'changed mind');
select status from public.cancel_purchase_order((select id from public.purchase_orders where seq=2));

\echo '=== T11 the ledger links back to the order and the supplier'
select m.delta, m.unit_cost_cents, s.name as supplier, po.reference, m.note
from public.stock_movements m
join public.suppliers s on s.id=m.supplier_id
join public.purchase_orders po on po.id=m.reference_id
order by m.created_at;
reset role;
