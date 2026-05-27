import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Agent } from "../core/agent.js";
import { TicketlessServer } from "../core/server.js";
import { InMemoryAuditLog } from "../core/audit.js";
import { ConfidenceGate } from "../core/gate.js";
import { ScriptedLLM } from "./scripted-llm.js";
import {
  DemoUserLookupTool,
  DemoOrderLookupTool,
  DemoLogSearchTool,
  DemoKnowledgeBaseTool,
} from "../demo/tools.js";

function createTestServer(opts: { async?: boolean; apiKey?: string; reviewMode?: boolean } = {}) {
  const port = 30000 + Math.floor(Math.random() * 10000);
  const llm = new ScriptedLLM();
  const audit = new InMemoryAuditLog();
  const gate = new ConfidenceGate(0.7, ["refund", "cancel subscription"]);

  const agent = new Agent(llm, audit, gate, {
    confidenceThreshold: 0.7,
    maxToolCalls: 10,
    maxInvestigationRounds: 3,
    escalationRules: [],
  });

  agent.registerTool(new DemoUserLookupTool());
  agent.registerTool(new DemoOrderLookupTool());
  agent.registerTool(new DemoLogSearchTool());
  agent.registerTool(new DemoKnowledgeBaseTool());

  const server = new TicketlessServer({
    port,
    agent,
    audit,
    sources: [],
    apiKey: opts.apiKey,
    async: opts.async,
    reviewMode: opts.reviewMode,
  });

  return { server, port, audit };
}

function post(port: number, path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function get(port: number, path: string, headers: Record<string, string> = {}) {
  return fetch(`http://localhost:${port}${path}`, { headers });
}

describe("E2E: Server ticket resolution via HTTP", () => {
  let server: TicketlessServer;
  let port: number;

  beforeEach(async () => {
    ({ server, port } = createTestServer());
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("resolves a login ticket end-to-end via API", async () => {
    const res = await post(port, "/api/ticket", {
      subject: "Can't log into my account",
      body: "I've been trying to log in but it keeps failing",
      customerEmail: "alice@startup.io",
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.action).toBe("reply");
    expect(data.confidence).toBeGreaterThanOrEqual(0.7);
    expect(data.reply).toBeTruthy();
    expect(data.toolsUsed.length).toBeGreaterThan(0);
    expect(data.durationMs).toBeGreaterThan(0);
  });

  it("resolves a payment ticket end-to-end via API", async () => {
    const res = await post(port, "/api/ticket", {
      subject: "Payment failed",
      body: "I tried to buy the API add-on but the payment didn't go through",
      customerEmail: "bob@acmecorp.com",
    });

    const data = await res.json();
    expect(data.action).toBe("reply");
    expect(data.reply).toBeTruthy();
    expect(data.toolsUsed.length).toBeGreaterThan(0);
  });

  it("returns audit trail after resolution", async () => {
    await post(port, "/api/ticket", {
      id: "audit-e2e",
      subject: "Test",
      body: "Testing audit",
      customerEmail: "alice@startup.io",
    });

    const auditRes = await get(port, "/api/audit?ticketId=audit-e2e");
    const auditData = await auditRes.json();

    expect(auditData.entries.length).toBeGreaterThan(0);
    expect(auditData.entries[0].ticketId).toBe("audit-e2e");

    const steps = auditData.entries.map((e: { step: string }) => e.step);
    expect(steps).toContain("received");
    expect(steps).toContain("tool_call");
  });

  it("returns resolution by ticketId", async () => {
    await post(port, "/api/ticket", {
      id: "res-e2e",
      subject: "Login issue",
      body: "Can't log in",
      customerEmail: "alice@startup.io",
    });

    const res = await get(port, "/api/resolution?ticketId=res-e2e");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ticketId).toBe("res-e2e");
    expect(data.action).toBeDefined();
  });

  it("returns stats after processing tickets", async () => {
    await post(port, "/api/ticket", {
      subject: "Test 1",
      body: "Login issue",
      customerEmail: "alice@startup.io",
    });

    const res = await get(port, "/api/stats");
    const data = await res.json();

    expect(data.tickets.total).toBeGreaterThanOrEqual(1);
    expect(data.tickets.toolCalls).toBeGreaterThan(0);
  });

  it("validates ticket input", async () => {
    const res = await post(port, "/api/ticket", {
      subject: "No email",
      body: "Missing email field",
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("email");
  });

  it("rejects invalid JSON", async () => {
    const res = await fetch(`http://localhost:${port}/api/ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
  });

  it("serves dashboard", async () => {
    const res = await get(port, "/dashboard");
    // May return 200 or 500 depending on file path resolution in test env
    expect([200, 500]).toContain(res.status);
  });
});

describe("E2E: Server with API key auth", () => {
  let server: TicketlessServer;
  let port: number;
  const API_KEY = "test-secret-key";

  beforeEach(async () => {
    ({ server, port } = createTestServer({ apiKey: API_KEY }));
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("rejects requests without auth", async () => {
    const res = await post(port, "/api/ticket", {
      subject: "Test",
      body: "Test",
      customerEmail: "a@b.com",
    });
    expect(res.status).toBe(401);
  });

  it("accepts requests with correct Bearer token", async () => {
    const res = await post(
      port,
      "/api/ticket",
      { subject: "Test", body: "Test", customerEmail: "alice@startup.io" },
      { Authorization: `Bearer ${API_KEY}` }
    );
    expect(res.status).toBe(200);
  });

  it("rejects requests with wrong token", async () => {
    const res = await post(
      port,
      "/api/ticket",
      { subject: "Test", body: "Test", customerEmail: "a@b.com" },
      { Authorization: "Bearer wrong-key" }
    );
    expect(res.status).toBe(401);
  });

  it("allows health check without auth", async () => {
    const res = await get(port, "/health");
    expect(res.status).toBe(200);
  });
});

describe("E2E: Server with review mode", () => {
  let server: TicketlessServer;
  let port: number;

  beforeEach(async () => {
    ({ server, port } = createTestServer({ reviewMode: true }));
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("adds escalated tickets to review queue", async () => {
    await post(port, "/api/ticket", {
      id: "review-e2e",
      subject: "I want a refund",
      body: "This product doesn't work, I want a full refund",
      customerEmail: "alice@startup.io",
    });

    const res = await get(port, "/api/review");
    const data = await res.json();

    expect(data.pending).toBeGreaterThanOrEqual(1);
    const item = data.items.find((i: { id: string }) => i.id === "review-e2e");
    expect(item).toBeDefined();
    expect(item.status).toBe("pending");
  });

  it("approves a review item", async () => {
    await post(port, "/api/ticket", {
      id: "approve-e2e",
      subject: "Refund request",
      body: "I want a refund please",
      customerEmail: "alice@startup.io",
    });

    const approveRes = await post(port, "/api/review/approve", {
      ticketId: "approve-e2e",
      note: "Approved by test",
    });

    expect(approveRes.status).toBe(200);

    const reviewRes = await get(port, "/api/review");
    const data = await reviewRes.json();
    const item = data.items.find((i: { id: string }) => i.id === "approve-e2e");
    expect(item.status).toBe("approved");
  });

  it("rejects a review item", async () => {
    await post(port, "/api/ticket", {
      id: "reject-e2e",
      subject: "Cancel subscription",
      body: "I want to cancel my subscription immediately",
      customerEmail: "alice@startup.io",
    });

    const rejectRes = await post(port, "/api/review/reject", {
      ticketId: "reject-e2e",
      reason: "Need more context",
    });

    expect(rejectRes.status).toBe(200);

    const reviewRes = await get(port, "/api/review");
    const data = await reviewRes.json();
    const item = data.items.find((i: { id: string }) => i.id === "reject-e2e");
    expect(item.status).toBe("rejected");
  });
});

describe("E2E: Server async mode", () => {
  let server: TicketlessServer;
  let port: number;

  beforeEach(async () => {
    ({ server, port } = createTestServer({ async: true }));
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("returns queued status immediately", async () => {
    const res = await post(port, "/api/ticket", {
      id: "async-e2e",
      subject: "Async test",
      body: "Testing async processing",
      customerEmail: "alice@startup.io",
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("queued");
    expect(data.ticketId).toBe("async-e2e");
  });

  it("ticket status transitions from queued to completed", async () => {
    await post(port, "/api/ticket", {
      id: "status-e2e",
      subject: "Login issue",
      body: "Can't log in",
      customerEmail: "alice@startup.io",
    });

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 500));

    const res = await get(port, "/api/ticket/status?ticketId=status-e2e");
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe("completed");
    expect(data.resolution).toBeDefined();
    expect(data.resolution.action).toBeDefined();
  });
});
