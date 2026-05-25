#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  createApi,
  mpath,
  pubpath,
  formatJSON,
  buildQuery,
  idempotencyHeaders,
  MetadataSchema,
  LineItemSchema,
  PaymentMethodEnum,
  PageParam,
  PerPageParam,
  IdempotencyKeyParam,
} from "./lib.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_KEY = process.env.SATSRAIL_API_KEY;
const BASE_URL = process.env.SATSRAIL_BASE_URL;

if (!API_KEY) {
  console.error("SATSRAIL_API_KEY environment variable is required");
  process.exit(1);
}

const api = createApi({ apiKey: API_KEY, baseUrl: BASE_URL });

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "satsrail",
  version: "1.2.0",
});

// --- Orders ----------------------------------------------------------------

server.tool(
  "create_order",
  "Create a new payment order. Returns the order with a Lightning invoice if generate_invoice is true.",
  {
    amount_cents: z.number().int().positive().describe("Amount in cents (e.g. 5000 = $50.00)"),
    currency: z.string().default("usd").describe("Currency code (default: usd)"),
    items: z.array(LineItemSchema).optional().describe("Line items (optional)"),
    generate_invoice: z.boolean().default(true).describe("Auto-generate a Lightning invoice (default: true)"),
    payment_method: PaymentMethodEnum.default("lightning").describe("Payment method (default: lightning)"),
    metadata: MetadataSchema.optional().describe("Arbitrary key-value metadata"),
    tax_amount_cents: z.number().int().optional().describe("Tax amount in cents"),
    discount_amount_cents: z.number().int().optional().describe("Discount amount in cents"),
    wallet_id: z.string().optional().describe("Wallet UUID to receive payment"),
    discount_id: z.string().optional().describe("Discount UUID to apply"),
    tender_type: z.enum(["cash", "bitcoin"]).optional().describe("Tender type (cash or bitcoin)"),
    mark_as_paid: z.boolean().optional().describe("Mark order as paid immediately (for cash orders)"),
    idempotency_key: IdempotencyKeyParam,
  },
  async ({ amount_cents, currency, items, generate_invoice, payment_method, metadata, tax_amount_cents, discount_amount_cents, wallet_id, discount_id, tender_type, mark_as_paid, idempotency_key }) => {
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

    const data = await api("POST", mpath("/orders"), body, idempotencyHeaders(idempotency_key));
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
    const data = await api("GET", mpath(`/orders/${order_id}${query}`));
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
    page: PageParam,
    per_page: PerPageParam,
  },
  async ({ status, currency, order_number, amount_min, amount_max, created_after, created_before, expand, page, per_page }) => {
    const query = buildQuery({
      "q[status_eq]": status,
      "q[currency_eq]": currency,
      "q[order_number_eq]": order_number,
      "q[total_amount_cents_gteq]": amount_min,
      "q[total_amount_cents_lteq]": amount_max,
      "q[created_at_gteq]": created_after,
      "q[created_at_lteq]": created_before,
      expand: expand?.length ? expand.join(",") : undefined,
      page,
      per_page,
    });
    const data = await api("GET", mpath(`/orders${query}`));
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
    await api("DELETE", mpath(`/orders/${order_id}`));
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
    items: z.array(LineItemSchema).optional().describe("Replace line items"),
    metadata: MetadataSchema.optional().describe("Key-value metadata"),
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

    const data = await api("PATCH", mpath(`/orders/${order_id}`), body);
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
    const data = await api("GET", mpath(`/invoices/${invoice_id}`));
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
    const data = await api("GET", mpath(`/invoices/${invoice_id}/status`));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "generate_invoice",
  "Generate a new invoice for an existing order.",
  {
    order_id: z.string().describe("Order UUID"),
    payment_method: PaymentMethodEnum.default("lightning").describe("Payment method"),
    required_confirmations: z
      .number()
      .int()
      .min(1)
      .max(6)
      .optional()
      .describe("Required confirmations for on-chain (1-6)"),
    idempotency_key: IdempotencyKeyParam,
  },
  async ({ order_id, payment_method, required_confirmations, idempotency_key }) => {
    const body = { order_id, payment_method };
    if (required_confirmations) body.required_confirmations = required_confirmations;
    const data = await api("POST", mpath("/invoices/generate"), body, idempotencyHeaders(idempotency_key));
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
    const data = await api("GET", mpath(`/invoices/${invoice_id}/qr`));
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
    page: PageParam,
    per_page: PerPageParam,
  },
  async ({ confirmed_after, confirmed_before, amount_sats, amount_sats_min, amount_sats_max, currency, page, per_page }) => {
    const query = buildQuery({
      "q[confirmed_at_gteq]": confirmed_after,
      "q[confirmed_at_lteq]": confirmed_before,
      "q[amount_sats_eq]": amount_sats,
      "q[amount_sats_gteq]": amount_sats_min,
      "q[amount_sats_lteq]": amount_sats_max,
      "q[currency_eq]": currency,
      page,
      per_page,
    });
    const data = await api("GET", mpath(`/payments${query}`));
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
    const data = await api("GET", mpath(`/payments/${payment_id}`));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// --- Checkout Sessions -----------------------------------------------------

server.tool(
  "list_checkout_sessions",
  "List hosted checkout sessions with optional filters.",
  {
    status: z.string().optional().describe("Filter by status"),
    created_after: z.string().optional().describe("Created on or after this date (ISO 8601)"),
    created_before: z.string().optional().describe("Created on or before this date (ISO 8601)"),
    page: PageParam,
    per_page: PerPageParam,
  },
  async ({ status, created_after, created_before, page, per_page }) => {
    const query = buildQuery({
      "q[status_eq]": status,
      "q[created_at_gteq]": created_after,
      "q[created_at_lteq]": created_before,
      page,
      per_page,
    });
    const data = await api("GET", mpath(`/checkout_sessions${query}`));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "get_checkout_session",
  "Get a checkout session by ID.",
  {
    checkout_session_id: z.string().describe("Checkout session UUID"),
  },
  async ({ checkout_session_id }) => {
    const data = await api("GET", mpath(`/checkout_sessions/${checkout_session_id}`));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "create_checkout_session",
  "Create a hosted checkout session. Returns a checkout URL the customer can visit to pay. Pass product_id to anchor the session to a catalog product (price + tax are derived automatically).",
  {
    amount_cents: z.number().int().positive().optional().describe("Amount in cents (omit when product_id is set)"),
    currency: z.string().optional().describe("Currency code (default: merchant's currency or product's)"),
    product_id: z.string().optional().describe("Product UUID or slug to base the session on"),
    customer_email: z.string().email().optional().describe("Pre-fill customer email"),
    customer_name: z.string().optional().describe("Pre-fill customer name"),
    customer_phone: z.string().optional().describe("Pre-fill customer phone"),
    customer_address: z.string().optional().describe("Pre-fill customer address"),
    success_url: z.string().url().optional().describe("Redirect URL after successful payment"),
    cancel_url: z.string().url().optional().describe("Redirect URL if customer cancels"),
    metadata: MetadataSchema.optional().describe("Arbitrary key-value metadata"),
  },
  async ({ amount_cents, currency, product_id, customer_email, customer_name, customer_phone, customer_address, success_url, cancel_url, metadata }) => {
    const checkout_session = {};
    if (amount_cents != null) checkout_session.amount_cents = amount_cents;
    if (currency) checkout_session.currency = currency;
    if (product_id) checkout_session.product_id = product_id;
    if (customer_email) checkout_session.customer_email = customer_email;
    if (customer_name) checkout_session.customer_name = customer_name;
    if (customer_phone) checkout_session.customer_phone = customer_phone;
    if (customer_address) checkout_session.customer_address = customer_address;
    if (success_url) checkout_session.success_url = success_url;
    if (cancel_url) checkout_session.cancel_url = cancel_url;
    if (metadata) checkout_session.metadata = metadata;

    const data = await api("POST", mpath("/checkout_sessions"), { checkout_session });
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// --- Merchant Info ---------------------------------------------------------

server.tool(
  "get_merchant",
  "Get the current merchant's profile and settings.",
  {},
  async () => {
    const data = await api("GET", mpath("/merchant"));
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
    page: PageParam,
    per_page: PerPageParam,
  },
  async ({ wallet_type, status, enabled, is_default, name, page, per_page }) => {
    const query = buildQuery({
      "q[wallet_type_eq]": wallet_type,
      "q[status_eq]": status,
      "q[enabled_eq]": enabled,
      "q[is_default_eq]": is_default,
      "q[name_cont]": name,
      page,
      per_page,
    });
    const data = await api("GET", mpath(`/wallets${query}`));
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
    const data = await api("GET", mpath(`/wallets/${wallet_id}`));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// --- Payment Requests ------------------------------------------------------

server.tool(
  "create_payment_request",
  "Create a payment request — a simplified flow that creates an Order and Invoice in a single call. Returns a Lightning invoice or Bitcoin address for immediate payment.",
  {
    amount_cents: z.number().int().positive().describe("Amount in cents (e.g. 5000 = $50.00)"),
    payment_method: PaymentMethodEnum.describe("Payment method"),
    description: z.string().optional().describe("Description for the payment request"),
    confirmations: z.number().int().min(1).max(6).optional().describe("Required confirmations for on-chain (1-6)"),
    metadata: MetadataSchema.optional().describe("Arbitrary key-value metadata"),
    idempotency_key: IdempotencyKeyParam,
  },
  async ({ amount_cents, payment_method, description, confirmations, metadata, idempotency_key }) => {
    const body = { payment_request: { amount_cents, payment_method } };
    if (description) body.payment_request.description = description;
    if (confirmations != null) body.payment_request.confirmations = confirmations;
    if (metadata) body.payment_request.metadata = metadata;

    const data = await api("POST", mpath("/payment_requests"), body, idempotencyHeaders(idempotency_key));
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
    const data = await api("GET", mpath(`/payment_requests/${payment_request_id}`));
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
    const data = await api("GET", mpath(`/payment_requests/${payment_request_id}/status`));
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
    page: PageParam,
    per_page: PerPageParam,
  },
  async ({ active, url, created_after, created_before, page, per_page }) => {
    const query = buildQuery({
      "q[active_eq]": active,
      "q[url_cont]": url,
      "q[created_at_gteq]": created_after,
      "q[created_at_lteq]": created_before,
      page,
      per_page,
    });
    const data = await api("GET", mpath(`/webhooks${query}`));
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
    const data = await api("GET", mpath(`/webhooks/${webhook_id}`));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "create_webhook",
  "Create a new webhook endpoint. Returns the webhook with its signing secret (shown only once — save it).",
  {
    url: z.string().url().describe("The URL to receive webhook events"),
    description: z.string().optional().describe("Description of this webhook"),
    active: z.boolean().default(true).describe("Whether the webhook is active (default: true)"),
    events: z
      .array(z.string())
      .optional()
      .describe("Events to subscribe to (e.g. order.created, invoice.paid, payment.confirmed). Omit for all events."),
    metadata: MetadataSchema.optional().describe("Arbitrary key-value metadata"),
  },
  async ({ url, description, active, events, metadata }) => {
    const body = { webhook: { url, active } };
    if (description) body.webhook.description = description;
    if (events) body.webhook.events = events;
    if (metadata) body.webhook.metadata = metadata;

    const data = await api("POST", mpath("/webhooks"), body);
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
    metadata: MetadataSchema.optional().describe("Replace metadata"),
  },
  async ({ webhook_id, url, description, active, events, metadata }) => {
    const body = { webhook: {} };
    if (url) body.webhook.url = url;
    if (description != null) body.webhook.description = description;
    if (active != null) body.webhook.active = active;
    if (events) body.webhook.events = events;
    if (metadata) body.webhook.metadata = metadata;

    const data = await api("PATCH", mpath(`/webhooks/${webhook_id}`), body);
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
    await api("DELETE", mpath(`/webhooks/${webhook_id}`));
    return { content: [{ type: "text", text: `Webhook ${webhook_id} deleted.` }] };
  }
);

// --- Catalog ---------------------------------------------------------------

server.tool(
  "get_catalog",
  "Get the merchant's full product catalog including product types, products, taxes, and discounts.",
  {},
  async () => {
    const data = await api("GET", mpath("/catalog"));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "get_catalog_version",
  "Get the catalog version timestamp. Use this for lightweight cache invalidation checks without loading the full catalog.",
  {},
  async () => {
    const data = await api("GET", mpath("/catalog/version"));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// --- Products --------------------------------------------------------------

server.tool(
  "list_products",
  "List the merchant's products with optional filters.",
  {
    name: z.string().optional().describe("Filter by name (partial match)"),
    status: z.string().optional().describe("Filter by status (e.g. active, archived)"),
    sku: z.string().optional().describe("Filter by exact SKU"),
    external_ref: z.string().optional().describe("Filter by external reference (e.g. ch_..., md_...)"),
    created_after: z.string().optional().describe("Created on or after this date (ISO 8601)"),
    created_before: z.string().optional().describe("Created on or before this date (ISO 8601)"),
    page: PageParam,
    per_page: PerPageParam,
  },
  async ({ name, status, sku, external_ref, created_after, created_before, page, per_page }) => {
    const query = buildQuery({
      "q[name_cont]": name,
      "q[status_eq]": status,
      "q[sku_eq]": sku,
      "q[external_ref_eq]": external_ref,
      "q[created_at_gteq]": created_after,
      "q[created_at_lteq]": created_before,
      page,
      per_page,
    });
    const data = await api("GET", mpath(`/products${query}`));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "get_product",
  "Get a product by ID. Accepts either the UUID or the slug.",
  {
    product_id: z.string().describe("Product UUID or slug"),
  },
  async ({ product_id }) => {
    const data = await api("GET", mpath(`/products/${product_id}`));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "create_product",
  "Create a new product in the merchant's catalog.",
  {
    name: z.string().describe("Product name"),
    price_cents: z.number().int().nonnegative().describe("Price in cents"),
    description: z.string().optional().describe("Product description"),
    sku: z.string().optional().describe("Stock-keeping unit"),
    status: z.string().optional().describe("Product status (e.g. active, archived)"),
    product_type_id: z.string().optional().describe("Product type UUID"),
    resource_type: z.string().optional().describe("Resource type (e.g. digital_download, physical, service)"),
    image_url: z.string().url().optional().describe("Image URL"),
    access_duration_seconds: z.number().int().optional().describe("Time-limited access duration in seconds (for gated content)"),
    external_ref: z.string().optional().describe("External reference set by the client (e.g. ch_..., md_...)"),
    metadata: MetadataSchema.optional().describe("Arbitrary key-value metadata"),
  },
  async (params) => {
    const data = await api("POST", mpath("/products"), { product: params });
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "update_product",
  "Update a product. Accepts either the UUID or the slug as the identifier.",
  {
    product_id: z.string().describe("Product UUID or slug"),
    name: z.string().optional(),
    price_cents: z.number().int().nonnegative().optional(),
    description: z.string().optional(),
    sku: z.string().optional(),
    status: z.string().optional(),
    product_type_id: z.string().optional(),
    resource_type: z.string().optional(),
    image_url: z.string().url().optional(),
    access_duration_seconds: z.number().int().optional(),
    external_ref: z.string().optional(),
    metadata: MetadataSchema.optional(),
  },
  async ({ product_id, ...fields }) => {
    const data = await api("PATCH", mpath(`/products/${product_id}`), { product: fields });
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "delete_product",
  "Delete a product. Hard-deletes if nothing references it, otherwise archives.",
  {
    product_id: z.string().describe("Product UUID or slug"),
  },
  async ({ product_id }) => {
    await api("DELETE", mpath(`/products/${product_id}`));
    return { content: [{ type: "text", text: `Product ${product_id} deleted or archived.` }] };
  }
);

server.tool(
  "get_product_key",
  "Get the AES-256-GCM encryption key for a product. Sensitive — required only by clients that re-encrypt or verify content (e.g. PrivaPaid Stream during a key-rotation window).",
  {
    product_id: z.string().describe("Product UUID or slug"),
  },
  async ({ product_id }) => {
    const data = await api("GET", mpath(`/products/${product_id}/key`));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "rotate_product_key",
  "Generate a new encryption key for a product. The previous key is retained as old_key for a re-encryption window. Returns 409 if a previous rotation is still pending — call clear_product_old_key first.",
  {
    product_id: z.string().describe("Product UUID or slug"),
  },
  async ({ product_id }) => {
    const data = await api("POST", mpath(`/products/${product_id}/rotate_key`));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "clear_product_old_key",
  "Clear the old_key field after re-encryption has completed. Required before another rotation can run.",
  {
    product_id: z.string().describe("Product UUID or slug"),
  },
  async ({ product_id }) => {
    const data = await api("POST", mpath(`/products/${product_id}/clear_old_key`));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// --- Product Types ---------------------------------------------------------

server.tool(
  "list_product_types",
  "List the merchant's product types (categories).",
  {
    name: z.string().optional().describe("Filter by name (partial match)"),
    external_ref: z.string().optional().describe("Filter by external reference"),
    page: PageParam,
    per_page: PerPageParam,
  },
  async ({ name, external_ref, page, per_page }) => {
    const query = buildQuery({
      "q[name_cont]": name,
      "q[external_ref_eq]": external_ref,
      page,
      per_page,
    });
    const data = await api("GET", mpath(`/product_types${query}`));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "get_product_type",
  "Get a product type by ID.",
  {
    product_type_id: z.string().describe("Product type UUID"),
  },
  async ({ product_type_id }) => {
    const data = await api("GET", mpath(`/product_types/${product_type_id}`));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "create_product_type",
  "Create a new product type (category).",
  {
    name: z.string().describe("Product type name"),
    position: z.number().int().optional().describe("Display position"),
    external_ref: z.string().optional().describe("External reference set by the client"),
  },
  async (params) => {
    const data = await api("POST", mpath("/product_types"), { product_type: params });
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "update_product_type",
  "Update a product type.",
  {
    product_type_id: z.string().describe("Product type UUID"),
    name: z.string().optional(),
    position: z.number().int().optional(),
    external_ref: z.string().optional(),
  },
  async ({ product_type_id, ...fields }) => {
    const data = await api("PATCH", mpath(`/product_types/${product_type_id}`), { product_type: fields });
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "delete_product_type",
  "Delete a product type. Returns 409 if products are still assigned to it.",
  {
    product_type_id: z.string().describe("Product type UUID"),
  },
  async ({ product_type_id }) => {
    await api("DELETE", mpath(`/product_types/${product_type_id}`));
    return { content: [{ type: "text", text: `Product type ${product_type_id} deleted.` }] };
  }
);

// --- Merchant Documents (compliance) ---------------------------------------
//
// Create requires multipart file upload — not exposed via MCP today. Use the
// dashboard to upload, then manage status via list/get/delete here.

server.tool(
  "list_merchant_documents",
  "List the merchant's compliance documents (KYC, agreements, etc.).",
  {
    page: PageParam,
    per_page: PerPageParam,
  },
  async ({ page, per_page }) => {
    const query = buildQuery({ page, per_page });
    const data = await api("GET", mpath(`/merchant_documents${query}`));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "get_merchant_document",
  "Get a compliance document by ID.",
  {
    document_id: z.string().describe("Merchant document UUID"),
  },
  async ({ document_id }) => {
    const data = await api("GET", mpath(`/merchant_documents/${document_id}`));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

server.tool(
  "delete_merchant_document",
  "Delete a compliance document. Only pending documents can be deleted — approved or rejected ones must stay for audit.",
  {
    document_id: z.string().describe("Merchant document UUID"),
  },
  async ({ document_id }) => {
    await api("DELETE", mpath(`/merchant_documents/${document_id}`));
    return { content: [{ type: "text", text: `Document ${document_id} deleted.` }] };
  }
);

// --- API Tokens ------------------------------------------------------------

server.tool(
  "get_api_token_usage",
  "Get usage stats for an API token — current RPM, monthly request count, and rate-limit metadata.",
  {
    api_token_id: z.string().describe("API token UUID"),
  },
  async ({ api_token_id }) => {
    const data = await api("GET", mpath(`/api_tokens/${api_token_id}/usage`));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// --- Access Verification ---------------------------------------------------

server.tool(
  "verify_access_token",
  "Verify a macaroon-based access token. Returns valid status, remaining seconds, and (for v2 macaroons with confirmed payment) product_id, order_id, encryption key, and key fingerprint. Used by content-delivery clients to gate access after payment.",
  {
    access_token: z.string().describe("The macaroon access token to verify"),
  },
  async ({ access_token }) => {
    const data = await api("POST", mpath("/access/verify"), { access_token });
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// --- Subscription Plans ----------------------------------------------------

server.tool(
  "list_subscription_plans",
  "List available subscription plans. This is a public endpoint that does not require authentication.",
  {},
  async () => {
    const data = await api("GET", pubpath("/subscription_plans"));
    return { content: [{ type: "text", text: formatJSON(data) }] };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
