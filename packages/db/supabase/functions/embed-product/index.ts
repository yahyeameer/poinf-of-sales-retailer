/**
 * POST /functions/v1/embed-product
 *
 * Owner uploads a product photo; this turns it into a 512-dim CLIP vector the
 * phone can match against offline.
 *
 * Runs at catalog time, not checkout time — the owner is sitting down with a
 * connection when they add stock, and the cashier is not. Nothing in the sale
 * path depends on this function being up.
 *
 * Body: { product_id, image_id?, storage_path }
 */
import { serviceClient, userClient, tenantFromToken } from "../_shared/clients.ts";
import { corsHeaders, json, requireAuthedPost } from "../_shared/http.ts";

const EMBEDDING_DIMS = 512;

/** Cosine similarity assumes unit vectors. Normalising once here means the app
 *  can compare with a plain dot product on every camera frame. */
function l2Normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (magnitude === 0) throw new Error("CLIP returned a zero vector");
  return vector.map((v) => v / magnitude);
}

async function embedImage(imageUrl: string): Promise<number[]> {
  const endpoint = Deno.env.get("CLIP_API_URL");
  const apiKey = Deno.env.get("CLIP_API_KEY");
  if (!endpoint) throw new Error("CLIP_API_URL is not configured");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ image: imageUrl, model: "clip-vit-b-32" }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`CLIP provider returned ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json();
  const embedding: number[] = payload.embedding ?? payload.data?.[0]?.embedding;

  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMS) {
    throw new Error(
      `Expected a ${EMBEDDING_DIMS}-dim embedding, got ${embedding?.length ?? "none"}. ` +
        `Check CLIP_API_URL points at ViT-B/32 — the column type will reject anything else.`,
    );
  }

  return l2Normalize(embedding);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = requireAuthedPost(req);
  if (auth instanceof Response) return auth;

  const tenantId = tenantFromToken(auth.token);
  if (!tenantId) return json({ error: "No shop on this session" }, 401);

  let body: { product_id?: string; image_id?: string; storage_path?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const { product_id, image_id, storage_path } = body;
  if (!product_id || !storage_path) {
    return json({ error: "product_id and storage_path are required" }, 400);
  }

  // Read as the caller so RLS confirms the product is theirs. Writing the
  // embedding needs service-role (there is no client write policy), and this
  // check is what stops that from becoming a way into another shop's catalog.
  const asUser = userClient(auth.token);
  const { data: product, error: lookupError } = await asUser
    .from("products")
    .select("id, tenant_id")
    .eq("id", product_id)
    .single();

  if (lookupError || !product) {
    return json({ error: "Product not found in this shop" }, 404);
  }

  const admin = serviceClient();

  const { data: signed, error: signError } = await admin.storage
    .from("product-images")
    .createSignedUrl(storage_path, 120);

  if (signError || !signed) {
    return json({ error: `Could not read the uploaded image: ${signError?.message}` }, 400);
  }

  let embedding: number[];
  try {
    embedding = await embedImage(signed.signedUrl);
  } catch (err) {
    // A failed embedding is not a failed product. The catalog row is already
    // saved; this can be retried later, and barcode scanning is unaffected.
    console.error("embed-product failed", { product_id, error: String(err) });
    return json({ error: String(err), retryable: true }, 502);
  }

  const { error: writeError } = await admin
    .from("product_embeddings")
    .upsert(
      {
        tenant_id: product.tenant_id,
        product_id,
        image_id: image_id ?? null,
        embedding: JSON.stringify(embedding),
        model: "clip-vit-b-32",
      },
      { onConflict: "product_id,image_id" },
    );

  if (writeError) {
    return json({ error: writeError.message }, 500);
  }

  return json({ product_id, dims: embedding.length, status: "embedded" });
});
