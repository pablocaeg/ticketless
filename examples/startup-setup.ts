/**
 * Startup setup example — how a real team would configure Ticketless
 *
 * This shows the config-based approach: define your stack in one place,
 * and Ticketless wires everything up.
 *
 * Run with:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/startup-setup.ts
 */

import {
  Agent,
  TicketlessServer,
  ConfidenceGate,
  FileAuditLog,
  buildLLM,
  buildSources,
  buildTools,
  buildEscalationRules,
  type TicketlessConfig,
} from "../src/index.js";

const config: TicketlessConfig = {
  // Pick your LLM — Claude, OpenAI, or Ollama for local
  llm: {
    provider: "claude",
    apiKey: process.env.ANTHROPIC_API_KEY!,
    // model: "claude-sonnet-4-6",  // optional, this is the default
  },

  // Where do your tickets come from?
  // Uncomment the one you use:
  sources: [
    // { type: "zendesk", subdomain: "mycompany", email: "agent@mycompany.com", apiToken: "..." },
    // { type: "intercom", accessToken: "..." },
    // { type: "freshdesk", domain: "mycompany", apiKey: "..." },
    // { type: "webhook", port: 3101 },
  ],

  // What systems should the agent query during investigation?
  tools: [
    // Your app database — agent can look up users, orders, etc.
    // { type: "postgres", connectionString: process.env.DATABASE_URL!, allowedTables: ["users", "orders", "subscriptions"] },

    // Stripe billing — agent can check payment status, invoices
    // { type: "stripe", apiKey: process.env.STRIPE_SECRET_KEY! },

    // Any REST API — define endpoints the agent can call
    // {
    //   type: "http",
    //   name: "internal_api",
    //   description: "Query our internal admin API",
    //   baseUrl: "https://admin.mycompany.com/api",
    //   headers: { "X-API-Key": process.env.INTERNAL_API_KEY! },
    //   endpoints: [
    //     { action: "get_user", method: "GET", path: "/users/:id", description: "Get user by ID" },
    //     { action: "get_logs", method: "GET", path: "/logs", description: "Search application logs" },
    //   ],
    // },
  ],

  // Agent behavior
  agent: {
    confidenceThreshold: 0.75,
    maxToolCalls: 10,
    maxInvestigationRounds: 3,
  },

  // Server settings
  server: {
    port: 3100,
    // apiKey: process.env.TICKETLESS_API_KEY,  // protect your API
  },

  // Confidence gate settings
  gate: {
    confidenceThreshold: 0.75,
    blockedKeywords: ["refund", "cancel subscription", "legal", "lawsuit"],
  },

  // Async queue (for production)
  queue: {
    concurrency: 3,
  },
};

async function main() {
  const llm = buildLLM(config.llm);
  const sources = buildSources(config.sources ?? []);
  const tools = buildTools(config.tools ?? []);

  // Persistent audit log — survives restarts
  const audit = new FileAuditLog("./data/audit.jsonl");

  const gate = new ConfidenceGate(
    config.gate?.confidenceThreshold,
    config.gate?.blockedKeywords
  );

  const agent = new Agent(llm, audit, gate, {
    ...config.agent,
    confidenceThreshold: config.agent?.confidenceThreshold ?? 0.75,
    maxToolCalls: config.agent?.maxToolCalls ?? 10,
    maxInvestigationRounds: config.agent?.maxInvestigationRounds ?? 3,
    escalationRules: buildEscalationRules(),
  });

  for (const tool of tools) {
    agent.registerTool(tool);
  }

  const server = new TicketlessServer({
    port: config.server?.port ?? 3100,
    agent,
    audit,
    sources,
    apiKey: config.server?.apiKey,
    async: true,
    concurrency: config.queue?.concurrency,
    reviewMode: true,
    pollIntervalMs: 30_000,
    onResolution: (ticket, resolution) => {
      const icon = resolution.action === "reply" ? "+" : "!";
      console.log(
        `[${icon}] ${ticket.subject} — ${resolution.action} (${resolution.confidence}, ${resolution.durationMs}ms)`
      );
    },
  });

  await server.start();

  console.log("Ticketless running");
  console.log(`  Dashboard:   http://localhost:${config.server?.port ?? 3100}/dashboard`);
  console.log(`  API:         http://localhost:${config.server?.port ?? 3100}/api/ticket`);
  console.log(`  LLM:         ${llm.name}`);
  console.log(`  Sources:     ${sources.map((s) => s.name).join(", ") || "API only"}`);
  console.log(`  Tools:       ${tools.length}`);
  console.log(`  Review mode: on`);
  console.log(`  Async queue: on (concurrency: ${config.queue?.concurrency ?? 3})`);

  process.on("SIGINT", async () => {
    await server.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err.message);
  process.exit(1);
});
