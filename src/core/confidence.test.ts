import { describe, it, expect } from "vitest";
import { groundConfidence } from "./confidence.js";
import type { AgentSynthesis, ToolResult } from "../types.js";

function mockSynthesis(overrides: Partial<AgentSynthesis> = {}): AgentSynthesis {
  return {
    answer: "The user's account is locked due to failed login attempts",
    confidence: 0.9,
    reasoning: "Clear root cause found",
    needsMoreInvestigation: false,
    ...overrides,
  };
}

function mockToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    tool: "user_lookup",
    args: { email: "test@example.com" },
    result: { found: true, status: "active" },
    durationMs: 10,
    ...overrides,
  };
}

describe("groundConfidence", () => {
  it("preserves confidence when tools returned useful data", () => {
    const { adjustedConfidence } = groundConfidence(
      mockSynthesis({ confidence: 0.9 }),
      [mockToolResult()]
    );
    expect(adjustedConfidence).toBe(0.9);
  });

  it("caps confidence when no tools were called and confidence is high", () => {
    const { adjustedConfidence, checks } = groundConfidence(
      mockSynthesis({ confidence: 0.95 }),
      []
    );
    expect(adjustedConfidence).toBeLessThanOrEqual(0.7);
    expect(checks.find((c) => c.name === "no_investigation")?.passed).toBe(false);
  });

  it("allows moderate confidence without tools for conversational messages", () => {
    const { adjustedConfidence } = groundConfidence(
      mockSynthesis({ confidence: 0.7, answer: "Hi! Let me know if you need help with anything." }),
      []
    );
    expect(adjustedConfidence).toBe(0.7);
  });

  it("caps confidence when all tools errored", () => {
    const { adjustedConfidence, checks } = groundConfidence(
      mockSynthesis({ confidence: 0.85 }),
      [mockToolResult({ error: "Connection refused", result: null })]
    );
    expect(adjustedConfidence).toBeLessThanOrEqual(0.3);
    expect(checks.find((c) => c.name === "all_tools_failed")?.passed).toBe(false);
  });

  it("caps confidence when all results are empty/not-found", () => {
    const { adjustedConfidence, checks } = groundConfidence(
      mockSynthesis({ confidence: 0.88 }),
      [
        mockToolResult({ result: { found: false } }),
        mockToolResult({ tool: "order_lookup", result: { count: 0, orders: [] } }),
      ]
    );
    expect(adjustedConfidence).toBeLessThanOrEqual(0.35);
    expect(checks.find((c) => c.name === "no_data_found")?.passed).toBe(false);
  });

  it("caps confidence when synthesis answer is empty", () => {
    const { adjustedConfidence, checks } = groundConfidence(
      mockSynthesis({ confidence: 0.9, answer: "" }),
      [mockToolResult()]
    );
    expect(adjustedConfidence).toBeLessThanOrEqual(0.3);
    expect(checks.find((c) => c.name === "empty_answer")?.passed).toBe(false);
  });

  it("applies overconfidence penalty for high confidence with minimal investigation", () => {
    const { adjustedConfidence, checks } = groundConfidence(
      mockSynthesis({ confidence: 0.95 }),
      [mockToolResult()]
    );
    expect(adjustedConfidence).toBeLessThan(0.95);
    expect(checks.find((c) => c.name === "overconfidence_penalty")).toBeDefined();
  });

  it("does not penalize high confidence with thorough investigation", () => {
    const { adjustedConfidence } = groundConfidence(
      mockSynthesis({ confidence: 0.92 }),
      [mockToolResult(), mockToolResult({ tool: "search_logs" }), mockToolResult({ tool: "search_docs" })]
    );
    expect(adjustedConfidence).toBe(0.92);
  });

  it("handles mixed results — some found, some empty", () => {
    const { adjustedConfidence } = groundConfidence(
      mockSynthesis({ confidence: 0.85 }),
      [
        mockToolResult({ result: { found: true, name: "Alice" } }),
        mockToolResult({ tool: "order_lookup", result: { count: 0, orders: [] } }),
      ]
    );
    // Should not cap at 0.35 because not ALL results are empty
    expect(adjustedConfidence).toBe(0.85);
  });

  it("handles rowCount: 0 as empty", () => {
    const { adjustedConfidence } = groundConfidence(
      mockSynthesis({ confidence: 0.8 }),
      [mockToolResult({ result: { rowCount: 0, rows: [] } })]
    );
    expect(adjustedConfidence).toBeLessThanOrEqual(0.35);
  });

  it("clamps to 0-1 range", () => {
    const { adjustedConfidence } = groundConfidence(
      mockSynthesis({ confidence: 1.5 }),
      [mockToolResult(), mockToolResult()]
    );
    expect(adjustedConfidence).toBeLessThanOrEqual(1);
    expect(adjustedConfidence).toBeGreaterThanOrEqual(0);
  });
});
