// End-to-end smoke test: spawn the bin, do the JSON-RPC handshake, list tools,
// invoke one tool against a fake server. Catches integration regressions that
// the unit tests in lib.test.js can't see (e.g. tool registration shape changes
// or bad import paths).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(__dirname, "..", "src", "index.js");

/**
 * Drive a stdio MCP server via JSON-RPC. Splits incoming stdout on newlines
 * and resolves the next pending response by id.
 */
function startServer(env = {}) {
  const child = spawn("node", [BIN], {
    env: { ...process.env, SATSRAIL_API_KEY: "sk_test_dummy", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buf = "";
  const pending = new Map();
  let nextId = 1;

  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id).resolve(msg);
        pending.delete(msg.id);
      }
    }
  });

  function send(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout waiting for ${method}`));
        }
      }, 5_000);
    });
  }

  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async function initialize() {
    const res = await send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "vitest-smoke", version: "0" },
    });
    notify("notifications/initialized");
    return res;
  }

  function close() {
    child.kill();
  }

  return { send, notify, initialize, close, child };
}

describe("MCP server smoke test", () => {
  let server;

  beforeAll(async () => {
    server = startServer();
    await server.initialize();
  });

  afterAll(() => {
    server?.close();
  });

  it("advertises name and version in initialize", async () => {
    const init = await server.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "vitest-smoke", version: "0" },
    });
    expect(init.result.serverInfo.name).toBe("satsrail");
    expect(init.result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("registers all 45 tools", async () => {
    const res = await server.send("tools/list");
    const names = res.result.tools.map((t) => t.name);
    expect(names.length).toBeGreaterThanOrEqual(45);
  });

  it("does not expose delete_merchant_document (admin-only)", async () => {
    const res = await server.send("tools/list");
    const names = res.result.tools.map((t) => t.name);
    expect(names).not.toContain("delete_merchant_document");
  });

  it("includes the surface-completion tools added in v1.2.0", async () => {
    const res = await server.send("tools/list");
    const names = res.result.tools.map((t) => t.name);
    // Sanity-check a representative subset across each new group.
    const required = [
      "verify_access_token",
      "list_products",
      "get_product_key",
      "rotate_product_key",
      "create_product_type",
      "list_merchant_documents",
      "get_api_token_usage",
      "list_checkout_sessions",
    ];
    for (const tool of required) {
      expect(names).toContain(tool);
    }
  });

  it("emits valid JSON Schema for every tool", async () => {
    const res = await server.send("tools/list");
    for (const tool of res.result.tools) {
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

describe("MCP tool dispatch against a fake API", () => {
  let api;
  let server;
  const requests = [];

  beforeAll(async () => {
    // Spin a fake HTTP server that records requests. We point the MCP at it
    // via SATSRAIL_BASE_URL so we can assert that tool calls really do hit
    // the right path and carry the right body.
    api = createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        requests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString(),
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ object: "merchant", id: "mer_test" }));
      });
    });
    await new Promise((r) => api.listen(0, r));
    const port = api.address().port;

    server = startServer({ SATSRAIL_BASE_URL: `http://127.0.0.1:${port}` });
    await server.initialize();
  });

  afterAll(() => {
    server?.close();
    api?.close();
  });

  it("get_merchant routes to /api/v1/m/merchant with Bearer auth", async () => {
    requests.length = 0;
    const res = await server.send("tools/call", { name: "get_merchant", arguments: {} });
    expect(res.error).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("GET");
    expect(requests[0].url).toBe("/api/v1/m/merchant");
    expect(requests[0].headers.authorization).toBe("Bearer sk_test_dummy");
  });

  it("list_subscription_plans routes to /api/v1/pub/subscription_plans (no double prefix)", async () => {
    requests.length = 0;
    await server.send("tools/call", { name: "list_subscription_plans", arguments: {} });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/v1/pub/subscription_plans");
  });

  it("create_order POSTs to /api/v1/m/orders with the order wrapper and Idempotency-Key", async () => {
    requests.length = 0;
    await server.send("tools/call", {
      name: "create_order",
      arguments: {
        amount_cents: 5000,
        idempotency_key: "vitest-1",
        generate_invoice: false,
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toBe("/api/v1/m/orders");
    expect(requests[0].headers["idempotency-key"]).toBe("vitest-1");
    const body = JSON.parse(requests[0].body);
    expect(body.order.total_amount_cents).toBe(5000);
    expect(body.generate_invoice).toBe(false);
  });

  it("list_orders applies ransack filters and pagination", async () => {
    requests.length = 0;
    await server.send("tools/call", {
      name: "list_orders",
      arguments: { status: "paid", per_page: 50, page: 2 },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/v1/m/orders?q%5Bstatus_eq%5D=paid&page=2&per_page=50");
  });

  it("verify_access_token POSTs to /api/v1/m/access/verify with the token", async () => {
    requests.length = 0;
    await server.send("tools/call", {
      name: "verify_access_token",
      arguments: { access_token: "macaroon-abc" },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("/api/v1/m/access/verify");
    expect(JSON.parse(requests[0].body)).toEqual({ access_token: "macaroon-abc" });
  });
});
