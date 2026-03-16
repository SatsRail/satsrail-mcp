<p align="center">
  <h1 align="center">⚡ satsrail-mcp</h1>
  <p align="center">
    <strong>Bitcoin Lightning payments for AI agents via Model Context Protocol</strong>
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/satsrail-mcp"><img src="https://img.shields.io/npm/v/satsrail-mcp" alt="npm"></a>
    <a href="https://github.com/SatsRail/satsrail-mcp/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/satsrail-mcp" alt="license"></a>
    <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/protocol-MCP-blue" alt="MCP"></a>
    <a href="https://satsrail.com"><img src="https://img.shields.io/badge/payments-Lightning-orange" alt="Lightning"></a>
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

Sign up at [satsrail.com](https://satsrail.com) and grab your secret key (`sk_live_...` or `sk_test_...`) from the dashboard.

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

### Orders
| Tool | Description |
|------|-------------|
| `create_order` | Create a payment order with optional auto-generated Lightning invoice |
| `get_order` | Get order details by ID (expandable: invoice, payment, merchant) |
| `list_orders` | List and filter orders by status |
| `cancel_order` | Cancel a pending order |

### Invoices & Payments
| Tool | Description |
|------|-------------|
| `get_invoice` | Get invoice details including bolt11 Lightning payment string |
| `generate_invoice` | Generate a new invoice for an existing order |
| `check_invoice_status` | Real-time payment verification against the Lightning node |
| `list_payments` | List confirmed payments with optional date range filter |
| `get_payment` | Get payment details by ID |

### Checkout & Config
| Tool | Description |
|------|-------------|
| `create_checkout_session` | Create a hosted checkout session with redirect URL |
| `get_merchant` | Get merchant profile and settings |
| `list_wallets` | List connected Lightning wallets |

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

SatsRail never holds your funds. Connect your own Lightning node — payments settle directly to your wallet. [Learn more about our non-custodial architecture →](https://satsrail.com/blog/how-non-custodial-bitcoin-lightning-payments-actually-work)

## SDKs

Need direct API access instead of MCP? Use our SDKs:

- **[Node.js](https://github.com/SatsRail/satsrail-node)** — `npm install satsrail`
- **[Python](https://github.com/SatsRail/satsrail-python)** — `pip install satsrail`
- **[Ruby](https://github.com/SatsRail/satsrail-ruby)** — `gem install satsrail`

## Resources

- [Developer Docs](https://satsrail.com/developers) — Quickstart, testing, webhooks, embed
- [AI Agents Guide](https://satsrail.com/developers/ai-agents) — Agent payment flows and architecture
- [API Reference](https://satsrail.com/api-docs) — Full REST API documentation
- [Blog](https://satsrail.com/blog) — Lightning payments, agent economy, Bitcoin adoption

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong>The payment rail for the agent economy.</strong><br>
  <a href="https://satsrail.com">satsrail.com</a> · <a href="https://x.com/satsrail">@satsrail</a>
</p>
