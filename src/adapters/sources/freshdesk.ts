import type { Ticket } from "../../types.js";
import type { TicketSource } from "../../core/interfaces.js";

interface FreshdeskConfig {
  domain: string;
  apiKey: string;
  pollStatus?: number;
}

export class FreshdeskSource implements TicketSource {
  readonly name = "freshdesk";
  private baseUrl: string;
  private authHeader: string;
  private pollStatus: number;
  private lastPollTime: Date;

  constructor(private config: FreshdeskConfig) {
    this.baseUrl = `https://${config.domain}.freshdesk.com/api/v2`;
    this.authHeader = "Basic " + Buffer.from(`${config.apiKey}:X`).toString("base64");
    this.pollStatus = config.pollStatus ?? 2; // 2 = Open
    this.lastPollTime = new Date();
  }

  async poll(): Promise<Ticket[]> {
    const since = this.lastPollTime.toISOString();
    this.lastPollTime = new Date();

    const response = await this.request(
      `/tickets?updated_since=${since}&status=${this.pollStatus}&include=requester`
    );

    const tickets = (response ?? []) as Array<Record<string, unknown>>;

    return tickets.map((t) => {
      const requester = t.requester as Record<string, unknown> | undefined;
      return {
        id: `freshdesk-${t.id}`,
        source: "freshdesk",
        subject: String(t.subject ?? ""),
        body: String(t.description_text ?? t.description ?? ""),
        customerEmail: String(requester?.email ?? t.email ?? ""),
        metadata: {
          freshdeskId: t.id,
          priority: t.priority,
          type: t.type,
          tags: t.tags,
          source: t.source,
        },
        createdAt: new Date(String(t.created_at ?? new Date().toISOString())),
      };
    });
  }

  async reply(ticketId: string, message: string): Promise<void> {
    const freshdeskId = ticketId.replace("freshdesk-", "");
    await this.request(`/tickets/${freshdeskId}/reply`, {
      method: "POST",
      body: JSON.stringify({ body: message }),
    });
  }

  async escalate(ticketId: string, reason: string): Promise<void> {
    const freshdeskId = ticketId.replace("freshdesk-", "");
    await this.request(`/tickets/${freshdeskId}/notes`, {
      method: "POST",
      body: JSON.stringify({
        body: `[Ticketless Escalation] ${reason}`,
        private: true,
      }),
    });

    await this.request(`/tickets/${freshdeskId}`, {
      method: "PUT",
      body: JSON.stringify({
        status: 2, // Keep open
        tags: ["ticketless-escalated"],
      }),
    });
  }

  async markResolved(ticketId: string): Promise<void> {
    const freshdeskId = ticketId.replace("freshdesk-", "");
    await this.request(`/tickets/${freshdeskId}`, {
      method: "PUT",
      body: JSON.stringify({ status: 4 }), // 4 = Resolved
    });
  }

  private async request(path: string, options: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Freshdesk API error ${response.status}: ${text}`);
    }

    return response.json();
  }
}
