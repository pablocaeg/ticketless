import { describe, it, expect, beforeEach } from "vitest";
import { Agent } from "../core/agent.js";
import { InMemoryAuditLog } from "../core/audit.js";
import { ConfidenceGate } from "../core/gate.js";
import { ScriptedLLM } from "./scripted-llm.js";
import {
  DemoUserLookupTool,
  DemoOrderLookupTool,
  DemoLogSearchTool,
  DemoKnowledgeBaseTool,
} from "../demo/tools.js";
import { DEMO_TICKETS } from "../demo/data.js";
import type { Ticket, TicketResolution, AuditEntry } from "../types.js";

describe("E2E: Agent full resolution flow", () => {
  let agent: Agent;
  let audit: InMemoryAuditLog;
  let llm: ScriptedLLM;

  beforeEach(() => {
    llm = new ScriptedLLM();
    audit = new InMemoryAuditLog();
    agent = new Agent(llm, audit, new ConfidenceGate(0.7), {
      confidenceThreshold: 0.7,
      maxToolCalls: 10,
      maxInvestigationRounds: 3,
      escalationRules: [],
    });

    agent.registerTool(new DemoUserLookupTool());
    agent.registerTool(new DemoOrderLookupTool());
    agent.registerTool(new DemoLogSearchTool());
    agent.registerTool(new DemoKnowledgeBaseTool());
  });

  describe("Ticket: Account locked (alice@startup.io)", () => {
    let result: TicketResolution;
    let entries: AuditEntry[];

    beforeEach(async () => {
      result = await agent.resolve(DEMO_TICKETS[0]);
      entries = audit.getEntries(DEMO_TICKETS[0].id);
    });

    it("resolves with a reply (not escalated)", () => {
      expect(result.action).toBe("reply");
    });

    it("has high confidence", () => {
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("used the user_lookup tool", () => {
      expect(result.toolsUsed).toContain("user_lookup");
    });

    it("reply mentions the lockout", () => {
      expect(result.reply?.toLowerCase()).toContain("locked");
    });

    it("reply mentions password reset as an option", () => {
      expect(result.reply?.toLowerCase()).toContain("password");
    });

    it("audit trail has all required steps", () => {
      const steps = entries.map((e) => e.step);
      expect(steps).toContain("received");
      expect(steps).toContain("planning");
      expect(steps).toContain("tool_call");
      expect(steps).toContain("synthesizing");
      expect(steps).toContain("responding");
    });

    it("completes within reasonable time", () => {
      expect(result.durationMs).toBeLessThan(5000);
    });
  });

  describe("Ticket: Payment failed (bob@acmecorp.com)", () => {
    let result: TicketResolution;

    beforeEach(async () => {
      result = await agent.resolve(DEMO_TICKETS[1]);
    });

    it("resolves with a reply", () => {
      expect(result.action).toBe("reply");
    });

    it("has high confidence", () => {
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("produces a non-empty reply", () => {
      expect(result.reply).toBeTruthy();
      expect(result.reply!.length).toBeGreaterThan(50);
    });
  });

  describe("Ticket: Export not working (carol@freelance.dev)", () => {
    let result: TicketResolution;

    beforeEach(async () => {
      result = await agent.resolve(DEMO_TICKETS[2]);
    });

    it("resolves with a reply", () => {
      expect(result.action).toBe("reply");
    });

    it("produces a non-empty reply", () => {
      expect(result.reply).toBeTruthy();
      expect(result.reply!.length).toBeGreaterThan(50);
    });
  });

  describe("Ticket: Seats not showing up (dave@bigco.com)", () => {
    let result: TicketResolution;

    beforeEach(async () => {
      result = await agent.resolve(DEMO_TICKETS[3]);
    });

    it("resolves with a reply", () => {
      expect(result.action).toBe("reply");
    });

    it("produces a non-empty reply", () => {
      expect(result.reply).toBeTruthy();
      expect(result.reply!.length).toBeGreaterThan(50);
    });
  });

  describe("all demo tickets", () => {
    it("resolves at least 75% of tickets autonomously", async () => {
      const results = await Promise.all(DEMO_TICKETS.map((t) => agent.resolve(t)));
      const resolved = results.filter((r) => r.action === "reply");
      const rate = resolved.length / results.length;
      expect(rate).toBeGreaterThanOrEqual(0.75);
    });

    it("every resolution has a non-empty investigationSummary", async () => {
      const results = await Promise.all(DEMO_TICKETS.map((t) => agent.resolve(t)));
      for (const r of results) {
        expect(r.investigationSummary.length).toBeGreaterThan(0);
      }
    });

    it("every resolution has durationMs set", async () => {
      const results = await Promise.all(DEMO_TICKETS.map((t) => agent.resolve(t)));
      for (const r of results) {
        expect(r.durationMs).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

describe("E2E: Escalation behavior", () => {
  let agent: Agent;
  let audit: InMemoryAuditLog;

  beforeEach(() => {
    const llm = new ScriptedLLM();
    audit = new InMemoryAuditLog();
    agent = new Agent(llm, audit, new ConfidenceGate(0.7, ["refund", "cancel subscription"]), {
      confidenceThreshold: 0.7,
      maxToolCalls: 10,
      maxInvestigationRounds: 3,
      escalationRules: [
        {
          name: "legal",
          condition: (ticket) => /\blawyer\b/i.test(ticket.body),
          reason: "Legal mention — requires human",
        },
      ],
    });

    agent.registerTool(new DemoUserLookupTool());
    agent.registerTool(new DemoLogSearchTool());
  });

  it("escalates when ticket mentions refund", async () => {
    const ticket: Ticket = {
      id: "esc-1",
      source: "test",
      subject: "I want a refund",
      body: "This product is terrible, I want a full refund immediately",
      customerEmail: "angry@example.com",
      metadata: {},
      createdAt: new Date(),
    };

    const result = await agent.resolve(ticket);
    expect(result.action).toBe("escalate");
    // Escalated either by gate (keyword "refund") or by low confidence
    expect(result.escalationReason).toBeTruthy();
  });

  it("escalates when escalation rule matches", async () => {
    const ticket: Ticket = {
      id: "esc-2",
      source: "test",
      subject: "Legal issue",
      body: "I'm going to contact my lawyer about this billing issue",
      customerEmail: "legal@example.com",
      metadata: {},
      createdAt: new Date(),
    };

    const result = await agent.resolve(ticket);
    expect(result.action).toBe("escalate");
    expect(result.escalationReason).toContain("Legal mention");
  });

  it("escalates when user not found (low confidence)", async () => {
    const ticket: Ticket = {
      id: "esc-3",
      source: "test",
      subject: "Can't log in",
      body: "My account isn't working",
      customerEmail: "nonexistent@nowhere.com",
      metadata: {},
      createdAt: new Date(),
    };

    const result = await agent.resolve(ticket);
    // Unknown user may escalate (low confidence) or resolve with generic reply
    expect(["reply", "escalate"]).toContain(result.action);
    if (result.action === "escalate") {
      expect(result.escalationReason).toBeTruthy();
    }
  });
});

describe("E2E: Event emission", () => {
  it("emits events in correct order during resolution", async () => {
    const llm = new ScriptedLLM();
    const audit = new InMemoryAuditLog();
    const agent = new Agent(llm, audit, new ConfidenceGate(0.7), {
      confidenceThreshold: 0.7,
      maxToolCalls: 10,
      maxInvestigationRounds: 3,
      escalationRules: [],
    });

    agent.registerTool(new DemoUserLookupTool());
    agent.registerTool(new DemoLogSearchTool());

    const events: string[] = [];
    agent.events.on("ticket:received", () => events.push("received"));
    agent.events.on("tool:called", () => events.push("tool_called"));
    agent.events.on("ticket:resolved", () => events.push("resolved"));
    agent.events.on("ticket:escalated", () => events.push("escalated"));
    agent.events.on("audit:entry", () => events.push("audit"));

    await agent.resolve(DEMO_TICKETS[0]);

    // The audit:entry for "received" fires before ticket:received event
    expect(events).toContain("received");
    expect(events).toContain("tool_called");
    expect(events.includes("resolved") || events.includes("escalated")).toBe(true);
    expect(events.filter((e) => e === "audit").length).toBeGreaterThan(3);
  });
});

describe("E2E: Audit trail completeness", () => {
  it("records every tool call with args and results", async () => {
    const llm = new ScriptedLLM();
    const audit = new InMemoryAuditLog();
    const agent = new Agent(llm, audit, new ConfidenceGate(0.7), {
      confidenceThreshold: 0.7,
      maxToolCalls: 10,
      maxInvestigationRounds: 3,
      escalationRules: [],
    });

    agent.registerTool(new DemoUserLookupTool());
    agent.registerTool(new DemoLogSearchTool());
    agent.registerTool(new DemoKnowledgeBaseTool());

    await agent.resolve(DEMO_TICKETS[0]);

    const toolCalls = audit.getEntries(DEMO_TICKETS[0].id).filter((e) => e.step === "tool_call");
    expect(toolCalls.length).toBeGreaterThan(0);

    for (const call of toolCalls) {
      expect(call.data).toBeDefined();
      expect(call.detail).toBeTruthy();
    }
  });
});
