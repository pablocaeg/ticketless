import { describe, it, expect, beforeEach } from "vitest";
import { TicketQueue } from "./queue.js";
import { Agent } from "./agent.js";
import { InMemoryAuditLog } from "./audit.js";
import { ConfidenceGate } from "./gate.js";
import type { LLMProvider } from "./interfaces.js";
import type { Ticket, LLMMessage, LLMResponse } from "../types.js";

class StubLLM implements LLMProvider {
  readonly name = "stub";
  async chat(_messages: LLMMessage[]): Promise<LLMResponse> {
    return {
      content: JSON.stringify({
        reasoning: "Quick",
        steps: [],
        answer: "Done",
        confidence: 0.9,
        needsMoreInvestigation: false,
      }),
    };
  }
}

function mockTicket(id: string): Ticket {
  return {
    id,
    source: "test",
    subject: "Test",
    body: "Test body",
    customerEmail: "test@example.com",
    metadata: {},
    createdAt: new Date(),
  };
}

describe("TicketQueue", () => {
  let queue: TicketQueue;

  beforeEach(() => {
    const agent = new Agent(new StubLLM(), new InMemoryAuditLog(), new ConfidenceGate(0.5), {
      confidenceThreshold: 0.5,
      maxToolCalls: 5,
      maxInvestigationRounds: 2,
      escalationRules: [],
    });
    queue = new TicketQueue(agent, { concurrency: 2 });
  });

  it("submits and processes a ticket", async () => {
    const id = queue.submit(mockTicket("q-1"));
    expect(id).toBe("q-1");

    await new Promise((r) => setTimeout(r, 100));

    const status = queue.getStatus("q-1");
    expect(status).toBeDefined();
    expect(status!.status).toBe("completed");
    expect(status!.resolution).not.toBeNull();
  });

  it("processes multiple tickets concurrently", async () => {
    queue.submit(mockTicket("q-2"));
    queue.submit(mockTicket("q-3"));
    queue.submit(mockTicket("q-4"));

    await new Promise((r) => setTimeout(r, 200));

    const statuses = queue.getAllStatuses();
    expect(statuses.every((s) => s.status === "completed")).toBe(true);
  });

  it("calls onResolution callback", async () => {
    const resolutions: string[] = [];
    const agent = new Agent(new StubLLM(), new InMemoryAuditLog(), new ConfidenceGate(0.5), {
      confidenceThreshold: 0.5,
      maxToolCalls: 5,
      maxInvestigationRounds: 2,
      escalationRules: [],
    });
    const q = new TicketQueue(agent, {
      concurrency: 1,
      onResolution: (ticket) => {
        resolutions.push(ticket.id);
      },
    });

    q.submit(mockTicket("cb-1"));
    await new Promise((r) => setTimeout(r, 100));

    expect(resolutions).toContain("cb-1");
  });
});
