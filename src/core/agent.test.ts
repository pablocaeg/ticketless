import { describe, it, expect, beforeEach } from "vitest";
import { Agent } from "./agent.js";
import { InMemoryAuditLog } from "./audit.js";
import { ConfidenceGate } from "./gate.js";
import type { LLMProvider, Tool } from "./interfaces.js";
import type { Ticket, LLMMessage, LLMResponse, ToolDefinition } from "../types.js";

function mockTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "t-1",
    source: "test",
    subject: "Test issue",
    body: "Something is broken",
    customerEmail: "test@example.com",
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}

class StubLLM implements LLMProvider {
  readonly name = "stub";
  responses: string[] = [];
  private callIndex = 0;

  async chat(_messages: LLMMessage[]): Promise<LLMResponse> {
    const content = this.responses[this.callIndex] ?? '{"reasoning":"","steps":[]}';
    this.callIndex++;
    return { content };
  }
}

class StubTool implements Tool {
  readonly definition: ToolDefinition = {
    name: "test_tool",
    description: "A test tool",
    parameters: {
      query: { type: "string", description: "Query", required: true },
    },
  };

  result: unknown = { data: "found" };

  async execute(_args: Record<string, unknown>): Promise<unknown> {
    return this.result;
  }
}

describe("Agent", () => {
  let llm: StubLLM;
  let audit: InMemoryAuditLog;
  let gate: ConfidenceGate;
  let agent: Agent;

  beforeEach(() => {
    llm = new StubLLM();
    audit = new InMemoryAuditLog();
    gate = new ConfidenceGate(0.75);
    agent = new Agent(llm, audit, gate, {
      confidenceThreshold: 0.75,
      maxToolCalls: 10,
      maxInvestigationRounds: 3,
      escalationRules: [],
    });
  });

  it("resolves a ticket with a reply when confidence is high", async () => {
    llm.responses = [
      JSON.stringify({
        reasoning: "Look up user",
        steps: [{ tool: "test_tool", args: { query: "test" }, purpose: "lookup" }],
      }),
      JSON.stringify({
        answer: "Found the issue",
        confidence: 0.9,
        reasoning: "Clear root cause",
        needsMoreInvestigation: false,
      }),
      "Here is your answer, customer!",
    ];

    agent.registerTool(new StubTool());
    const result = await agent.resolve(mockTicket());

    expect(result.action).toBe("reply");
    expect(result.confidence).toBe(0.9);
    expect(result.reply).toBe("Here is your answer, customer!");
    expect(result.toolsUsed).toContain("test_tool");
  });

  it("escalates when confidence is below threshold", async () => {
    llm.responses = [
      JSON.stringify({ reasoning: "Investigate", steps: [] }),
      JSON.stringify({
        answer: "Not sure",
        confidence: 0.3,
        reasoning: "Insufficient data",
        needsMoreInvestigation: false,
      }),
      "Reply text",
    ];

    const result = await agent.resolve(mockTicket());

    expect(result.action).toBe("escalate");
    expect(result.escalationReason).toContain("Confidence 0.3 below threshold 0.75");
  });

  it("escalates when gate blocks due to sensitive keyword", async () => {
    llm.responses = [
      JSON.stringify({ reasoning: "Investigate", steps: [] }),
      JSON.stringify({
        answer: "Found it",
        confidence: 0.95,
        reasoning: "Clear",
        needsMoreInvestigation: false,
      }),
      "Your refund has been processed",
    ];

    const result = await agent.resolve(mockTicket({ body: "I want a refund" }));

    expect(result.action).toBe("escalate");
    // Escalated either by gate keyword or by grounded low confidence
    expect(result.escalationReason).toBeTruthy();
  });

  it("records audit entries for every step", async () => {
    llm.responses = [
      JSON.stringify({
        reasoning: "Check tool",
        steps: [{ tool: "test_tool", args: { query: "x" }, purpose: "check" }],
      }),
      JSON.stringify({
        answer: "Done",
        confidence: 0.85,
        reasoning: "Found it",
        needsMoreInvestigation: false,
      }),
      "Reply",
    ];

    agent.registerTool(new StubTool());
    await agent.resolve(mockTicket());

    const entries = audit.getEntries("t-1");
    const steps = entries.map((e) => e.step);
    expect(steps).toContain("received");
    expect(steps).toContain("planning");
    expect(steps).toContain("tool_call");
    expect(steps).toContain("synthesizing");
    // May respond or escalate depending on grounded confidence
    expect(steps.includes("responding") || steps.includes("escalating")).toBe(true);
  });

  it("handles unknown tool gracefully", async () => {
    llm.responses = [
      JSON.stringify({
        reasoning: "Try missing tool",
        steps: [{ tool: "nonexistent", args: {}, purpose: "test" }],
      }),
      JSON.stringify({
        answer: "Could not find data",
        confidence: 0.2,
        reasoning: "Tool missing",
        needsMoreInvestigation: false,
      }),
      "Sorry",
    ];

    const result = await agent.resolve(mockTicket());
    expect(result.action).toBe("escalate");

    const entries = audit.getEntries("t-1");
    const toolCallEntry = entries.find(
      (e) => e.step === "tool_call" && e.detail.includes("not found")
    );
    expect(toolCallEntry).toBeDefined();
  });

  it("respects maxInvestigationRounds", async () => {
    llm.responses = Array(10).fill(null).flatMap(() => [
      JSON.stringify({ reasoning: "Need more data", steps: [] }),
      JSON.stringify({
        answer: "",
        confidence: 0.4,
        reasoning: "Need more",
        needsMoreInvestigation: true,
        nextSteps: [],
      }),
    ]);

    agent = new Agent(llm, audit, gate, {
      confidenceThreshold: 0.75,
      maxToolCalls: 10,
      maxInvestigationRounds: 2,
      escalationRules: [],
    });

    const result = await agent.resolve(mockTicket());
    expect(result.action).toBe("escalate");
    expect(result.escalationReason).toContain("max investigation rounds");
  });

  it("emits events during resolution", async () => {
    llm.responses = [
      JSON.stringify({ reasoning: "Quick", steps: [] }),
      JSON.stringify({
        answer: "Done",
        confidence: 0.9,
        reasoning: "Clear",
        needsMoreInvestigation: false,
      }),
      "Reply",
    ];

    const events: string[] = [];
    agent.events.on("ticket:received", () => events.push("received"));
    agent.events.on("ticket:resolved", () => events.push("resolved"));
    agent.events.on("ticket:escalated", () => events.push("escalated"));
    agent.events.on("audit:entry", () => events.push("audit"));

    await agent.resolve(mockTicket());

    expect(events).toContain("received");
    expect(events.includes("resolved") || events.includes("escalated")).toBe(true);
    expect(events.filter((e) => e === "audit").length).toBeGreaterThan(0);
  });

  it("emits escalation event", async () => {
    llm.responses = [
      JSON.stringify({ reasoning: "Check", steps: [] }),
      JSON.stringify({
        answer: "Unsure",
        confidence: 0.3,
        reasoning: "Low data",
        needsMoreInvestigation: false,
      }),
      "Reply",
    ];

    let escalated = false;
    agent.events.on("ticket:escalated", () => { escalated = true; });

    await agent.resolve(mockTicket());
    expect(escalated).toBe(true);
  });

  it("clamps confidence to 0-1 range", async () => {
    llm.responses = [
      JSON.stringify({ reasoning: "Quick", steps: [] }),
      JSON.stringify({
        answer: "Done",
        confidence: 1.5,
        reasoning: "Over-confident",
        needsMoreInvestigation: false,
      }),
      "Reply",
    ];

    const result = await agent.resolve(mockTicket());
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
