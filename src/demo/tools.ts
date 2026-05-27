import type { ToolDefinition } from "../types.js";
import type { Tool } from "../core/interfaces.js";
import { DEMO_USERS, DEMO_ORDERS, DEMO_LOGS } from "./data.js";

export class DemoUserLookupTool implements Tool {
  readonly definition: ToolDefinition = {
    name: "user_lookup",
    description: "Look up a customer account by email or user ID. Returns account status, plan, login history, and billing info.",
    parameters: {
      email: { type: "string", description: "Customer email address" },
      userId: { type: "string", description: "Customer user ID (e.g., usr_001)" },
    },
  };

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const email = args.email ? String(args.email).toLowerCase() : null;
    const userId = args.userId ? String(args.userId) : null;

    const user = DEMO_USERS.find(
      (u) => (email && u.email.toLowerCase() === email) || (userId && u.id === userId)
    );

    if (!user) return { found: false, query: { email, userId } };
    return { found: true, ...user };
  }
}

export class DemoOrderLookupTool implements Tool {
  readonly definition: ToolDefinition = {
    name: "order_lookup",
    description: "Look up orders by user ID or order ID. Returns order status, amount, product, and any errors.",
    parameters: {
      userId: { type: "string", description: "Customer user ID to find their orders" },
      orderId: { type: "string", description: "Specific order ID to look up" },
      status: { type: "string", description: "Filter by status: completed, pending, failed, refunded" },
    },
  };

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const userId = args.userId ? String(args.userId) : null;
    const orderId = args.orderId ? String(args.orderId) : null;
    const status = args.status ? String(args.status) : null;

    let results = DEMO_ORDERS;
    if (userId) results = results.filter((o) => o.userId === userId);
    if (orderId) results = results.filter((o) => o.id === orderId);
    if (status) results = results.filter((o) => o.status === status);

    return { count: results.length, orders: results };
  }
}

export class DemoLogSearchTool implements Tool {
  readonly definition: ToolDefinition = {
    name: "search_logs",
    description: "Search application logs by user ID, service name, log level, or keyword. Returns recent log entries matching the criteria.",
    parameters: {
      userId: { type: "string", description: "Filter logs by user ID" },
      service: { type: "string", description: "Filter by service: auth, billing, provisioning, export, orders" },
      level: { type: "string", description: "Filter by level: info, warn, error" },
      keyword: { type: "string", description: "Search for keyword in log messages" },
    },
  };

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const userId = args.userId ? String(args.userId) : null;
    const service = args.service ? String(args.service).toLowerCase() : null;
    const level = args.level ? String(args.level).toLowerCase() : null;
    const keyword = args.keyword ? String(args.keyword).toLowerCase() : null;

    let results = DEMO_LOGS;
    if (userId) results = results.filter((l) => l.userId === userId);
    if (service) results = results.filter((l) => l.service === service);
    if (level) results = results.filter((l) => l.level === level);
    if (keyword) results = results.filter((l) => l.message.toLowerCase().includes(keyword));

    return { count: results.length, logs: results };
  }
}

export class DemoKnowledgeBaseTool implements Tool {
  readonly definition: ToolDefinition = {
    name: "search_docs",
    description: "Search the product knowledge base and help docs. Use this to find relevant documentation about features, limits, and troubleshooting steps.",
    parameters: {
      query: { type: "string", description: "Search query", required: true },
    },
  };

  private articles = [
    {
      title: "Account Lockout Policy",
      content: "After 5 failed login attempts, accounts are locked for 15 minutes. Users can reset their password immediately via the 'Forgot Password' link. Admins can unlock accounts manually from the admin panel.",
    },
    {
      title: "Plan Limits — Export",
      content: "Free plan: 100 rows per export. Starter plan: 1,000 rows per export. Pro plan: unlimited exports. Enterprise plan: unlimited exports with custom formats (XLSX, PDF, JSON).",
    },
    {
      title: "Updating Payment Methods",
      content: "Users can update their payment method at Settings > Billing > Payment Method. After updating, any failed charges will be automatically retried within 24 hours. Enterprise customers should contact their account manager.",
    },
    {
      title: "Team Seat Provisioning",
      content: "New seats are provisioned within 5 minutes of purchase. If seats don't appear after 10 minutes, the provisioning service may be experiencing delays. Check the system status page. Seats can be manually provisioned by support via the admin API.",
    },
    {
      title: "API Add-on Pack",
      content: "The API Add-on Pack ($99/month) provides 100,000 API calls per month on top of the plan's base allocation. Available for Pro and Enterprise plans. Requires a valid payment method on file.",
    },
  ];

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const query = String(args.query).toLowerCase();
    const words = query.split(/\s+/);

    const scored = this.articles.map((article) => {
      const text = `${article.title} ${article.content}`.toLowerCase();
      const score = words.filter((w) => text.includes(w)).length;
      return { ...article, score };
    });

    const relevant = scored.filter((a) => a.score > 0).sort((a, b) => b.score - a.score);
    return { count: relevant.length, articles: relevant.slice(0, 3) };
  }
}
