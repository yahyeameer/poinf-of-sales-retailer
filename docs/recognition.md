# Recognition

Barcode first, vision second, search last. In that order, always.

Vision is the interesting part and the least important one. Most products in a
mini-mart have a barcode, and reading it on-device costs nothing and never
misses. Vision exists for loose goods, unlabelled stock, and worn packaging —
and if week 9 slips, v1 ships without it.

## The ladder

```
camera frame
  ├─ 1. MLKit barcode  →  SQLite lookup on (barcode)  →  hit? add to cart. Done.
  │                       No network. ~1ms.
  ├─ 2. on-device CLIP →  cosine vs local embeddings
  │        top-1 ≥ 0.90            → add automatically
  │        ≥ 0.75, ≤ 3 candidates  → show cards, cashier taps
  │        two within 0.05         → optional cloud tie-breaker (prompt 3.3)
  └─ 3. fuzzy name search, cashier picks
```

Thresholds live in one place, `VISION_THRESHOLDS` in
`packages/shared/src/types.ts`. Expect to move them once real shops have
uploaded real photos under real shop lighting.

## Embeddings

CLIP ViT-B/32, 512 dimensions, **L2-normalised at write time**. Normalising once
in `embed-product` means the phone compares with a plain dot product on every
frame instead of renormalising sixty times a second.

Generated when the owner adds a product — they're sitting down with a connection
at that moment, and the cashier is not. Nothing in the sale path depends on the
embedding function being up. A failed embedding is not a failed product: the
catalog row is already saved, barcode scanning is unaffected, and it can be
retried later.

Three or more angles per SKU (front, back, top) is what gets top-1 past the 75%
target. One photo is noticeably worse and worth prompting the owner about.

## Where the vectors live

Both places, for different reasons.

**On device**, in SQLite as raw float32 BLOBs. A 2,000-SKU shop is about 4 MB.
This is the one that matters — it works in aeroplane mode and answers in ~30 ms
on a mid-range Android.

**In Postgres**, `product_embeddings` with an HNSW index, reachable through
`match_products()`. This is the fallback for when the local mirror is stale —
a product added on another device that hasn't synced here yet.

The HNSW index spans all tenants, because pgvector has no partitioned ANN index.
RLS filters afterwards, which means a small shop's top-k can come back short.
`match_products()` sets `hnsw.iterative_scan = 'relaxed_order'` so the index
keeps walking until k rows survive the filter. If p95 recall ever drops, the fix
is partitioning `product_embeddings` on `tenant_id`.

## Cloud tie-breaker

Optional, off the critical path, and only when two candidates are within
`tieMargin` of each other. Sends the frame plus candidate names to prompt 3.3
and takes the answer only above 0.7 confidence.

It costs a network round trip, so it must never block the cart. If it's slow or
unreachable, the cashier is already looking at two tappable cards — that is a
perfectly good outcome and the tie-breaker is a nicety.

## Status

`findByVision()` in `apps/mobile/src/lookup/scan.ts` is a stub returning `[]`.
The signature is fixed now because the sale screen is built against it; with no
model, the UI falls through to search — which is exactly what should happen if
vision gets cut.

To finish it (week 9):

- [ ] Ship a quantised CLIP image encoder (`react-native-fast-tflite` or ExecuTorch)
- [ ] Mirror `product_embeddings` into local SQLite on catalog pull
- [ ] Cosine compare in a worker, not on the JS thread — 60fps camera preview
- [ ] Instrument `MatchSource` on every cart line, so "is vision earning its keep?"
      is a query and not an opinion
