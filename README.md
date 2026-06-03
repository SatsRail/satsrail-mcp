<p align="center">
  <h1 align="center">⚡ satsrail-mcp</h1>
  <p align="center">
    <strong>Bitcoin Lightning payments for AI agents via Model Context Protocol</strong>
  </p>
  <p align="center">
    <a href="https://github.com/SatsRail/satsrail-mcp/blob/main/CHANGELOG.md"><img src="https://img.shields.io/github/package-json/v/SatsRail/satsrail-mcp" alt="version"></a>
    <a href="https://github.com/SatsRail/satsrail-mcp/actions/workflows/test.yml"><img src="https://github.com/SatsRail/satsrail-mcp/actions/workflows/test.yml/badge.svg" alt="tests"></a>
    <a href="https://github.com/SatsRail/satsrail-mcp/blob/main/LICENSE"><img src="https://img.shields.io/github/license/SatsRail/satsrail-mcp" alt="license"></a>
    <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/protocol-MCP-blue" alt="MCP"></a>
    <a href="https://www.satsrail.com/"><img src="https://img.shields.io/badge/payments-Lightning-orange" alt="Lightning"></a>
  </p>
</p>

---

Give any MCP-compatible AI agent the ability to accept Bitcoin Lightning payments. Create orders, generate invoices, check payment status — all through natural language. No browser, no forms, no redirects.

**Works with:** Claude Desktop · Cursor · Windsurf · Cline · any MCP client

## Why Lightning for AI Agents?

| | Credit Cards | Lightning (SatsRail) |
|---|---|---|
| **Integration** | Browser forms, 3D Secure, redirects | One API call → invoice string |
| **Settlement** | 2-3 business days | Instant (seconds) |
| **Fees** | 2.9% + $0.30 per transaction | Fractions of a cent |
| **Microtransactions** | Economically irrational under $5 | Works at any amount |
| **Agent-friendly** | Requires browser rendering | Pure API — no UI needed |
| **Custody** | Funds held by processor | Non-custodial — you keep your sats |

## Quick Start

### 1. Get your API key

Sign up at [satsrail.com](https://www.satsrail.com/) and grab your secret key (`sk_live_...` or `sk_test_...`) from the dashboard.

### 2. Configure your AI tool

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "satsrail": {
      "command": "npx",
      "args": ["-y", "satsrail-mcp"],
      "env": {
        "SATSRAIL_API_KEY": "sk_test_your_key_here"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Cursor / Windsurf</strong></summary>

Add to `.cursor/mcp.json` (or `.windsurf/mcp.json`) in your project:

```json
{
  "mcpServers": {
    "satsrail": {
      "command": "npx",
      "args": ["-y", "satsrail-mcp"],
      "env": {
        "SATSRAIL_API_KEY": "sk_test_your_key_here"
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Any MCP client (npx)</strong></summary>

```bash
SATSRAIL_API_KEY=sk_test_... npx satsrail-mcp
```
</details>

### 3. Use it

Ask your AI agent:

> "Create a $25 order for a monthly subscription and generate a Lightning invoice"

The agent calls `create_order`, returns the bolt11 Lightning invoice, and the customer pays with any Lightning wallet. Settlement in seconds.

## Available Tools

46 tools covering the full SatsRail merchant API.

### Orders
| Tool | Description |
|------|-------------|
| `create_order` | Create a payment order with optional auto-generated Lightning invoice. Supports `idempotency_key`. |
| `get_order` | Get order details by ID (expandable: invoice, payment, merchant) |
| `list_orders` | List and filter orders by status, currency, amount range, date range |
| `update_order` | Update a pending order, mark cash orders paid, mark paid orders shipped |
| `cancel_order` | Cancel a pending order |

### Invoices
| Tool | Description |
|------|-------------|
| `get_invoice` | Get invoice details including bolt11 Lightning payment string |
| `generate_invoice` | Generate a new invoice for an existing order. Supports `idempotency_key`. |
| `check_invoice_status` | Real-time payment verification against the Lightning node |
| `get_invoice_qr` | Get a QR code (SVG) for an invoice |

### Payments
| Tool | Description |
|------|-------------|
| `list_payments` | List confirmed payments with optional date and amount filters |
| `get_payment` | Get payment details by ID |

### Payment Requests
| Tool | Description |
|------|-------------|
| `create_payment_request` | One-call flow: creates an Order and Invoice together. Supports `idempotency_key`. |
| `get_payment_request` | Get details of a payment request |
| `get_payment_request_status` | Real-time payment status |

### Checkout Sessions
| Tool | Description |
|------|-------------|
| `create_checkout_session` | Create a hosted checkout. Supports `product_id`, customer pre-fill, success/cancel URLs |
| `list_checkout_sessions` | List sessions with filters |
| `get_checkout_session` | Get session by ID |

### Products
| Tool | Description |
|------|-------------|
| `list_products` | List products with name/status/SKU/external_ref filters |
| `get_product` | Get a product (UUID or slug) |
| `create_product` / `update_product` / `delete_product` | Full CRUD |
| `get_product_key` | Read the AES-256-GCM encryption key (sensitive — for re-encryption windows) |
| `rotate_product_key` | Rotate the encryption key, retaining old_key for re-encryption |
| `clear_product_old_key` | Clear old_key after re-encryption is complete |

### Product Types
| Tool | Description |
|------|-------------|
| `list_product_types` / `get_product_type` / `create_product_type` / `update_product_type` / `delete_product_type` | Full CRUD for product categories |

### Webhooks
| Tool | Description |
|------|-------------|
| `list_webhooks` / `get_webhook` / `create_webhook` / `update_webhook` / `delete_webhook` | Full CRUD for webhook endpoints (signing secret returned once on create) |

### Catalog & Merchant
| Tool | Description |
|------|-------------|
| `get_catalog` | Full catalog: product types, products, taxes, discounts |
| `get_catalog_version` | Lightweight version timestamp for cache invalidation |
| `get_merchant` | Current merchant profile and settings |
| `list_wallets` / `get_wallet` | Connected Lightning / Bitcoin wallets |

### Compliance & Access
| Tool | Description |
|------|-------------|
| `list_merchant_documents` / `get_merchant_document` | Read KYC and compliance documents (uploads and deletions are admin-only) |
| `verify_access_token` | Verify a macaroon access token, returns key + remaining time on success |
| `get_api_token_usage` | RPM and monthly request stats for an API token |
| `list_subscription_plans` | Public list of subscription plans (no auth required) |

All `list_*` tools accept `page` and `per_page` (1–100, default 25). All `metadata` fields follow the portal's limits: ≤50 keys, ≤40-char keys, ≤500-char string values.

## Example: Complete Payment Flow

```
User: "Charge me $50 for the pro plan"

Agent → create_order(amount_cents: 5000, description: "Pro Plan", generate_invoice: true)
     ← order_id: "ord_abc123", bolt11: "lnbc500u1pj...kqq5yxmetu"

Agent: "Here's your Lightning invoice — scan the QR or copy the payment string."

User: "Paid!"

Agent → check_invoice_status(invoice_id: "inv_xyz789")
     ← { status: "paid", settled_at: "2026-02-19T..." }

Agent: "Payment confirmed! Your Pro plan is active. ⚡"
```

## Use Cases

- **SaaS billing** — Agents that sell API access, subscriptions, or per-task services and collect payment in the conversation
- **Agent-to-agent commerce** — Autonomous agents paying each other for services (translation, compute, data) with instant settlement
- **Invoice automation** — Generate and send Lightning invoices programmatically based on milestones, usage, or schedules
- **Multi-merchant platforms** — Build agent-powered marketplaces where AI handles checkout across vendors
- **Micropayments** — Pay-per-query, pay-per-generation, pay-per-anything — amounts too small for credit cards

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SATSRAIL_API_KEY` | Yes | Your SatsRail API key (`sk_live_*` or `sk_test_*`) |
| `SATSRAIL_BASE_URL` | No | API base URL (default: `https://satsrail.com`) |

## Test Mode

Use `sk_test_*` keys to create test orders and invoices in a fully isolated sandbox. No real payments processed, no test data mixing with production.

## Non-Custodial

SatsRail never holds your funds. Connect your own Lightning node — payments settle directly to your wallet. [Learn more about our non-custodial architecture →](https://www.satsrail.com/blog/how-non-custodial-bitcoin-lightning-payments-actually-work)

## SDKs

Need direct API access instead of MCP? Use our SDKs:

- **[Node.js](https://github.com/SatsRail/satsrail-node)** — `npm install satsrail`
- **[Python](https://github.com/SatsRail/satsrail-python)** — `pip install satsrail`
- **[Ruby](https://github.com/SatsRail/satsrail-ruby)** — `gem install satsrail`

## Resources

- [Developer Docs](https://developer.satsrail.com/) — Quickstart, testing, webhooks, embed
- [AI Agents Guide](https://developer.satsrail.com/ai-agents) — Agent payment flows and architecture
- [API Reference](https://developer.satsrail.com/) — Full REST API documentation
- [Use Cases](https://www.satsrail.com/use-cases/) — Bitcoin payments across industries
- [Pricing](https://www.satsrail.com/pricing/) — Zero transaction fees
- [Blog](https://www.satsrail.com/blog/) — Lightning payments, agent economy, Bitcoin adoption

## Local development

```bash
git clone https://github.com/SatsRail/satsrail-mcp
cd satsrail-mcp
npm install
npm test            # vitest — unit + smoke against a fake server
SATSRAIL_API_KEY=sk_test_xxx npm start
```

Drive it interactively with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector node src/index.js
```

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong>The payment rail for the agent economy.</strong><br>
  <a href="https://www.satsrail.com/">satsrail.com</a> · <a href="https://x.com/satsrail">@satsrail</a>
</p>
