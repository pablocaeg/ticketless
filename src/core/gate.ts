import type { Ticket, TicketResolution } from "../types.js";
import type { ResponseGate } from "./interfaces.js";

export class ConfidenceGate implements ResponseGate {
  constructor(
    private threshold: number = 0.75,
    private blockedKeywords: string[] = ["refund", "legal", "lawsuit", "cancel subscription"]
  ) {}

  shouldAutoReply(
    ticket: Ticket,
    resolution: TicketResolution
  ): { approved: boolean; reason: string } {
    if (resolution.confidence < this.threshold) {
      return {
        approved: false,
        reason: `Confidence ${resolution.confidence} below threshold ${this.threshold}`,
      };
    }

    const ticketText = `${ticket.subject} ${ticket.body}`.toLowerCase();
    for (const keyword of this.blockedKeywords) {
      if (ticketText.includes(keyword.toLowerCase())) {
        return {
          approved: false,
          reason: `Ticket contains sensitive keyword: "${keyword}"`,
        };
      }
    }

    return { approved: true, reason: "Passed all checks" };
  }
}
