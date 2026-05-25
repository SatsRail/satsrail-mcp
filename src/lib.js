// Pure helpers and schemas. No side effects, no transport — safe to import
// from tests and tools.
//
// The SatsRail API namespaces resources under /api/v1/m/* (merchant API,
// authenticated with sk_* / pk_* tokens) and /api/v1/pub/* (public/embed).
// Use mpath() and pubpath() to keep that distinction visible at every call
// site — silently hitting the wrong namespace is the failure mode this
// server already shipped with once.

import { z } from "zod";

export const API_PREFIX = "/api/v1";
export const mpath = (suffix) => `${API_PREFIX}/m${suffix}`;
export const pubpath = (suffix) => `${API_PREFIX}/pub${suffix}`;

export const DEFAULT_BASE_URL = "https://app.satsrail.com";

export function normalizeBaseUrl(url) {
  return (url || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

// Build a SatsRail HTTP client bound to a base URL and API key. Returns an
// `api(method, path, body?, extraHeaders?)` callable. Inject `fetchImpl` from
// tests; defaults to the global fetch.
export function createApi({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl } = {}) {
  if (!apiKey) throw new Error("apiKey is required");
  const base = normalizeBaseUrl(baseUrl);
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new Error("global fetch is not available; pass fetchImpl explicitly");
  }

  return async function api(method, path, body = null, extraHeaders = {}) {
    const opts = {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...extraHeaders,
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await doFetch(`${base}${path}`, opts);

    // 204 No Content — DELETE endpoints return this on success.
    if (res.status === 204) return { ok: true, status: 204 };

    const text = await res.text();
    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("image/svg+xml")) {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { svg: text };
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) throw new Error(extractError(data, res.status));
    return data;
  };
}

// Portal errors come in a few shapes:
//   { error: "string" }
//   { error: { code, message, details, request_id } }
//   { message: "string" }
// Surface code + message together so the agent sees actionable detail.
export function extractError(data, status) {
  const err = data?.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    if (err.code && err.message) return `${err.code}: ${err.message}`;
    if (err.message) return err.message;
    if (err.code) return err.code;
    return JSON.stringify(err);
  }
  if (typeof data?.message === "string") return data.message;
  return `HTTP ${status}`;
}

export function formatJSON(data) {
  return JSON.stringify(data, null, 2);
}

// Convert an object of {param: value} pairs into a "?a=1&b=2" string,
// skipping undefined/null values. Used by every list_* tool.
export function buildQuery(filters) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function idempotencyHeaders(key) {
  return key ? { "Idempotency-Key": key } : {};
}

// HasMetadata concern (portal/app/models/concerns/has_metadata.rb):
//   - max 50 keys
//   - max 40 char key
//   - max 500 char value
//   - all values stored as strings
// Catching violations client-side gives the agent a clean error instead of a
// 422 round-trip.
export const MetadataSchema = z
  .record(z.string().max(40), z.string().max(500))
  .refine((m) => Object.keys(m).length <= 50, {
    message: "metadata supports at most 50 key-value pairs",
  });

export const LineItemSchema = z.object({
  name: z.string(),
  price_cents: z.number().int(),
  qty: z.number().int().default(1),
  description: z.string().optional(),
  sku: z.string().optional(),
  product_id: z.string().optional().describe("Product UUID or slug from catalog"),
});

export const PaymentMethodEnum = z.enum(["lightning", "onchain", "auto"]);

// Pagination is shared by every list_* tool — portal supports ?page and
// ?per_page (default 25, max 100). See portal/app/controllers/concerns/paginatable.rb.
export const PageParam = z.number().int().min(1).optional().describe("Page number (default 1)");
export const PerPageParam = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Items per page (1-100, default 25)");
export const IdempotencyKeyParam = z
  .string()
  .max(255)
  .optional()
  .describe("Idempotency-Key for safe retries (≤255 chars, dedupes within 24h)");
