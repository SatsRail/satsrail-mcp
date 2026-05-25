# SatsRail MCP Server — AGENTS.md

MCP (Model Context Protocol) server for AI tool integration with SatsRail. Lets any MCP-compatible client (Claude Desktop, Cursor, Windsurf, Cline) call the SatsRail HTTP API as tools.

## What this is

A thin wrapper. One file: [`src/index.js`](src/index.js). Each `server.tool(...)` block maps one MCP tool to one HTTP endpoint. No business logic — when the API changes, this follows.

## Tech stack

- **Language:** JavaScript (ESM), Node `>=18`
- **Protocol:** MCP via `@modelcontextprotocol/sdk`
- **Schema:** `zod`
- **Transport:** stdio (the only transport MCP clients currently launch)

## Conventions

- npm only (no yarn).
- Tools mirror the SatsRail API resource structure.
- One file. Don't fragment into modules until there's a real reason — the file is currently small enough to read end-to-end.

## The namespace rule (read before adding or moving a tool)

The SatsRail API is namespaced. Getting this wrong is the bug that shipped in v1.0.0 — every tool 404'd because every path was missing the namespace.

- **Merchant API** (`sk_*` / `pk_*` token auth) lives at `/api/v1/m/{resource}`. Use `mpath("/orders")` etc.
- **Public/embed API** (no auth, or embed key auth) lives at `/api/v1/pub/{resource}`. Use `pubpath("/subscription_plans")` etc.
- **Admin API** (`ak_*` tokens) lives at `/api/v1/admin/*` — not exposed via MCP today and probably should not be, since admin tokens are tier-elevated.

The authoritative path list is [`portal/config/routes.rb`](../portal/config/routes.rb) (`namespace :api do namespace :v1 do ...`). The OpenAPI snapshot at [`portal/public/api/v1/swagger.json`](../portal/public/api/v1/swagger.json) lags occasionally; treat `routes.rb` as truth.

When in doubt, run the portal locally (`cd portal && bin/rails routes | grep api/v1`) and confirm.

## What's not yet exposed (and probably should be)

These exist in the API but the MCP doesn't surface them yet:

- `access/verify` — server-to-server access token verification (Stream relies on this; useful for any content-gating client)
- Products CRUD + `key` / `rotate_key` / `clear_old_key`
- Product types CRUD
- Merchant documents (compliance) CRUD
- `api_tokens/{id}/usage`
- Sessions (`create` / `activate`)
- `checkout_sessions` list / show (only `create` is exposed today)

See the README's "Roadmap" or the parent context if a related work item exists.

## Local development

```bash
npm install
SATSRAIL_API_KEY=sk_test_xxx node src/index.js
```

Drive it interactively with the MCP inspector:

```bash
npx @modelcontextprotocol/inspector node src/index.js
```

`SATSRAIL_BASE_URL` overrides the API host (default `https://app.satsrail.com`). Useful for staging or local portal.

## Release

Tag and publish:

```bash
npm version <patch|minor|major>
npm publish
git push --follow-tags
```

Update [`CHANGELOG.md`](CHANGELOG.md) in the same PR as the change, not in the release commit.
