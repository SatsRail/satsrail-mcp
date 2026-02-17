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

async function api(method, path, body = null) {
  const url = `${BASE_URL}/api/v1${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();

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
  },
  async ({ amount_cents, currency, items, generate_invoice, payment_method, metadata }) => {
    const body = {
      order: { total_amount_cents: amount_cents, currency },
      generate_invoice,
      payment_method,
    };
    if (items) body.order.items = items;
    if (metadata) body.order.metadata = metadata;

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
  "List orders for the merchant. Optionally filter by status.",
  {
    status: z
      .enum(["pending", "invoice_generated", "paid", "cancelled", "refunded"])
      .optional()
      .describe("Filter by status"),
    page: z.number().int().optional().describe("Page number"),
  },
  async ({ status, page }) => {
    const params = new URLSearchParams();
    if (status) params.set("q[status_eq]", status);
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

// --- Payments --------------------------------------------------------------

server.tool(
  "list_payments",
  "List confirmed payments. Optionally filter by date range.",
  {
    confirmed_after: z.string().optional().describe("Filter payments confirmed on or after this date (ISO 8601, e.g. 2026-01-01)"),
    confirmed_before: z.string().optional().describe("Filter payments confirmed on or before this date (ISO 8601)"),
    page: z.number().int().optional().describe("Page number"),
  },
  async ({ confirmed_after, confirmed_before, page }) => {
    const params = new URLSearchParams();
    if (confirmed_after) params.set("q[confirmed_at_gteq]", confirmed_after);
    if (confirmed_before) params.set("q[confirmed_at_lteq]", confirmed_before);
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
  "List the merchant's connected wallets.",
  {},
  async () => {
    const data = await api("GET", "/wallets");
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
