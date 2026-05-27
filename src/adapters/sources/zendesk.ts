import type { Ticket } from "../../types.js";
import type { TicketSource } from "../../core/interfaces.js";

interface ZendeskConfig {
  subdomain: string;
  email: string;
  apiToken: string;
  pollStatus?: string;
  pollInterval?: number;
}

export class ZendeskSource implements TicketSource {
  readonly name = "zendesk";
  private baseUrl: string;
  private authHeader: string;
  private pollStatus: string;
  private lastPollTime: Date;

  constructor(private config: ZendeskConfig) {
    this.baseUrl = `https://${config.subdomain}.zendesk.com/api/v2`;
    this.authHeader =
      "Basic " + Buffer.from(`${config.email}/token:${config.apiToken}`).toString("base64");
    this.pollStatus = config.pollStatus ?? "new";
    this.lastPollTime = new Date();
  }

  async poll(): Promise<Ticket[]> {
    const since = this.lastPollTime.toISOString();
    this.lastPollTime = new Date();

    const response = await this.request(
      `/search.json?query=type:ticket status:${this.pollStatus} created>${since}&sort_by=created_at&sort_order=asc`
    );

    const data = response as { results?: Array<Record<string, unknown>> };
    const results = data.results ?? [];

    return results.map((t) => ({
      id: `zendesk-${t.id}`,
      source: "zendesk",
      subject: String(t.subject ?? ""),
      body: String(t.description ?? ""),
      customerEmail: String(t.requester?.toString() ?? ""),
      metadata: {
        zendeskId: t.id,
        priority: t.priority,
        tags: t.tags,
        channel: t.via,
      },
      createdAt: new Date(String(t.created_at ?? new Date().toISOString())),
    }));
  }

  async reply(ticketId: string, message: string): Promise<void> {
    const zendeskId = ticketId.replace("zendesk-", "");
    await this.request(`/tickets/${zendeskId}.json`, {
      method: "PUT",
      body: JSON.stringify({
        ticket: {
          comment: {
            body: message,
            public: true,
          },
          status: "solved",
        },
      }),
    });
  }

  async escalate(ticketId: string, reason: string): Promise<void> {
    const zendeskId = ticketId.replace("zendesk-", "");
    await this.request(`/tickets/${zendeskId}.json`, {
      method: "PUT",
      body: JSON.stringify({
        ticket: {
          comment: {
            body: `[Ticketless Escalation] ${reason}`,
            public: false,
          },
          status: "open",
          tags: ["ticketless-escalated"],
        },
      }),
    });
  }

  async markResolved(ticketId: string): Promise<void> {
    const zendeskId = ticketId.replace("zendesk-", "");
    await this.request(`/tickets/${zendeskId}.json`, {
      method: "PUT",
      body: JSON.stringify({
        ticket: { status: "solved" },
      }),
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
      throw new Error(`Zendesk API error ${response.status}: ${text}`);
    }

    return response.json();
  }
}
