# satsrail-mcp

MCP (Model Context Protocol) server for [SatsRail](https://app.satsrail.com) — let AI agents accept Bitcoin Lightning payments.

## What is this?

An MCP server that gives AI agents (Claude, Cursor, Windsurf, etc.) the ability to create orders, generate Lightning invoices, check payment status, and manage checkout sessions through SatsRail's API.

**Why Lightning + AI agents?**  
Credit cards need forms, browsers, and 3D Secure. A Lightning payment is just a string — one API call, no browser required. Perfect for programmatic agents.

## Quick Start

### 1. Get your API key

Sign up at [app.satsrail.com](https://app.satsrail.com) and grab your secret key (`sk_live_...` or `sk_test_...`) from the dashboard.

### 2. Configure your AI tool

#### Claude Desktop

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

#### Cursor

Add to `.cursor/mcp.json` in your project:

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

### 3. Use it

Ask your AI agent:

> "Create a $25 order for a coffee subscription and generate a Lightning invoice"

The agent will call `create_order` and return the invoice details including the bolt11 payment string.

## Available Tools

| Tool | Description |
|------|-------------|
| `create_order` | Create a payment order with optional Lightning invoice |
| `get_order` | Get order details by ID |
| `list_orders` | List orders with optional status filter |
| `cancel_order` | Cancel a pending order |
| `get_invoice` | Get invoice details (bolt11, payment address) |
| `check_invoice_status` | Real-time payment status check |
| `generate_invoice` | Generate invoice for an existing order |
| `list_payments` | List confirmed payments |
| `get_payment` | Get payment details |
| `create_checkout_session` | Create a hosted checkout session |
| `get_merchant` | Get merchant profile and settings |
| `list_wallets` | List connected wallets |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SATSRAIL_API_KEY` | Yes | Your SatsRail API key (`sk_live_*` or `sk_test_*`) |
| `SATSRAIL_BASE_URL` | No | API base URL (default: `https://app.satsrail.com`) |

## Example: Full Payment Flow

```
Agent: "Create an order for $50"
→ calls create_order(amount_cents: 5000, generate_invoice: true)
→ returns order with bolt11 Lightning invoice

Agent: "Check if it's been paid"
→ calls check_invoice_status(invoice_id: "...")
→ returns { status: "pending" | "paid" | "expired" }

Agent: "Show me today's payments"
→ calls list_payments(start_date: "2026-02-15", end_date: "2026-02-15")
→ returns list of confirmed payments
```

## Test Mode

Use a `sk_test_*` key to create test orders and invoices. Test mode is fully isolated — no real payments are processed, and test data never mixes with live data.

## Links

- [SatsRail Developer Docs](https://app.satsrail.com/developers)
- [API Reference](https://app.satsrail.com/api-docs)
- [Node.js SDK](https://github.com/SatsRail/satsrail-node)
- [Python SDK](https://github.com/SatsRail/satsrail-python)
- [Ruby SDK](https://github.com/SatsRail/satsrail-ruby)

## License

MIT
