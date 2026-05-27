/**
 * Real-world example: Ticketless with Postgres and Claude
 *
 * Run with:
 *   ANTHROPIC_API_KEY=sk-ant-... DATABASE_URL=postgresql://... npx tsx examples/with-postgres.ts
 */

import {
  Agent,
  TicketlessServer,
  InMemoryAuditLog,
  ConfidenceGate,
  ClaudeProvider,
  PostgresLookupTool,
} from "../src/index.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY environment variable");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("Set DATABASE_URL environment variable");
  process.exit(1);
}

const llm = new ClaudeProvider(ANTHROPIC_API_KEY);
const audit = new InMemoryAuditLog();
const gate = new ConfidenceGate(0.75);

const agent = new Agent(llm, audit, gate, {
  confidenceThreshold: 0.75,
  maxToolCalls: 10,
  maxInvestigationRounds: 3,
  escalationRules: [
    {
      name: "angry-customer",
      condition: (ticket) => {
        const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
        return text.includes("furious") || text.includes("unacceptable") || text.includes("lawyer");
      },
      reason: "Customer appears upset — routing to human for empathetic handling",
    },
  ],
});

agent.registerTool(
  new PostgresLookupTool({
    connectionString: DATABASE_URL,
    allowedTables: ["users", "orders", "subscriptions", "invoices"],
    maxRows: 20,
  })
);

const server = new TicketlessServer({
  port: 3100,
  agent,
  audit,
  sources: [],
  onResolution: (ticket, resolution) => {
    console.log(
      `[${resolution.action}] ${ticket.subject} — confidence: ${resolution.confidence} (${resolution.durationMs}ms)`
    );
  },
});

server.start().then(() => {
  console.log("Ticketless running on http://localhost:3100");
  console.log("Dashboard: http://localhost:3100/dashboard");
  console.log("\nSubmit a ticket:");
  console.log(`  curl -X POST http://localhost:3100/api/ticket \\`);
  console.log(`    -H 'Content-Type: application/json' \\`);
  console.log(`    -d '{"subject":"Can\\'t log in","body":"Help!","customerEmail":"user@example.com"}'`);
});
