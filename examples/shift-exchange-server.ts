/**
 * Ticketless server connected to Shift Exchange + shift-comply
 *
 * Starts a web server with a chat UI at http://localhost:3100/chat
 * Uses DeepSeek as the LLM provider (OpenAI-compatible API)
 *
 * Prerequisites:
 *   1. shift-comply running on :8080
 *   2. shift-exchange running on :3001
 *
 * Run:
 *   DEEPSEEK_API_KEY=sk-... npx tsx examples/shift-exchange-server.ts
 */

import {
  Agent,
  TicketlessServer,
  InMemoryAuditLog,
  ConfidenceGate,
  OpenAIProvider,
  HttpApiTool,
} from "../src/index.js";

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("Set DEEPSEEK_API_KEY");
  process.exit(1);
}

const llm = new OpenAIProvider(
  apiKey,
  "deepseek-chat",
  2048,
  "https://api.deepseek.com/v1"
);

const audit = new InMemoryAuditLog();
const gate = new ConfidenceGate(0.5);

const agent = new Agent(llm, audit, gate, {
  confidenceThreshold: 0.5,
  maxToolCalls: 8,
  maxInvestigationRounds: 3,
  escalationRules: [],
});

agent.registerTool(
  new HttpApiTool({
    name: "shift_exchange",
    description:
      "Query the hospital shift exchange system. Look up staff members, their shift schedules, and open exchange requests.",
    baseUrl: process.env.SHIFT_EXCHANGE_URL || "http://localhost:3001",
    endpoints: [
      {
        action: "list_users",
        method: "GET",
        path: "/api/users",
        description: "List all staff members with their id, name, role, and staffType",
      },
      {
        action: "get_schedule",
        method: "GET",
        path: "/api/users/:id/schedule",
        description:
          "Get a user's shift schedule by their numeric id OR name (e.g. id=1 or id=Alice). Returns assigned shifts with dates and times.",
      },
      {
        action: "list_exchanges",
        method: "GET",
        path: "/api/exchanges",
        description:
          "List all shift exchange requests with status, posted shift, offers, and involved users",
      },
    ],
  })
);

agent.registerTool(
  new HttpApiTool({
    name: "shift_comply",
    description:
      "Validate whether a shift change complies with labor regulations. Checks jurisdiction-specific rules like rest periods, maximum hours, and consecutive shifts.",
    baseUrl: process.env.SHIFT_COMPLY_URL || "http://localhost:8080",
    endpoints: [
      {
        action: "health",
        method: "GET",
        path: "/health",
        description: "Check if the compliance engine is running",
      },
      {
        action: "get_rules",
        method: "GET",
        path: "/rules",
        description:
          "Get compliance rules for a jurisdiction. Pass jurisdiction as query param (ES, US, DE, EU, IT, PL, HU, etc).",
      },
      {
        action: "validate_swap",
        method: "POST",
        path: "/validate-swap",
        description:
          'Validate a proposed shift swap against labor law. Body: { "jurisdiction": "ES", "facility_scope": "hospitals", "staff_id": "user-1", "staff_type": "nurse-rn", "current_shifts": [{staff_id, staff_type, start, end}...], "add": {staff_id, staff_type, start, end}, optionally "remove": {staff_id, staff_type, start, end} }',
      },
    ],
  })
);

const server = new TicketlessServer({
  port: 3100,
  agent,
  audit,
  sources: [],
  async: false,
  reviewMode: false,
});

server.start().then(() => {
  console.log();
  console.log("  Ticketless — Hospital Support Agent");
  console.log("  ────────────────────────────────────");
  console.log("  Chat:      http://localhost:3100/chat");
  console.log("  Dashboard: http://localhost:3100/dashboard");
  console.log("  Health:    http://localhost:3100/health");
  console.log("  LLM:       DeepSeek (deepseek-chat)");
  console.log("  Tools:     shift_exchange, shift_comply");
  console.log();
});
