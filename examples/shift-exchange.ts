/**
 * Example: Ticketless + Shift Exchange + shift-comply
 *
 * Hospital support agent that resolves scheduling tickets by querying
 * the shift exchange API and validating compliance via shift-comply.
 *
 * Prerequisites (3 terminals):
 *   1. cd ~/Desktop/shift-comply && go run ./cmd/shiftcomply-api -addr :8080
 *   2. cd ~/Desktop/shift-exchange-assignment && pnpm dev
 *   3. ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/shift-exchange.ts
 */

import {
  Agent,
  InMemoryAuditLog,
  ConfidenceGate,
  ClaudeProvider,
  HttpApiTool,
  type Ticket,
} from "../src/index.js";

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Set ANTHROPIC_API_KEY");
    process.exit(1);
  }

  const llm = new ClaudeProvider(apiKey);
  const audit = new InMemoryAuditLog();
  const gate = new ConfidenceGate(0.7);

  const agent = new Agent(llm, audit, gate, {
    confidenceThreshold: 0.7,
    maxToolCalls: 10,
    maxInvestigationRounds: 3,
    escalationRules: [
      {
        name: "compliance-violation",
        condition: (_ticket, findings) =>
          findings.some(
            (f) =>
              !f.error &&
              f.result &&
              typeof f.result === "object" &&
              (f.result as Record<string, unknown>).result === "fail"
          ),
        reason: "Shift swap would violate labor regulations — requires manager review",
      },
    ],
  });

  // Tool 1: Query the shift exchange backend (users, schedules, exchanges)
  agent.registerTool(
    new HttpApiTool({
      name: "shift_exchange",
      description:
        "Query the hospital shift exchange system. Can look up staff members, their schedules, and open exchange requests.",
      baseUrl: "http://localhost:3001",
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
            "Get a user's full shift schedule. Returns their assigned shifts with dates and times. The id param is the user's numeric id.",
        },
        {
          action: "list_exchanges",
          method: "GET",
          path: "/api/exchanges",
          description:
            "List all shift exchange requests with their status, posted shift, offers, and involved users",
        },
      ],
    })
  );

  // Tool 2: Validate shift compliance via shift-comply
  agent.registerTool(
    new HttpApiTool({
      name: "shift_comply",
      description:
        "Validate whether a shift change complies with labor regulations. Checks jurisdiction-specific rules (rest periods, max hours, consecutive shifts). Use this before approving any swap.",
      baseUrl: "http://localhost:8080",
      endpoints: [
        {
          action: "health",
          method: "GET",
          path: "/health",
          description: "Check if the compliance engine is running and how many jurisdictions are loaded",
        },
        {
          action: "get_rules",
          method: "GET",
          path: "/rules",
          description:
            "Get all compliance rules for a jurisdiction. Pass jurisdiction as a query param (e.g. ES, US, DE, EU).",
        },
        {
          action: "validate_swap",
          method: "POST",
          path: "/validate-swap",
          description:
            'Validate a proposed shift swap. Body must include: jurisdiction (e.g. "ES"), facility_scope ("hospitals"), staff_id, staff_type (e.g. "nurse-rn"), current_shifts (array of {staff_id, staff_type, start, end}), and add (the new shift {staff_id, staff_type, start, end}). Optionally include remove for the shift being given away.',
        },
      ],
    })
  );

  // --- Demo tickets ---

  const tickets: Ticket[] = [
    {
      id: "shift-001",
      source: "internal",
      subject: "Can I swap my Tuesday morning for a night shift?",
      body: "Hi, I'm Alice (user id 1). I have a morning shift on Day 2 (Tuesday April 22) and I'd like to swap it for a night shift that same day. I'm in a Spanish hospital. Can you check if this would be allowed?",
      customerEmail: "alice@hospital.es",
      customerId: "1",
      metadata: {},
      createdAt: new Date(),
    },
    {
      id: "shift-002",
      source: "internal",
      subject: "What exchanges are available right now?",
      body: "Hey, I'm Bob (user id 2). Can you show me what shift exchanges are currently open? I'm looking for opportunities to pick up extra shifts this week.",
      customerEmail: "bob@hospital.es",
      customerId: "2",
      metadata: {},
      createdAt: new Date(),
    },
    {
      id: "shift-003",
      source: "internal",
      subject: "Is my schedule compliant with Spanish law?",
      body: "I'm Carol (user id 3) and I want to make sure my current schedule follows Spanish labor regulations. Can you check my shifts and tell me if everything is within legal limits?",
      customerEmail: "carol@hospital.es",
      customerId: "3",
      metadata: {},
      createdAt: new Date(),
    },
  ];

  console.log();
  console.log("  ╔══════════════════════════════════════════════════╗");
  console.log("  ║   Ticketless — Shift Exchange Demo              ║");
  console.log("  ║   Hospital support agent with compliance        ║");
  console.log("  ╚══════════════════════════════════════════════════╝");
  console.log();
  console.log(`  LLM: Claude`);
  console.log(`  Tools: shift_exchange (3 endpoints), shift_comply (3 endpoints)`);
  console.log(`  Tickets: ${tickets.length} scenarios`);
  console.log();

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    console.log(`  ┌─ Ticket ${i + 1}/${tickets.length} ─────────────────────────────────────`);
    console.log(`  │ ID:      ${ticket.id}`);
    console.log(`  │ From:    ${ticket.customerEmail}`);
    console.log(`  │ Subject: ${ticket.subject}`);
    console.log(`  │`);

    const startEntries = audit.getAllEntries().length;
    const resolution = await agent.resolve(ticket);

    const entries = audit.getAllEntries().slice(startEntries);
    for (const entry of entries) {
      const icons: Record<string, string> = {
        received: ">>>",
        planning: "[P]",
        investigating: "[I]",
        tool_call: "[T]",
        synthesizing: "[S]",
        responding: "[R]",
        escalating: "[!]",
        error: "[X]",
      };
      console.log(`  │ ${icons[entry.step] ?? "   "} [${entry.step}] ${entry.detail}`);
    }

    console.log(`  │`);
    if (resolution.action === "reply") {
      console.log(
        `  │ RESOLVED | confidence: ${resolution.confidence} | ${resolution.durationMs}ms`
      );
      console.log(`  │`);
      for (const line of (resolution.reply ?? "").split("\n")) {
        console.log(`  │   ${line}`);
      }
    } else {
      console.log(`  │ ESCALATED | ${resolution.escalationReason}`);
    }
    console.log(`  └──────────────────────────────────────────────────`);
    console.log();
  }
}

main().catch(console.error);
