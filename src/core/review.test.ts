import { describe, it, expect, beforeEach } from "vitest";
import { ReviewQueue } from "./review.js";
import { InMemoryAuditLog } from "./audit.js";
import type { Ticket, TicketResolution } from "../types.js";

function mockTicket(id: string): Ticket {
  return {
    id,
    source: "test",
    subject: "Test ticket",
    body: "Test body",
    customerEmail: "test@example.com",
    metadata: {},
    createdAt: new Date(),
  };
}

function mockResolution(ticketId: string): TicketResolution {
  return {
    ticketId,
    action: "escalate",
    escalationReason: "Low confidence",
    confidence: 0.5,
    reply: "Draft reply to customer",
    investigationSummary: "Investigated",
    toolsUsed: ["user_lookup"],
    durationMs: 1000,
  };
}

describe("ReviewQueue", () => {
  let review: ReviewQueue;
  let audit: InMemoryAuditLog;

  beforeEach(() => {
    audit = new InMemoryAuditLog();
    review = new ReviewQueue(audit);
  });

  it("adds items for review", () => {
    review.addForReview(mockTicket("r-1"), mockResolution("r-1"));
    expect(review.getPending()).toHaveLength(1);
    expect(review.getPending()[0].id).toBe("r-1");
  });

  it("approves a review item", async () => {
    review.addForReview(mockTicket("r-2"), mockResolution("r-2"));
    await review.approve("r-2", "Looks good");

    const item = review.get("r-2");
    expect(item!.status).toBe("approved");
    expect(item!.reviewerNote).toBe("Looks good");
    expect(review.getPending()).toHaveLength(0);
  });

  it("approves with edited reply", async () => {
    review.addForReview(mockTicket("r-3"), mockResolution("r-3"));
    await review.approveWithEdit("r-3", "Better reply", "Fixed wording");

    const item = review.get("r-3");
    expect(item!.status).toBe("edited");
    expect(item!.editedReply).toBe("Better reply");
  });

  it("rejects a review item", async () => {
    review.addForReview(mockTicket("r-4"), mockResolution("r-4"));
    await review.reject("r-4", "Wrong answer");

    const item = review.get("r-4");
    expect(item!.status).toBe("rejected");
    expect(item!.reviewerNote).toBe("Wrong answer");
  });

  it("throws when approving non-existent item", async () => {
    await expect(review.approve("nonexistent")).rejects.toThrow("not found");
  });

  it("throws when reviewing already-reviewed item", async () => {
    review.addForReview(mockTicket("r-5"), mockResolution("r-5"));
    await review.approve("r-5");
    await expect(review.approve("r-5")).rejects.toThrow("already reviewed");
  });

  it("logs audit entries for review actions", async () => {
    review.addForReview(mockTicket("r-6"), mockResolution("r-6"));
    await review.approve("r-6");

    const entries = audit.getEntries("r-6");
    expect(entries.some((e) => e.detail.includes("human review queue"))).toBe(true);
    expect(entries.some((e) => e.detail.includes("Human approved"))).toBe(true);
  });
});
