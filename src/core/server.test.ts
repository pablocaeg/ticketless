import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TicketlessServer } from "./server.js";
import { Agent } from "./agent.js";
import { InMemoryAuditLog } from "./audit.js";
import { ConfidenceGate } from "./gate.js";
import type { LLMProvider } from "./interfaces.js";
import type { LLMMessage, LLMResponse } from "../types.js";

class StubLLM implements LLMProvider {
  readonly name = "stub";
  async chat(_messages: LLMMessage[]): Promise<LLMResponse> {
    return {
      content: JSON.stringify({
        reasoning: "Quick check",
        steps: [],
        answer: "All good",
        confidence: 0.9,
        needsMoreInvestigation: false,
      }),
    };
  }
}

describe("TicketlessServer", () => {
  let server: TicketlessServer;
  let port: number;

  beforeEach(async () => {
    port = 30000 + Math.floor(Math.random() * 10000);
    const llm = new StubLLM();
    const audit = new InMemoryAuditLog();
    const gate = new ConfidenceGate(0.5);
    const agent = new Agent(llm, audit, gate, {
      confidenceThreshold: 0.5,
      maxToolCalls: 5,
      maxInvestigationRounds: 2,
      escalationRules: [],
    });

    server = new TicketlessServer({ port, agent, audit, sources: [] });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("responds to health check", async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`http://localhost:${port}/unknown`);
    expect(res.status).toBe(404);
  });

  it("submits a ticket via API", async () => {
    const res = await fetch(`http://localhost:${port}/api/ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "Test ticket",
        body: "Something broke",
        customerEmail: "test@example.com",
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ticketId).toBeDefined();
    expect(data.action).toBeDefined();
  });

  it("returns audit entries", async () => {
    await fetch(`http://localhost:${port}/api/ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "audit-test",
        subject: "Audit test",
        body: "Testing audit",
        customerEmail: "test@example.com",
      }),
    });

    const res = await fetch(`http://localhost:${port}/api/audit?ticketId=audit-test`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries.length).toBeGreaterThan(0);
    expect(data.entries[0].ticketId).toBe("audit-test");
  });

  it("returns resolution by ticketId", async () => {
    await fetch(`http://localhost:${port}/api/ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "res-test",
        subject: "Resolution test",
        body: "Testing resolution",
        customerEmail: "test@example.com",
      }),
    });

    const res = await fetch(`http://localhost:${port}/api/resolution?ticketId=res-test`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ticketId).toBe("res-test");
  });

  it("returns 404 for unknown resolution", async () => {
    const res = await fetch(`http://localhost:${port}/api/resolution?ticketId=nonexistent`);
    expect(res.status).toBe(404);
  });

  it("requires ticketId for resolution endpoint", async () => {
    const res = await fetch(`http://localhost:${port}/api/resolution`);
    expect(res.status).toBe(400);
  });
});
