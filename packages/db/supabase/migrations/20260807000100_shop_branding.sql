-- Shop identity and receipt customisation.
--
-- Everything here is meant to end up on a printed receipt or in a customer's
-- hand, so each column has a rendering path. Nothing is stored that the app
-- does not actually use -- a setting that quietly does nothing is worse than
-- an absent one, because the owner believes they have configured something.

alter table public.tenants
  -- Object path inside the shop-logos bucket, not a full URL: the project host
  -- changes between local, staging and production, and a stored URL would rot.
  add column logo_path   text,
  add column phone       text,
  add column address     text,

  -- Printed on the receipt where the law or the customer expects it. Free text
  -- because the format varies by country and validating it wrongly is worse
  -- than not validating it.
  add column tax_number  text,

  add column receipt_header text check (length(receipt_header) <= 200),
  add column receipt_footer text check (length(receipt_footer) <= 300),
  add column receipt_show_logo boolean not null default true,
  add column receipt_show_tax_line boolean not null default true,

  -- Thermal rolls come in two widths and the character count differs enough
  -- that a layout tuned for one wraps badly on the other.
  add column receipt_paper_mm smallint not null default 80
    check (receipt_paper_mm in (58, 80));

comment on column public.tenants.logo_path is
  'Object path in the shop-logos bucket, e.g. <tenant_id>/logo.png. Resolve to a '
  'URL at render time so the project host is never baked into stored data.';

comment on column public.tenants.receipt_footer is
  'Free text under the total: return policy, thanks, opening hours.';

-- ---------------------------------------------------------------------------
-- Storage
--
-- config.toml declares these for a local stack only; a hosted project needs
-- them created explicitly, which is why product-images had policies but no
-- bucket to attach them to.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('shop-logos', 'shop-logos', true, 1048576,
   array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
  ('product-images', 'product-images', true, 2097152,
   array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Logos are public-read: they print on receipts and load on a phone with a bad
-- connection, and a signed URL per render would be pointless overhead for an
-- image the shop puts on its own shopfront anyway.
create policy "shop logos are world readable"
  on storage.objects for select
  to public
  using (bucket_id = 'shop-logos');

-- Path is <tenant_id>/..., so the first folder segment is the tenant and can be
-- compared directly against the caller's.
create policy "owners upload their shop logo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'shop-logos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_shop_role() = 'owner'
  );

create policy "owners replace their shop logo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'shop-logos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_shop_role() = 'owner'
  );

create policy "owners delete their shop logo"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'shop-logos'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_shop_role() = 'owner'
  );
