// Unit tests for the pure helpers and schemas in src/lib.js.
//
// These are the things a future agent will need to change first when the
// API surface or error shape evolves — keep them well-tested.

import { describe, it, expect, vi } from "vitest";

import {
  mpath,
  pubpath,
  normalizeBaseUrl,
  extractError,
  buildQuery,
  idempotencyHeaders,
  createApi,
  MetadataSchema,
  LineItemSchema,
  PaymentMethodEnum,
  PageParam,
  PerPageParam,
  IdempotencyKeyParam,
} from "../src/lib.js";

describe("path helpers", () => {
  it("mpath prefixes /api/v1/m", () => {
    expect(mpath("/orders")).toBe("/api/v1/m/orders");
    expect(mpath("/orders/123")).toBe("/api/v1/m/orders/123");
  });

  it("pubpath prefixes /api/v1/pub", () => {
    expect(pubpath("/subscription_plans")).toBe("/api/v1/pub/subscription_plans");
  });

  it("normalizeBaseUrl strips trailing slashes", () => {
    expect(normalizeBaseUrl("https://app.satsrail.com")).toBe("https://app.satsrail.com");
    expect(normalizeBaseUrl("https://app.satsrail.com/")).toBe("https://app.satsrail.com");
    expect(normalizeBaseUrl("https://app.satsrail.com///")).toBe("https://app.satsrail.com");
  });

  it("normalizeBaseUrl defaults to production", () => {
    expect(normalizeBaseUrl()).toBe("https://app.satsrail.com");
    expect(normalizeBaseUrl(undefined)).toBe("https://app.satsrail.com");
  });
});

describe("extractError", () => {
  it("returns string error directly", () => {
    expect(extractError({ error: "something broke" }, 500)).toBe("something broke");
  });

  it("formats {code, message} together", () => {
    expect(
      extractError(
        { error: { code: "validation_failed", message: "name can't be blank" } },
        422
      )
    ).toBe("validation_failed: name can't be blank");
  });

  it("falls back to message-only when no code", () => {
    expect(extractError({ error: { message: "boom" } }, 500)).toBe("boom");
  });

  it("falls back to code-only when no message", () => {
    expect(extractError({ error: { code: "unknown" } }, 500)).toBe("unknown");
  });

  it("stringifies opaque error objects", () => {
    expect(extractError({ error: { foo: "bar" } }, 500)).toBe('{"foo":"bar"}');
  });

  it("uses top-level message when no error key", () => {
    expect(extractError({ message: "oops" }, 500)).toBe("oops");
  });

  it("falls back to HTTP status when nothing is present", () => {
    expect(extractError({}, 503)).toBe("HTTP 503");
    expect(extractError(null, 502)).toBe("HTTP 502");
  });
});

describe("buildQuery", () => {
  it("skips undefined and null values", () => {
    expect(buildQuery({ a: 1, b: undefined, c: null, d: "x" })).toBe("?a=1&d=x");
  });

  it("returns empty string when all values are skipped", () => {
    expect(buildQuery({ a: undefined, b: null })).toBe("");
  });

  it("stringifies all values", () => {
    expect(buildQuery({ active: true, count: 0 })).toBe("?active=true&count=0");
  });

  it("preserves complex keys (ransack q[])", () => {
    expect(buildQuery({ "q[status_eq]": "paid", page: 2 })).toBe(
      "?q%5Bstatus_eq%5D=paid&page=2"
    );
  });
});

describe("idempotencyHeaders", () => {
  it("returns header when key provided", () => {
    expect(idempotencyHeaders("abc-123")).toEqual({ "Idempotency-Key": "abc-123" });
  });

  it("returns empty when key absent", () => {
    expect(idempotencyHeaders(undefined)).toEqual({});
    expect(idempotencyHeaders(null)).toEqual({});
    expect(idempotencyHeaders("")).toEqual({});
  });
});

describe("createApi", () => {
  function mockFetch(response) {
    return vi.fn(async () => response);
  }

  function jsonResponse(body, { status = 200, contentType = "application/json" } = {}) {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k) => (k.toLowerCase() === "content-type" ? contentType : null) },
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    };
  }

  it("throws when apiKey is missing", () => {
    expect(() => createApi({})).toThrow(/apiKey is required/);
  });

  it("sends Authorization, Content-Type, and Accept headers", async () => {
    const fetchImpl = mockFetch(jsonResponse({ ok: true }));
    const api = createApi({ apiKey: "sk_test_x", baseUrl: "https://example.com", fetchImpl });
    await api("GET", "/api/v1/m/merchant");

    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://example.com/api/v1/m/merchant");
    expect(opts.method).toBe("GET");
    expect(opts.headers.Authorization).toBe("Bearer sk_test_x");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(opts.headers.Accept).toBe("application/json");
  });

  it("serializes JSON body on POST", async () => {
    const fetchImpl = mockFetch(jsonResponse({ ok: true }, { status: 201 }));
    const api = createApi({ apiKey: "sk_test_x", baseUrl: "https://example.com", fetchImpl });
    await api("POST", "/api/v1/m/orders", { order: { total_amount_cents: 5000 } });

    const opts = fetchImpl.mock.calls[0][1];
    expect(opts.body).toBe('{"order":{"total_amount_cents":5000}}');
  });

  it("merges extra headers (e.g. Idempotency-Key)", async () => {
    const fetchImpl = mockFetch(jsonResponse({ ok: true }, { status: 201 }));
    const api = createApi({ apiKey: "sk_test_x", baseUrl: "https://example.com", fetchImpl });
    await api("POST", "/api/v1/m/orders", { order: {} }, { "Idempotency-Key": "abc-123" });

    expect(fetchImpl.mock.calls[0][1].headers["Idempotency-Key"]).toBe("abc-123");
  });

  it("returns { ok, status: 204 } for empty 204 responses without parsing body", async () => {
    // No text() call should be needed — 204 short-circuits.
    const fetchImpl = vi.fn(async () => ({
      status: 204,
      ok: true,
      headers: { get: () => null },
      text: async () => {
        throw new Error("should not be called");
      },
    }));
    const api = createApi({ apiKey: "sk_test_x", baseUrl: "https://example.com", fetchImpl });
    const result = await api("DELETE", "/api/v1/m/products/foo");
    expect(result).toEqual({ ok: true, status: 204 });
  });

  it("returns { svg } for image/svg+xml", async () => {
    const svg = "<svg>...</svg>";
    const fetchImpl = mockFetch(jsonResponse(svg, { contentType: "image/svg+xml" }));
    const api = createApi({ apiKey: "sk_test_x", baseUrl: "https://example.com", fetchImpl });
    const result = await api("GET", "/api/v1/m/invoices/inv_x/qr");
    expect(result).toEqual({ svg });
  });

  it("throws with formatted error on non-2xx JSON", async () => {
    const fetchImpl = mockFetch(
      jsonResponse({ error: { code: "validation_failed", message: "name can't be blank" } }, { status: 422 })
    );
    const api = createApi({ apiKey: "sk_test_x", baseUrl: "https://example.com", fetchImpl });

    await expect(api("POST", "/api/v1/m/products", { product: {} })).rejects.toThrow(
      "validation_failed: name can't be blank"
    );
  });

  it("normalizes trailing slashes on baseUrl", async () => {
    const fetchImpl = mockFetch(jsonResponse({ ok: true }));
    const api = createApi({ apiKey: "sk_test_x", baseUrl: "https://example.com///", fetchImpl });
    await api("GET", "/api/v1/m/merchant");
    expect(fetchImpl.mock.calls[0][0]).toBe("https://example.com/api/v1/m/merchant");
  });
});

describe("MetadataSchema", () => {
  it("accepts an empty object", () => {
    expect(MetadataSchema.safeParse({}).success).toBe(true);
  });

  it("accepts up to 50 keys", () => {
    const m = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, "v"]));
    expect(MetadataSchema.safeParse(m).success).toBe(true);
  });

  it("rejects 51 keys", () => {
    const m = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, "v"]));
    const result = MetadataSchema.safeParse(m);
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toMatch(/50/);
  });

  it("rejects keys longer than 40 chars", () => {
    const m = { ["x".repeat(41)]: "v" };
    expect(MetadataSchema.safeParse(m).success).toBe(false);
  });

  it("rejects values longer than 500 chars", () => {
    const m = { k: "v".repeat(501) };
    expect(MetadataSchema.safeParse(m).success).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(MetadataSchema.safeParse({ k: 42 }).success).toBe(false);
    expect(MetadataSchema.safeParse({ k: true }).success).toBe(false);
  });
});

describe("LineItemSchema", () => {
  it("requires name and price_cents", () => {
    expect(LineItemSchema.safeParse({ name: "Pro Plan", price_cents: 5000 }).success).toBe(true);
    expect(LineItemSchema.safeParse({ name: "x" }).success).toBe(false);
    expect(LineItemSchema.safeParse({ price_cents: 1 }).success).toBe(false);
  });

  it("defaults qty to 1", () => {
    const parsed = LineItemSchema.parse({ name: "x", price_cents: 1 });
    expect(parsed.qty).toBe(1);
  });
});

describe("PaymentMethodEnum", () => {
  it("accepts lightning, onchain, auto", () => {
    expect(PaymentMethodEnum.safeParse("lightning").success).toBe(true);
    expect(PaymentMethodEnum.safeParse("onchain").success).toBe(true);
    expect(PaymentMethodEnum.safeParse("auto").success).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(PaymentMethodEnum.safeParse("paypal").success).toBe(false);
  });
});

describe("pagination params", () => {
  it("PageParam accepts positive ints, rejects 0 and negatives", () => {
    expect(PageParam.safeParse(1).success).toBe(true);
    expect(PageParam.safeParse(undefined).success).toBe(true);
    expect(PageParam.safeParse(0).success).toBe(false);
    expect(PageParam.safeParse(-1).success).toBe(false);
  });

  it("PerPageParam enforces 1-100", () => {
    expect(PerPageParam.safeParse(1).success).toBe(true);
    expect(PerPageParam.safeParse(100).success).toBe(true);
    expect(PerPageParam.safeParse(101).success).toBe(false);
    expect(PerPageParam.safeParse(0).success).toBe(false);
  });
});

describe("IdempotencyKeyParam", () => {
  it("accepts up to 255 chars", () => {
    expect(IdempotencyKeyParam.safeParse("k".repeat(255)).success).toBe(true);
  });

  it("rejects > 255 chars", () => {
    expect(IdempotencyKeyParam.safeParse("k".repeat(256)).success).toBe(false);
  });

  it("is optional", () => {
    expect(IdempotencyKeyParam.safeParse(undefined).success).toBe(true);
  });
});
