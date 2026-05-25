# Changelog

All notable changes to `satsrail-mcp` are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [1.2.0] — 2026-05-24

### Added
- **Access verification** — `verify_access_token` for content-delivery clients gating access after payment (macaroon validation, returns product/order/key on success).
- **Products** — full CRUD (`list_products`, `get_product`, `create_product`, `update_product`, `delete_product`) plus key management (`get_product_key`, `rotate_product_key`, `clear_product_old_key`). Identifiers accept both UUID and slug.
- **Product types** — full CRUD (`list_product_types`, `get_product_type`, `create_product_type`, `update_product_type`, `delete_product_type`).
- **Merchant documents** — `list_merchant_documents`, `get_merchant_document`, `delete_merchant_document`. Create requires multipart upload; deferred to a future release.
- **API token usage** — `get_api_token_usage` exposes RPM and monthly request counts.
- **Checkout sessions** — added `list_checkout_sessions` and `get_checkout_session`. Extended `create_checkout_session` with `product_id`, `customer_email`, `customer_name`, `customer_phone`, `customer_address`, and `metadata`.
- **Pagination** — every `list_*` tool now accepts `per_page` (1–100, default 25). Portal already supported this; the MCP just didn't expose it.
- **Idempotency** — `create_order` and `generate_invoice` now accept `idempotency_key` (in addition to the existing `create_payment_request`). Matches the three endpoints where the portal honors the `Idempotency-Key` header.

### Changed
- **Metadata validation** — `metadata` parameters now match the portal's `HasMetadata` concern: max 50 keys, 40-char keys, 500-char string values. Violations are caught client-side instead of bouncing off a 422.
- **Error surfacing** — when the API returns a structured error (`{ error: { code, message } }`), the thrown message now includes both code and message (`"validation_failed: name can't be blank"` rather than `"[object Object]"`).
- **204 handling** — `DELETE` endpoints no longer attempt to parse an empty body as JSON.

### Internal
- Extracted `MetadataSchema`, `LineItemSchema`, `PaymentMethodEnum`, `PageParam`, `PerPageParam`, `IdempotencyKeyParam` so every tool that uses them stays consistent.
- Added `buildQuery()` helper to dedupe the ransack `q[...]` param construction across list tools.
- Pure helpers and schemas now live in `src/lib.js` (no side effects) — `src/index.js` is just the binary entry that wires them to the MCP server.

### Tooling
- **Tests** — added `vitest`. `test/lib.test.js` covers the helpers (40 cases). `test/smoke.test.js` spawns the binary, drives it via JSON-RPC, and asserts tool dispatch against a fake HTTP server (9 cases).
- **CI** — `.github/workflows/test.yml` runs the suite on push/PR across Node 18, 20, 22.
- **Release** — `.github/workflows/release.yml` publishes on `v*` tags using npm OIDC trusted publishing (no token to rotate) with `--provenance`. Verifies the tag matches `package.json` first.
- **Tarball** — `files` whitelist in `package.json` ships only `src/`, `README.md`, `CHANGELOG.md`, `LICENSE` (6 files, ~14 kB).
- **Format** — `prettier` config + `npm run format`.

## [1.1.0] — 2026-05-24

### Fixed
- Every tool now targets the correct API namespace. Previous releases sent every request to `/api/v1/{resource}`, but the SatsRail merchant API lives at `/api/v1/m/{resource}` and the public surface at `/api/v1/pub/{resource}`. Every previous tool call 404'd. All tools (`create_order`, `get_invoice`, `list_wallets`, `list_subscription_plans`, `create_checkout_session`, etc.) now route correctly.

### Changed
- Bumped `@modelcontextprotocol/sdk` floor to `^1.29.0`.
- Added `zod` as an explicit dependency (was relying on transitive resolution).
- `subscription_plans` now hits the public namespace explicitly.

### Internal
- Introduced `mpath()` / `pubpath()` helpers so every call site shows which API surface it targets. Keeps the merchant / public split visible.

## [1.0.0] — 2026-03-08

- Initial release.
