#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_KEY = process.env.SATSRAIL_API_KEY;
const BASE_URL = (process.env.SATSRAIL_BASE_URL || "https://app.satsrail.com").replace(/\/+$/, "");

if (!API_KEY) {
  console.error("SATSRAIL_API_KEY environment variable is required");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function api(method, path, body = null, extraHeaders = {}) {
  const url = `${BASE_URL}/api/v1${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...extraHeaders,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();

  // QR endpoint returns SVG, not JSON
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

  if (!res.ok) {
    const msg = data.error || data.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function formatJSON(data) {
  return JSON.stringify(data, null, 2);
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "satsrail",
  version: "1.0.0",
});

// --- Orders ----------------------------------------------------------------

server.tool(
  "create_order",
  "Create a new payment order. Returns the order with a Lightning invoice if generate_invoice is true.",
  {
    amount_cents: z.number().int().positive().describe("Amount in cents (e.g. 5000 = $50.00)"),
    currency: z.string().default("usd").describe("Currency code (default: usd)"),
    items: z
      .array(
        z.object({
          name: z.string(),
          price_cents: z.number().int(),
          qty: z.number().int().default(1),
          description: z.string().optional(),
          product_id: z.string().optional().describe("Product UUID from catalog"),
        })
      )
      .optional()
      .describe("Line items (optional)"),
    generate_invoice: z.boolean().default(true).describe("Auto-generate a Lightning invoice (default: true)"),
    payment_method: z
      .enum(["lightning", "onchain", "auto"])
      .default("lightning")
      .describe("Payment method (default: lightning)"),
    metadata: z.record(z.string()).optional().describe("Arbitrary key-value metadata"),
    tax_amount_cents: z.number().int().optional().describe("Tax amount in cents"),
    discount_amount_cents: z.number().int().optional().describe("Discount amount in cents"),
    wallet_id: z.string().optional().describe("Wallet UUID to receive payment"),
    discount_id: z.string().optional().describe("Discount UUID to apply"),
    tender_type: z.enum(["cash", "bitcoin"]).optional().describe("Tender type (cash or bitcoin)"),
    mark_as_paid: z.boolean().optional().describe("Mark order as paid immediately (for cash orders)"),
  },
  async ({ amount_cents, currency, items, generate_invoice, payment_method, metadata, tax_amount_cents, discount_amount_cents, wallet_id, discount_id, tender_type, mark_as_paid }) => {
    const body = {
      order: { total_amount_cents: amount_cents, currency },
      generate_invoice,
      payment_method,
    };
    if (items) body.order.items = items;
    if (metadata) body.order.metadata = metadata;
    if (tax_amount_cents != null) body.order.tax_amount_cents = tax_amount_cents;
    if (discount_amount_cents != null) body.order.discount_amount_cents = discount_amount_cents;
    if (wallet_id) body.order.wallet_id = wallet_id;
    if (discount_id) body.order.discount_id = discount_id;
    if (tender_type) body.order.tender_type = tender_type;
    if (mark_as_paid != null) body.mark_as_paid = mark_as_paid;

    const data = await api("POST", "/orders", body);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "get_order",
  "Get details of an existing order by ID.",
  {
    order_id: z.string().describe("Order UUID"),
    expand: z
      .array(z.enum(["invoice", "payment", "merchant"]))
      .optional()
      .describe("Relations to expand"),
  },
  async ({ order_id, expand }) => {
    const query = expand?.length ? `?expand=${expand.join(",")}` : "";
    const data = await api("GET", `/orders/${order_id}${query}`);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "list_orders",
  "List orders for the merchant with optional filters.",
  {
    status: z
      .enum(["pending", "invoice_generated", "paid", "cancelled", "refunded"])
      .optional()
      .describe("Filter by status"),
    currency: z.string().optional().describe("Filter by currency code (e.g. usd)"),
    order_number: z.string().optional().describe("Filter by exact order number"),
    amount_min: z.number().int().optional().describe("Minimum total_amount_cents"),
    amount_max: z.number().int().optional().describe("Maximum total_amount_cents"),
    created_after: z.string().optional().describe("Orders created on or after this date (ISO 8601)"),
    created_before: z.string().optional().describe("Orders created on or before this date (ISO 8601)"),
    expand: z
      .array(z.enum(["invoice", "payment", "merchant"]))
      .optional()
      .describe("Relations to expand"),
    page: z.number().int().optional().describe("Page number"),
  },
  async ({ status, currency, order_number, amount_min, amount_max, created_after, created_before, expand, page }) => {
    const params = new URLSearchParams();
    if (status) params.set("q[status_eq]", status);
    if (currency) params.set("q[currency_eq]", currency);
    if (order_number) params.set("q[order_number_eq]", order_number);
    if (amount_min != null) params.set("q[total_amount_cents_gteq]", String(amount_min));
    if (amount_max != null) params.set("q[total_amount_cents_lteq]", String(amount_max));
    if (created_after) params.set("q[created_at_gteq]", created_after);
    if (created_before) params.set("q[created_at_lteq]", created_before);
    if (expand?.length) params.set("expand", expand.join(","));
    if (page) params.set("page", String(page));
    const query = params.toString() ? `?${params}` : "";
    const data = await api("GET", `/orders${query}`);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "cancel_order",
  "Cancel a pending order.",
  {
    order_id: z.string().describe("Order UUID to cancel"),
  },
  async ({ order_id }) => {
    await api("DELETE", `/orders/${order_id}`);
    return { content: [{ type: "text", text: `Order ${order_id} cancelled.` }] };
  }
);

server.tool(
  "update_order",
  "Update an existing order. Pending orders can update all fields. Paid orders can be marked as shipped. Cash orders can be marked as paid.",
  {
    order_id: z.string().describe("Order UUID"),
    total_amount_cents: z.number().int().positive().optional().describe("New total amount in cents"),
    currency: z.string().optional().describe("New currency code"),
    tax_amount_cents: z.number().int().optional().describe("Tax amount in cents"),
    discount_amount_cents: z.number().int().optional().describe("Discount amount in cents"),
    wallet_id: z.string().optional().describe("Wallet UUID"),
    discount_id: z.string().optional().describe("Discount UUID"),
    tender_type: z.enum(["cash", "bitcoin"]).optional().describe("Tender type"),
    items: z
      .array(
        z.object({
          name: z.string(),
          price_cents: z.number().int(),
          qty: z.number().int().default(1),
          description: z.string().optional(),
          product_id: z.string().optional(),
        })
      )
      .optional()
      .describe("Replace line items"),
    metadata: z.record(z.string()).optional().describe("Key-value metadata"),
    status: z
      .enum(["paid", "shipped"])
      .optional()
      .describe("Transition status: 'paid' (cash orders) or 'shipped' (paid orders)"),
    mark_as_paid: z.boolean().optional().describe("Mark as paid (for cash orders)"),
  },
  async ({ order_id, total_amount_cents, currency, tax_amount_cents, discount_amount_cents, wallet_id, discount_id, tender_type, items, metadata, status, mark_as_paid }) => {
    const body = { order: {} };
    if (total_amount_cents != null) body.order.total_amount_cents = total_amount_cents;
    if (currency) body.order.currency = currency;
    if (tax_amount_cents != null) body.order.tax_amount_cents = tax_amount_cents;
    if (discount_amount_cents != null) body.order.discount_amount_cents = discount_amount_cents;
    if (wallet_id) body.order.wallet_id = wallet_id;
    if (discount_id) body.order.discount_id = discount_id;
    if (tender_type) body.order.tender_type = tender_type;
    if (items) body.order.items = items;
    if (metadata) body.order.metadata = metadata;
    if (status) body.order.status = status;
    if (mark_as_paid != null) body.mark_as_paid = mark_as_paid;

    const data = await api("PATCH", `/orders/${order_id}`, body);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// --- Invoices --------------------------------------------------------------

server.tool(
  "get_invoice",
  "Get invoice details including the Lightning bolt11 string and payment address.",
  {
    invoice_id: z.string().describe("Invoice UUID"),
  },
  async ({ invoice_id }) => {
    const data = await api("GET", `/invoices/${invoice_id}`);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "check_invoice_status",
  "Check the real-time payment status of an invoice. Triggers a fresh check against the Lightning node.",
  {
    invoice_id: z.string().describe("Invoice UUID"),
  },
  async ({ invoice_id }) => {
    const data = await api("GET", `/invoices/${invoice_id}/status`);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "generate_invoice",
  "Generate a new invoice for an existing order.",
  {
    order_id: z.string().describe("Order UUID"),
    payment_method: z
      .enum(["lightning", "onchain", "auto"])
      .default("lightning")
      .describe("Payment method"),
    required_confirmations: z
      .number()
      .int()
      .min(1)
      .max(6)
      .optional()
      .describe("Required confirmations for on-chain (1-6)"),
  },
  async ({ order_id, payment_method, required_confirmations }) => {
    const body = { order_id, payment_method };
    if (required_confirmations) body.required_confirmations = required_confirmations;
    const data = await api("POST", "/invoices/generate", body);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "get_invoice_qr",
  "Get a QR code for an invoice as an SVG image string.",
  {
    invoice_id: z.string().describe("Invoice UUID"),
  },
  async ({ invoice_id }) => {
    const data = await api("GET", `/invoices/${invoice_id}/qr`);
    return { content: [{ type: "text", text: data.svg }] };
  }
);

// --- Payments --------------------------------------------------------------

server.tool(
  "list_payments",
  "List confirmed payments with optional filters.",
  {
    confirmed_after: z.string().optional().describe("Filter payments confirmed on or after this date (ISO 8601, e.g. 2026-01-01)"),
    confirmed_before: z.string().optional().describe("Filter payments confirmed on or before this date (ISO 8601)"),
    amount_sats: z.number().int().optional().describe("Filter by exact amount in satoshis"),
    amount_sats_min: z.number().int().optional().describe("Minimum amount in satoshis"),
    amount_sats_max: z.number().int().optional().describe("Maximum amount in satoshis"),
    currency: z.string().optional().describe("Filter by currency code (e.g. usd)"),
    page: z.number().int().optional().describe("Page number"),
  },
  async ({ confirmed_after, confirmed_before, amount_sats, amount_sats_min, amount_sats_max, currency, page }) => {
    const params = new URLSearchParams();
    if (confirmed_after) params.set("q[confirmed_at_gteq]", confirmed_after);
    if (confirmed_before) params.set("q[confirmed_at_lteq]", confirmed_before);
    if (amount_sats != null) params.set("q[amount_sats_eq]", String(amount_sats));
    if (amount_sats_min != null) params.set("q[amount_sats_gteq]", String(amount_sats_min));
    if (amount_sats_max != null) params.set("q[amount_sats_lteq]", String(amount_sats_max));
    if (currency) params.set("q[currency_eq]", currency);
    if (page) params.set("page", String(page));
    const query = params.toString() ? `?${params}` : "";
    const data = await api("GET", `/payments${query}`);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "get_payment",
  "Get details of a specific payment.",
  {
    payment_id: z.string().describe("Payment UUID"),
  },
  async ({ payment_id }) => {
    const data = await api("GET", `/payments/${payment_id}`);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// --- Checkout Sessions -----------------------------------------------------

server.tool(
  "create_checkout_session",
  "Create a hosted checkout session. Returns a checkout URL the customer can visit to pay.",
  {
    amount_cents: z.number().int().positive().describe("Amount in cents"),
    currency: z.string().default("usd").describe("Currency code"),
    success_url: z.string().url().optional().describe("Redirect URL after successful payment"),
    cancel_url: z.string().url().optional().describe("Redirect URL if customer cancels"),
  },
  async ({ amount_cents, currency, success_url, cancel_url }) => {
    const body = { checkout_session: { amount_cents, currency } };
    if (success_url) body.checkout_session.success_url = success_url;
    if (cancel_url) body.checkout_session.cancel_url = cancel_url;
    const data = await api("POST", "/checkout_sessions", body);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// --- Merchant Info ---------------------------------------------------------

server.tool(
  "get_merchant",
  "Get the current merchant's profile and settings.",
  {},
  async () => {
    const data = await api("GET", "/merchant");
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// --- Wallets ---------------------------------------------------------------

server.tool(
  "list_wallets",
  "List the merchant's connected wallets with optional filters.",
  {
    wallet_type: z.enum(["lightning", "bitcoin"]).optional().describe("Filter by wallet type"),
    status: z.enum(["active", "inactive", "error", "syncing", "pending"]).optional().describe("Filter by status"),
    enabled: z.boolean().optional().describe("Filter by enabled state"),
    is_default: z.boolean().optional().describe("Filter for default wallet only"),
    name: z.string().optional().describe("Filter by name (partial match)"),
  },
  async ({ wallet_type, status, enabled, is_default, name }) => {
    const params = new URLSearchParams();
    if (wallet_type) params.set("q[wallet_type_eq]", wallet_type);
    if (status) params.set("q[status_eq]", status);
    if (enabled != null) params.set("q[enabled_eq]", String(enabled));
    if (is_default != null) params.set("q[is_default_eq]", String(is_default));
    if (name) params.set("q[name_cont]", name);
    const query = params.toString() ? `?${params}` : "";
    const data = await api("GET", `/wallets${query}`);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "get_wallet",
  "Get details of a specific wallet by ID.",
  {
    wallet_id: z.string().describe("Wallet UUID"),
  },
  async ({ wallet_id }) => {
    const data = await api("GET", `/wallets/${wallet_id}`);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// --- Payment Requests ------------------------------------------------------

server.tool(
  "create_payment_request",
  "Create a payment request — a simplified flow that creates an Order and Invoice in a single call. Returns a Lightning invoice or Bitcoin address for immediate payment.",
  {
    amount_cents: z.number().int().positive().describe("Amount in cents (e.g. 5000 = $50.00)"),
    payment_method: z.enum(["lightning", "onchain", "auto"]).describe("Payment method"),
    description: z.string().optional().describe("Description for the payment request"),
    confirmations: z.number().int().min(1).max(6).optional().describe("Required confirmations for on-chain (1-6)"),
    metadata: z.record(z.string()).optional().describe("Arbitrary key-value metadata"),
    idempotency_key: z.string().optional().describe("Idempotency key for safe retries"),
  },
  async ({ amount_cents, payment_method, description, confirmations, metadata, idempotency_key }) => {
    const body = { payment_request: { amount_cents, payment_method } };
    if (description) body.payment_request.description = description;
    if (confirmations != null) body.payment_request.confirmations = confirmations;
    if (metadata) body.payment_request.metadata = metadata;

    const headers = {};
    if (idempotency_key) headers["Idempotency-Key"] = idempotency_key;

    const data = await api("POST", "/payment_requests", body, headers);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "get_payment_request",
  "Get details of a payment request by ID.",
  {
    payment_request_id: z.string().describe("Payment request UUID"),
  },
  async ({ payment_request_id }) => {
    const data = await api("GET", `/payment_requests/${payment_request_id}`);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "get_payment_request_status",
  "Check the real-time payment status of a payment request.",
  {
    payment_request_id: z.string().describe("Payment request UUID"),
  },
  async ({ payment_request_id }) => {
    const data = await api("GET", `/payment_requests/${payment_request_id}/status`);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// --- Webhooks --------------------------------------------------------------

server.tool(
  "list_webhooks",
  "List webhook endpoints with optional filters.",
  {
    active: z.boolean().optional().describe("Filter by active state"),
    url: z.string().optional().describe("Filter by URL (partial match)"),
    created_after: z.string().optional().describe("Created on or after this date (ISO 8601)"),
    created_before: z.string().optional().describe("Created on or before this date (ISO 8601)"),
    page: z.number().int().optional().describe("Page number"),
  },
  async ({ active, url, created_after, created_before, page }) => {
    const params = new URLSearchParams();
    if (active != null) params.set("q[active_eq]", String(active));
    if (url) params.set("q[url_cont]", url);
    if (created_after) params.set("q[created_at_gteq]", created_after);
    if (created_before) params.set("q[created_at_lteq]", created_before);
    if (page) params.set("page", String(page));
    const query = params.toString() ? `?${params}` : "";
    const data = await api("GET", `/webhooks${query}`);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "get_webhook",
  "Get details of a specific webhook endpoint.",
  {
    webhook_id: z.string().describe("Webhook UUID"),
  },
  async ({ webhook_id }) => {
    const data = await api("GET", `/webhooks/${webhook_id}`);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "create_webhook",
  "Create a new webhook endpoint. Returns the webhook with its signing secret (shown only once).",
  {
    url: z.string().url().describe("The URL to receive webhook events"),
    description: z.string().optional().describe("Description of this webhook"),
    active: z.boolean().default(true).describe("Whether the webhook is active (default: true)"),
    events: z
      .array(z.string())
      .optional()
      .describe("Events to subscribe to (e.g. order.created, invoice.paid, payment.confirmed). Omit for all events."),
    metadata: z.record(z.string()).optional().describe("Arbitrary key-value metadata"),
  },
  async ({ url, description, active, events, metadata }) => {
    const body = { webhook: { url, active } };
    if (description) body.webhook.description = description;
    if (events) body.webhook.events = events;
    if (metadata) body.webhook.metadata = metadata;

    const data = await api("POST", "/webhooks", body);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "update_webhook",
  "Update an existing webhook endpoint.",
  {
    webhook_id: z.string().describe("Webhook UUID"),
    url: z.string().url().optional().describe("New URL"),
    description: z.string().optional().describe("New description"),
    active: z.boolean().optional().describe("Enable or disable the webhook"),
    events: z
      .array(z.string())
      .optional()
      .describe("Replace the subscribed events list"),
    metadata: z.record(z.string()).optional().describe("Replace metadata"),
  },
  async ({ webhook_id, url, description, active, events, metadata }) => {
    const body = { webhook: {} };
    if (url) body.webhook.url = url;
    if (description != null) body.webhook.description = description;
    if (active != null) body.webhook.active = active;
    if (events) body.webhook.events = events;
    if (metadata) body.webhook.metadata = metadata;

    const data = await api("PATCH", `/webhooks/${webhook_id}`, body);
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "delete_webhook",
  "Delete a webhook endpoint.",
  {
    webhook_id: z.string().describe("Webhook UUID to delete"),
  },
  async ({ webhook_id }) => {
    await api("DELETE", `/webhooks/${webhook_id}`);
    return { content: [{ type: "text", text: `Webhook ${webhook_id} deleted.` }] };
  }
);

// --- Catalog ---------------------------------------------------------------

server.tool(
  "get_catalog",
  "Get the merchant's full product catalog including product types, products, taxes, and discounts.",
  {},
  async () => {
    const data = await api("GET", "/catalog");
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "get_catalog_version",
  "Get the catalog version timestamp. Use this for lightweight cache invalidation checks without loading the full catalog.",
  {},
  async () => {
    const data = await api("GET", "/catalog/version");
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// --- Subscription Plans ----------------------------------------------------

server.tool(
  "list_subscription_plans",
  "List available subscription plans. This is a public endpoint that does not require authentication.",
  {},
  async () => {
    const data = await api("GET", "/subscription_plans");
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
