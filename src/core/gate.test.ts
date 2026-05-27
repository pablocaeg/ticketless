import { describe, it, expect } from "vitest";
import { ConfidenceGate } from "./gate.js";
import type { Ticket, TicketResolution } from "../types.js";

function mockTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "t-1",
    source: "test",
    subject: "Test",
    body: "Body",
    customerEmail: "test@example.com",
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  };
}

function mockResolution(overrides: Partial<TicketResolution> = {}): TicketResolution {
  return {
    ticketId: "t-1",
    action: "reply",
    reply: "Hello",
    confidence: 0.9,
    investigationSummary: "Found it",
    toolsUsed: [],
    durationMs: 100,
    ...overrides,
  };
}

describe("ConfidenceGate", () => {
  it("approves when confidence is above threshold", () => {
    const gate = new ConfidenceGate(0.75);
    const result = gate.shouldAutoReply(mockTicket(), mockResolution({ confidence: 0.85 }));
    expect(result.approved).toBe(true);
  });

  it("rejects when confidence is below threshold", () => {
    const gate = new ConfidenceGate(0.75);
    const result = gate.shouldAutoReply(mockTicket(), mockResolution({ confidence: 0.5 }));
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("Confidence");
  });

  it("rejects when ticket contains sensitive keywords", () => {
    const gate = new ConfidenceGate(0.75);
    const result = gate.shouldAutoReply(
      mockTicket({ body: "I want a refund immediately" }),
      mockResolution()
    );
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("refund");
  });

  it("uses custom blocked keywords", () => {
    const gate = new ConfidenceGate(0.75, ["urgent", "downtime"]);
    const result = gate.shouldAutoReply(
      mockTicket({ subject: "Critical downtime" }),
      mockResolution()
    );
    expect(result.approved).toBe(false);
    expect(result.reason).toContain("downtime");
  });
});
