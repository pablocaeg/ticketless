import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Ticket, TicketResolution } from "../types.js";
import type { AuditLog, TicketSource } from "./interfaces.js";
import { Agent } from "./agent.js";
import { TicketQueue } from "./queue.js";
import { ReviewQueue } from "./review.js";
import { validateTicket } from "./validator.js";
import { ValidationError } from "./errors.js";

interface ServerConfig {
  port: number;
  agent: Agent;
  audit: AuditLog;
  sources: TicketSource[];
  apiKey?: string;
  async?: boolean;
  concurrency?: number;
  pollIntervalMs?: number;
  reviewMode?: boolean;
  onResolution?: (ticket: Ticket, resolution: TicketResolution) => void;
  onError?: (ticketId: string, error: Error) => void;
}

export class TicketlessServer {
  private httpServer: ReturnType<typeof createServer> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private resolutions: Map<string, TicketResolution> = new Map();
  private tickets: Map<string, Ticket> = new Map();
  private queue: TicketQueue | null = null;
  readonly review: ReviewQueue;

  constructor(private config: ServerConfig) {
    this.review = new ReviewQueue(config.audit);

    for (const source of config.sources) {
      this.review.registerSource(source);
    }

    if (config.async) {
      this.queue = new TicketQueue(config.agent, {
        concurrency: config.concurrency ?? 3,
        onResolution: (ticket, resolution) => {
          this.resolutions.set(ticket.id, resolution);
          if (config.reviewMode && resolution.action === "escalate") {
            this.review.addForReview(ticket, resolution);
          }
          config.onResolution?.(ticket, resolution);
        },
        onError: (ticket, error) => {
          config.onError?.(ticket.id, error);
        },
      });
    }
  }

  async start(): Promise<void> {
    for (const source of this.config.sources) {
      if (source.init) await source.init();
    }

    this.httpServer = createServer((req, res) => this.handleHTTP(req, res));

    if (this.config.pollIntervalMs) {
      this.pollTimer = setInterval(() => this.pollSources(), this.config.pollIntervalMs);
    }

    return new Promise((resolve) => {
      this.httpServer!.listen(this.config.port, () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);

    for (const source of this.config.sources) {
      if (source.destroy) await source.destroy();
    }

    return new Promise((resolve, reject) => {
      if (!this.httpServer) return resolve();
      this.httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  }

  async submitTicket(ticket: Ticket): Promise<TicketResolution | { ticketId: string; status: string }> {
    this.tickets.set(ticket.id, ticket);

    if (this.queue) {
      this.queue.submit(ticket);
      return { ticketId: ticket.id, status: "queued" };
    }

    const resolution = await this.config.agent.resolve(ticket);
    this.resolutions.set(ticket.id, resolution);

    if (this.config.reviewMode && resolution.action === "escalate") {
      this.review.addForReview(ticket, resolution);
    } else if (resolution.action === "reply") {
      await this.deliverReply(ticket, resolution.reply ?? "");
    } else {
      await this.deliverEscalation(ticket, resolution.escalationReason ?? "");
    }

    this.config.onResolution?.(ticket, resolution);
    return resolution;
  }

  private async deliverReply(ticket: Ticket, message: string): Promise<void> {
    for (const source of this.config.sources) {
      if (source.name === ticket.source) {
        await source.reply(ticket.id, message);
        await source.markResolved(ticket.id);
      }
    }
  }

  private async deliverEscalation(ticket: Ticket, reason: string): Promise<void> {
    for (const source of this.config.sources) {
      if (source.name === ticket.source) {
        await source.escalate(ticket.id, reason);
      }
    }
  }

  private async pollSources(): Promise<void> {
    for (const source of this.config.sources) {
      try {
        const tickets = await source.poll();
        for (const ticket of tickets) {
          this.submitTicket(ticket).catch((err) => {
            this.config.onError?.(ticket.id, err instanceof Error ? err : new Error(String(err)));
          });
        }
      } catch (err) {
        this.config.onError?.("poll", err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  // --- HTTP Routing ---

  private handleHTTP(req: IncomingMessage, res: ServerResponse): void {
    if (this.config.apiKey && !this.checkAuth(req, res)) return;

    const url = new URL(req.url ?? "/", `http://localhost:${this.config.port}`);
    const route = `${req.method} ${url.pathname}`;

    switch (route) {
      case "POST /api/ticket":
        return this.handleSubmitTicket(req, res);
      case "GET /api/ticket/status":
        return this.handleTicketStatus(url, res);
      case "GET /api/audit":
        return this.handleGetAudit(url, res);
      case "GET /api/resolution":
        return this.handleGetResolution(url, res);
      case "GET /api/review":
        return this.handleGetReviewQueue(res);
      case "POST /api/review/approve":
        return this.handleReviewAction(req, res, "approve");
      case "POST /api/review/reject":
        return this.handleReviewAction(req, res, "reject");
      case "GET /api/stats":
        return this.handleGetStats(res);
      case "GET /health":
        return json(res, 200, { status: "ok" });
      case "GET /dashboard":
        return this.serveDashboard(res);
      case "GET /chat":
        return this.serveChat(res);
      case "GET /widget.js":
        return this.serveWidget(res);
      default:
        return json(res, 404, { error: "Not found" });
    }
  }

  private checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
    const url = req.url ?? "";

    // Dashboard, chat, widget, and health don't require auth
    if (url === "/dashboard" || url === "/chat" || url === "/widget.js" || url === "/health") return true;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.slice(7) !== this.config.apiKey) {
      json(res, 401, { error: "Unauthorized. Set Authorization: Bearer <api-key>" });
      return false;
    }

    return true;
  }

  private handleSubmitTicket(req: IncomingMessage, res: ServerResponse): void {
    readBody(req, async (err, body) => {
      if (err) return json(res, 400, { error: "Invalid request body" });

      try {
        const data = JSON.parse(body);
        const ticket = validateTicket(data);
        const result = await this.submitTicket(ticket);
        json(res, 200, result);
      } catch (e) {
        if (e instanceof ValidationError) {
          json(res, 400, { error: e.message, field: e.field });
        } else if (e instanceof SyntaxError) {
          json(res, 400, { error: "Invalid JSON body" });
        } else {
          const message = e instanceof Error ? e.message : String(e);
          json(res, 500, { error: message });
        }
      }
    });
  }

  private handleTicketStatus(url: URL, res: ServerResponse): void {
    const ticketId = url.searchParams.get("ticketId");
    if (!ticketId) return json(res, 400, { error: "ticketId query parameter required" });

    if (this.queue) {
      const status = this.queue.getStatus(ticketId);
      if (status) {
        return json(res, 200, {
          ticketId,
          status: status.status,
          resolution: status.resolution,
          error: status.error,
          queuedAt: status.queuedAt,
          completedAt: status.completedAt,
        });
      }
    }

    const resolution = this.resolutions.get(ticketId);
    if (resolution) return json(res, 200, { ticketId, status: "completed", resolution });

    json(res, 404, { error: "Ticket not found" });
  }

  private handleGetAudit(url: URL, res: ServerResponse): void {
    const ticketId = url.searchParams.get("ticketId");
    const entries = ticketId
      ? this.config.audit.getEntries(ticketId)
      : this.config.audit.getAllEntries();
    json(res, 200, { entries });
  }

  private handleGetResolution(url: URL, res: ServerResponse): void {
    const ticketId = url.searchParams.get("ticketId");
    if (!ticketId) return json(res, 400, { error: "ticketId query parameter required" });

    const resolution = this.resolutions.get(ticketId);
    if (!resolution) return json(res, 404, { error: "Resolution not found" });

    json(res, 200, resolution);
  }

  private handleGetReviewQueue(res: ServerResponse): void {
    json(res, 200, {
      pending: this.review.getPending().length,
      total: this.review.getAll().length,
      items: this.review.getAll(),
    });
  }

  private handleReviewAction(
    req: IncomingMessage,
    res: ServerResponse,
    action: "approve" | "reject"
  ): void {
    readBody(req, async (err, body) => {
      if (err) return json(res, 400, { error: "Invalid request body" });

      try {
        const data = JSON.parse(body);
        if (!data.ticketId) return json(res, 400, { error: "ticketId required" });

        if (action === "approve") {
          if (data.editedReply) {
            await this.review.approveWithEdit(data.ticketId, data.editedReply, data.note);
          } else {
            await this.review.approve(data.ticketId, data.note);
          }
        } else {
          await this.review.reject(data.ticketId, data.reason ?? "Rejected by reviewer");
        }

        json(res, 200, { ticketId: data.ticketId, action, status: "ok" });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        json(res, 400, { error: message });
      }
    });
  }

  private handleGetStats(res: ServerResponse): void {
    const allEntries = this.config.audit.getAllEntries();
    const ticketIds = new Set(allEntries.map((e) => e.ticketId));

    const reviewItems = this.review.getAll();

    json(res, 200, {
      tickets: {
        total: ticketIds.size,
        resolved: allEntries.filter((e) => e.step === "responding").length,
        escalated: allEntries.filter((e) => e.step === "escalating").length,
        toolCalls: allEntries.filter((e) => e.step === "tool_call").length,
      },
      review: {
        pending: reviewItems.filter((i) => i.status === "pending").length,
        approved: reviewItems.filter((i) => i.status === "approved" || i.status === "edited").length,
        rejected: reviewItems.filter((i) => i.status === "rejected").length,
      },
      queue: this.queue
        ? { pending: this.queue.getPending(), active: this.queue.getActive() }
        : null,
    });
  }

  private serveDashboard(res: ServerResponse): void {
    try {
      const htmlPath = resolve(__dirname, "..", "dashboard", "index.html");
      const html = readFileSync(htmlPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Dashboard not found");
    }
  }

  private serveChat(res: ServerResponse): void {
    try {
      const htmlPath = resolve(__dirname, "..", "dashboard", "chat.html");
      const html = readFileSync(htmlPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Chat not found");
    }
  }

  private serveWidget(res: ServerResponse): void {
    try {
      const jsPath = resolve(__dirname, "..", "dashboard", "widget.js");
      const js = readFileSync(jsPath, "utf-8");
      res.writeHead(200, {
        "Content-Type": "application/javascript",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(js);
    } catch {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Widget not found");
    }
  }
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req: IncomingMessage, cb: (err: Error | null, body: string) => void): void {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => cb(null, body));
  req.on("error", (err) => cb(err, ""));
}
