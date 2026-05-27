import type { Ticket } from "../../types.js";
import type { TicketSource } from "../../core/interfaces.js";

interface IntercomConfig {
  accessToken: string;
  inboxId?: string;
}

export class IntercomSource implements TicketSource {
  readonly name = "intercom";
  private lastPollTime: number;

  constructor(private config: IntercomConfig) {
    this.lastPollTime = Math.floor(Date.now() / 1000);
  }

  async poll(): Promise<Ticket[]> {
    const since = this.lastPollTime;
    this.lastPollTime = Math.floor(Date.now() / 1000);

    const query: Record<string, unknown> = {
      query: {
        operator: "AND",
        value: [
          { field: "open", operator: "=", value: true },
          { field: "created_at", operator: ">", value: since },
        ],
      },
    };

    const response = await this.request("/conversations/search", {
      method: "POST",
      body: JSON.stringify(query),
    });

    const data = response as { conversations?: Array<Record<string, unknown>> };
    const conversations = data.conversations ?? [];

    return conversations.map((c) => {
      const source = c.source as Record<string, unknown> | undefined;
      const contacts = c.contacts as { contacts?: Array<Record<string, unknown>> } | undefined;
      const contact = contacts?.contacts?.[0];

      return {
        id: `intercom-${c.id}`,
        source: "intercom",
        subject: String(source?.subject ?? source?.title ?? "Intercom conversation"),
        body: String(source?.body ?? ""),
        customerEmail: String(contact?.email ?? ""),
        customerId: contact?.external_id ? String(contact.external_id) : undefined,
        metadata: {
          intercomId: c.id,
          tags: c.tags,
          priority: c.priority,
        },
        createdAt: new Date(Number(c.created_at ?? Date.now() / 1000) * 1000),
      };
    });
  }

  async reply(ticketId: string, message: string): Promise<void> {
    const intercomId = ticketId.replace("intercom-", "");
    await this.request(`/conversations/${intercomId}/reply`, {
      method: "POST",
      body: JSON.stringify({
        message_type: "comment",
        type: "admin",
        body: message,
      }),
    });
  }

  async escalate(ticketId: string, reason: string): Promise<void> {
    const intercomId = ticketId.replace("intercom-", "");
    await this.request(`/conversations/${intercomId}/reply`, {
      method: "POST",
      body: JSON.stringify({
        message_type: "note",
        type: "admin",
        body: `[Ticketless Escalation] ${reason}`,
      }),
    });

    await this.request(`/conversations/${intercomId}/parts`, {
      method: "POST",
      body: JSON.stringify({
        message_type: "assignment",
        type: "admin",
        assignee_id: "0",
        body: "Escalated by Ticketless — needs human review",
      }),
    });
  }

  async markResolved(ticketId: string): Promise<void> {
    const intercomId = ticketId.replace("intercom-", "");
    await this.request(`/conversations/${intercomId}/parts`, {
      method: "POST",
      body: JSON.stringify({
        message_type: "close",
        type: "admin",
        body: "Resolved by Ticketless",
      }),
    });
  }

  private async request(path: string, options: RequestInit = {}): Promise<unknown> {
    const response = await fetch(`https://api.intercom.io${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Intercom API error ${response.status}: ${text}`);
    }

    return response.json();
  }
}
