# Contributing to satsrail-mcp

Thanks for your interest in improving the SatsRail MCP server.

## Project shape

This is a thin MCP wrapper over the SatsRail HTTP API. It does not implement business logic — it forwards tool calls to `app.satsrail.com`. When the API changes, this wrapper has to follow.

- One file: [`src/index.js`](src/index.js).
- Each `server.tool(...)` block maps one MCP tool to one API endpoint.
- Paths must use `mpath()` (merchant, `sk_*` / `pk_*` auth) or `pubpath()` (public/embed) — never raw strings. The wrong namespace fails silently with a 404. Refer to [`portal/config/routes.rb`](https://github.com/SatsRail/satsrail-portal) for the authoritative path list (private repo).

## Hard rule: no admin endpoints

This MCP only targets `/m/` and `/pub/`. Never `/admin/`. Admin routes are operator-only (`ak_*` tokens, cross-merchant access, audit-tracked lifecycle ops) and are not part of the public API contract. If a merchant-facing capability is currently admin-only, the right fix is a new `/m/` route in the portal — not an MCP tool that wraps an admin endpoint.

PRs that expose an admin operation as a tool will be closed. See `docs/portal/api-namespaces.md` in the parent monorepo for the full rationale.

## Local development

```bash
npm install
SATSRAIL_API_KEY=sk_test_... node src/index.js
```

To exercise tools interactively, point the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) at the stdio binary:

```bash
npx @modelcontextprotocol/inspector node src/index.js
```

Set `SATSRAIL_BASE_URL` to target a non-production server (e.g. a staging deploy). Default is `https://app.satsrail.com`.

## Adding a tool

1. Find the route in the portal API. Confirm the namespace (`/m/` or `/pub/`).
2. Add a `server.tool(name, description, schema, handler)` block in [`src/index.js`](src/index.js).
3. Use `mpath()` / `pubpath()` for the URL.
4. Validate inputs with `zod`. Match the request body shape the controller expects (most resources are wrapped: `{ order: {...} }`, `{ webhook: {...} }`).
5. Return `{ content: [{ type: "text", text: formatJSON(data) }] }` for JSON responses.

## Versioning

Semantic Versioning. Tool additions are minor bumps. Any change to a tool's name, parameter names, or HTTP semantics is a major bump — agents in the wild rely on the surface staying stable.

Update [`CHANGELOG.md`](CHANGELOG.md) in the same PR.

## Pull requests

- Keep PRs small and focused. One tool per PR is fine; one resource group per PR is fine.
- Don't bundle dep bumps with tool changes.
- Smoke-test against a real `sk_test_*` key before requesting review.

## Reporting issues

Open an issue at [github.com/SatsRail/satsrail-mcp/issues](https://github.com/SatsRail/satsrail-mcp/issues). Include the tool name, the input you sent, and the error returned.
