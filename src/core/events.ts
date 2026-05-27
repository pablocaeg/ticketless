import type { Ticket, TicketResolution, ToolResult, AuditEntry } from "../types.js";

export interface TicketlessEvents {
  "ticket:received": { ticket: Ticket };
  "ticket:resolved": { ticket: Ticket; resolution: TicketResolution };
  "ticket:escalated": { ticket: Ticket; resolution: TicketResolution };
  "ticket:error": { ticket: Ticket; error: Error };
  "tool:called": { ticketId: string; result: ToolResult };
  "audit:entry": { entry: AuditEntry };
  "review:pending": { ticketId: string; ticket: Ticket };
  "review:approved": { ticketId: string };
  "review:rejected": { ticketId: string; reason: string };
  "queue:drained": Record<string, never>;
}

type EventHandler<T> = (data: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler<unknown>>>();

  on<K extends keyof TicketlessEvents>(event: K, handler: EventHandler<TicketlessEvents[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const handlerSet = this.handlers.get(event)!;
    handlerSet.add(handler as EventHandler<unknown>);

    return () => {
      handlerSet.delete(handler as EventHandler<unknown>);
    };
  }

  emit<K extends keyof TicketlessEvents>(event: K, data: TicketlessEvents[K]): void {
    const handlerSet = this.handlers.get(event);
    if (!handlerSet) return;
    for (const handler of handlerSet) {
      try {
        handler(data);
      } catch {
        // Event handlers must not crash the agent
      }
    }
  }

  removeAllListeners(): void {
    this.handlers.clear();
  }
}
