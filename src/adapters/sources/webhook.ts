import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Ticket } from "../../types.js";
import type { TicketSource } from "../../core/interfaces.js";

type TicketHandler = (ticket: Ticket) => void;

export class WebhookSource implements TicketSource {
  readonly name = "webhook";
  private server: ReturnType<typeof createServer> | null = null;
  private pendingTickets: Ticket[] = [];
  private onTicket: TicketHandler | null = null;

  constructor(private port: number = 3100) {}

  setTicketHandler(handler: TicketHandler): void {
    this.onTicket = handler;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handleRequest(req, res));
    return new Promise((resolve) => {
      this.server!.listen(this.port, () => resolve());
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  async poll(): Promise<Ticket[]> {
    const tickets = [...this.pendingTickets];
    this.pendingTickets = [];
    return tickets;
  }

  async reply(_ticketId: string, _message: string): Promise<void> {
    // Webhook source doesn't support replies — use a ticketing system adapter
  }

  async escalate(_ticketId: string, _reason: string): Promise<void> {
    // Webhook source doesn't support escalation — use a ticketing system adapter
  }

  async markResolved(_ticketId: string): Promise<void> {
    // No-op for webhook source
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== "POST" || req.url !== "/ticket") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found. POST to /ticket" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const ticket: Ticket = {
          id: data.id ?? crypto.randomUUID(),
          source: "webhook",
          subject: data.subject ?? "",
          body: data.body ?? "",
          customerEmail: data.customerEmail ?? data.email ?? "",
          customerId: data.customerId,
          metadata: data.metadata ?? {},
          createdAt: new Date(),
        };

        this.pendingTickets.push(ticket);
        if (this.onTicket) this.onTicket(ticket);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ticketId: ticket.id, status: "received" }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
    });
  }
}
