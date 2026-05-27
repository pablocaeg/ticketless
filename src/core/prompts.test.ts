import { describe, it, expect } from "vitest";
import { buildPlanPrompt, buildSynthesisPrompt, buildReplyPrompt } from "./prompts.js";
import type { Ticket, ToolDefinition, ToolResult, AgentSynthesis } from "../types.js";

function mockTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "t-001",
    source: "chat",
    subject: "Test ticket",
    body: "Hello, I need help",
    customerEmail: "alice@test.com",
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}

const mockTool: ToolDefinition = {
  name: "user_lookup",
  description: "Look up a user",
  parameters: { id: { type: "string", description: "User ID", required: true } },
};

describe("buildPlanPrompt", () => {
  it("instructs to skip tools for greetings", () => {
    const messages = buildPlanPrompt(mockTicket(), [mockTool], []);
    const system = messages.find((m) => m.role === "system")!.content;
    expect(system).toContain("greeting");
    expect(system).toContain("EMPTY steps array");
  });

  it("instructs to use names not numeric IDs", () => {
    const messages = buildPlanPrompt(mockTicket(), [mockTool], []);
    const system = messages.find((m) => m.role === "system")!.content;
    expect(system).toContain("name");
    expect(system).toContain("not numeric ID");
  });

  it("includes prior findings when provided", () => {
    const finding: ToolResult = {
      tool: "user_lookup",
      args: { id: "1" },
      result: { name: "Alice" },
      durationMs: 5,
    };
    const messages = buildPlanPrompt(mockTicket(), [mockTool], [finding]);
    const user = messages.find((m) => m.role === "user")!.content;
    expect(user).toContain("Prior Investigation");
    expect(user).toContain("Alice");
  });

  it("includes customer ID when available", () => {
    const messages = buildPlanPrompt(
      mockTicket({ customerId: "usr_123" }),
      [mockTool],
      []
    );
    const user = messages.find((m) => m.role === "user")!.content;
    expect(user).toContain("usr_123");
  });
});

describe("buildReplyPrompt", () => {
  it("instructs to reply in the customer's language", () => {
    const synthesis: AgentSynthesis = {
      answer: "Account is locked",
      confidence: 0.9,
      reasoning: "Found lockout",
      needsMoreInvestigation: false,
    };
    const messages = buildReplyPrompt(mockTicket(), synthesis);
    const system = messages.find((m) => m.role === "system")!.content;
    expect(system).toContain("same language");
  });

  it("includes synthesis answer in the prompt", () => {
    const synthesis: AgentSynthesis = {
      answer: "The shift swap violates rest rules",
      confidence: 0.85,
      reasoning: "Only 4h gap between shifts",
      needsMoreInvestigation: false,
    };
    const messages = buildReplyPrompt(mockTicket(), synthesis);
    const user = messages.find((m) => m.role === "user")!.content;
    expect(user).toContain("shift swap violates rest rules");
    expect(user).toContain("4h gap");
  });
});

describe("buildSynthesisPrompt", () => {
  it("includes tool results in findings", () => {
    const findings: ToolResult[] = [
      { tool: "shift_comply", args: { action: "validate" }, result: { result: "fail" }, durationMs: 10 },
    ];
    const messages = buildSynthesisPrompt(mockTicket(), findings);
    const user = messages.find((m) => m.role === "user")!.content;
    expect(user).toContain("shift_comply");
    expect(user).toContain("fail");
  });

  it("shows errors for failed tool calls", () => {
    const findings: ToolResult[] = [
      { tool: "user_lookup", args: { id: "1" }, result: null, durationMs: 5, error: "Connection refused" },
    ];
    const messages = buildSynthesisPrompt(mockTicket(), findings);
    const user = messages.find((m) => m.role === "user")!.content;
    expect(user).toContain("ERROR");
    expect(user).toContain("Connection refused");
  });
});
