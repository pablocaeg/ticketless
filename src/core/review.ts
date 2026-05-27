import type { Ticket, TicketResolution } from "../types.js";
import type { AuditLog, TicketSource } from "./interfaces.js";

export interface ReviewItem {
  id: string;
  ticket: Ticket;
  resolution: TicketResolution;
  status: "pending" | "approved" | "rejected" | "edited";
  reviewedAt: Date | null;
  editedReply: string | null;
  reviewerNote: string | null;
  createdAt: Date;
}

export class ReviewQueue {
  private items: Map<string, ReviewItem> = new Map();
  private sources: Map<string, TicketSource> = new Map();

  constructor(private audit: AuditLog) {}

  registerSource(source: TicketSource): void {
    this.sources.set(source.name, source);
  }

  addForReview(ticket: Ticket, resolution: TicketResolution): string {
    const item: ReviewItem = {
      id: ticket.id,
      ticket,
      resolution,
      status: "pending",
      reviewedAt: null,
      editedReply: null,
      reviewerNote: null,
      createdAt: new Date(),
    };

    this.items.set(ticket.id, item);

    this.audit.append({
      ticketId: ticket.id,
      timestamp: new Date(),
      step: "escalating",
      detail: "Added to human review queue",
      data: { reason: resolution.escalationReason },
    });

    return ticket.id;
  }

  getPending(): ReviewItem[] {
    return [...this.items.values()].filter((i) => i.status === "pending");
  }

  getAll(): ReviewItem[] {
    return [...this.items.values()];
  }

  get(ticketId: string): ReviewItem | undefined {
    return this.items.get(ticketId);
  }

  async approve(ticketId: string, reviewerNote?: string): Promise<void> {
    const item = this.items.get(ticketId);
    if (!item) throw new Error(`Review item not found: ${ticketId}`);
    if (item.status !== "pending") throw new Error(`Item already reviewed: ${item.status}`);

    item.status = "approved";
    item.reviewedAt = new Date();
    item.reviewerNote = reviewerNote ?? null;

    const reply = item.resolution.reply;
    if (reply) {
      const source = this.sources.get(item.ticket.source);
      if (source) {
        await source.reply(ticketId, reply);
        await source.markResolved(ticketId);
      }
    }

    this.audit.append({
      ticketId,
      timestamp: new Date(),
      step: "responding",
      detail: `Human approved agent reply${reviewerNote ? `: ${reviewerNote}` : ""}`,
    });
  }

  async approveWithEdit(ticketId: string, editedReply: string, reviewerNote?: string): Promise<void> {
    const item = this.items.get(ticketId);
    if (!item) throw new Error(`Review item not found: ${ticketId}`);
    if (item.status !== "pending") throw new Error(`Item already reviewed: ${item.status}`);

    item.status = "edited";
    item.reviewedAt = new Date();
    item.editedReply = editedReply;
    item.reviewerNote = reviewerNote ?? null;

    const source = this.sources.get(item.ticket.source);
    if (source) {
      await source.reply(ticketId, editedReply);
      await source.markResolved(ticketId);
    }

    this.audit.append({
      ticketId,
      timestamp: new Date(),
      step: "responding",
      detail: `Human edited and approved reply${reviewerNote ? `: ${reviewerNote}` : ""}`,
      data: { original: item.resolution.reply, edited: editedReply },
    });
  }

  async reject(ticketId: string, reason: string): Promise<void> {
    const item = this.items.get(ticketId);
    if (!item) throw new Error(`Review item not found: ${ticketId}`);
    if (item.status !== "pending") throw new Error(`Item already reviewed: ${item.status}`);

    item.status = "rejected";
    item.reviewedAt = new Date();
    item.reviewerNote = reason;

    this.audit.append({
      ticketId,
      timestamp: new Date(),
      step: "escalating",
      detail: `Human rejected agent reply: ${reason}`,
    });
  }
}
