import type { Ticket, TicketResolution } from "../types.js";
import { Agent } from "./agent.js";

export interface QueuedTicket {
  ticket: Ticket;
  status: "pending" | "processing" | "completed" | "failed";
  resolution: TicketResolution | null;
  error: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface QueueConfig {
  concurrency: number;
  onResolution?: (ticket: Ticket, resolution: TicketResolution) => void | Promise<void>;
  onError?: (ticket: Ticket, error: Error) => void;
}

export class TicketQueue {
  private queue: Map<string, QueuedTicket> = new Map();
  private activeCount = 0;
  private pending: string[] = [];
  private draining = false;
  private drainResolvers: Array<() => void> = [];

  constructor(
    private agent: Agent,
    private config: QueueConfig = { concurrency: 3 }
  ) {}

  submit(ticket: Ticket): string {
    if (this.draining) {
      throw new Error("Queue is draining — cannot accept new tickets");
    }

    const entry: QueuedTicket = {
      ticket,
      status: "pending",
      resolution: null,
      error: null,
      queuedAt: new Date(),
      startedAt: null,
      completedAt: null,
    };

    this.queue.set(ticket.id, entry);
    this.pending.push(ticket.id);
    this.processNext();
    return ticket.id;
  }

  getStatus(ticketId: string): QueuedTicket | undefined {
    return this.queue.get(ticketId);
  }

  getAllStatuses(): QueuedTicket[] {
    return [...this.queue.values()];
  }

  getPending(): number {
    return this.pending.length;
  }

  getActive(): number {
    return this.activeCount;
  }

  async drain(): Promise<void> {
    this.draining = true;

    if (this.activeCount === 0 && this.pending.length === 0) return;

    return new Promise((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  private processNext(): void {
    while (this.activeCount < this.config.concurrency && this.pending.length > 0) {
      const ticketId = this.pending.shift()!;
      const entry = this.queue.get(ticketId);
      if (!entry) continue;

      this.activeCount++;
      entry.status = "processing";
      entry.startedAt = new Date();

      this.process(entry).finally(() => {
        this.activeCount--;
        this.processNext();
        this.checkDrained();
      });
    }
  }

  private checkDrained(): void {
    if (this.activeCount === 0 && this.pending.length === 0 && this.drainResolvers.length > 0) {
      for (const resolve of this.drainResolvers) resolve();
      this.drainResolvers = [];
    }
  }

  private async process(entry: QueuedTicket): Promise<void> {
    try {
      const resolution = await this.agent.resolve(entry.ticket);
      entry.status = "completed";
      entry.resolution = resolution;
      entry.completedAt = new Date();

      if (this.config.onResolution) {
        await this.config.onResolution(entry.ticket, resolution);
      }
    } catch (err) {
      entry.status = "failed";
      entry.error = err instanceof Error ? err.message : String(err);
      entry.completedAt = new Date();

      if (this.config.onError) {
        this.config.onError(entry.ticket, err instanceof Error ? err : new Error(String(err)));
      }
    }
  }
}
