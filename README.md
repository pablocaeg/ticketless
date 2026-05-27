# Ticketless

An open-source support agent that actually resolves tickets instead of deflecting them.

Most support tools reply with canned answers. Ticketless connects to your database, your billing system, your logs, looks up the customer's actual data, figures out what went wrong, and writes a reply that solves the problem. If it's not sure, it hands off to a human with all the context attached.

It works with whatever stack you already have. Bring your own ticketing system, database, and LLM.

---

## How it works

When a ticket comes in, Ticketless asks an LLM (Claude, GPT-4o, or a local model) to figure out what to investigate. The LLM picks which tools to call and what arguments to pass. Ticketless runs those queries against your real systems, feeds the results back to the LLM, and asks it to diagnose the problem. If it's confident enough, it writes a reply and sends it. If not, it escalates with everything it found so the human doesn't start from scratch.

Three LLM calls per ticket: one to plan, one to analyze, one to write the reply.

```mermaid
flowchart LR
    T["Ticket"] --> P["LLM plans\nwhat to look up"]
    P --> I["Query your\nsystems"]
    I --> S["LLM analyzes\nfindings"]
    S -->|not sure yet| P
    S -->|confident| G{"Safety\nchecks"}
    G -->|pass| R["Send reply"]
    G -->|fail| E["Escalate\nto human"]

    style T fill:#f4f4f5,stroke:#a1a1aa,color:#18181b
    style P fill:#ede9fe,stroke:#8b5cf6,color:#18181b
    style I fill:#dcfce7,stroke:#22c55e,color:#18181b
    style S fill:#ede9fe,stroke:#8b5cf6,color:#18181b
    style G fill:#fef9c3,stroke:#ca8a04,color:#18181b
    style R fill:#dcfce7,stroke:#22c55e,color:#18181b
    style E fill:#fef9c3,stroke:#ca8a04,color:#18181b
```

The LLM decides *what* to look up. The framework does the looking. The LLM never touches your database directly, never runs code, and never sends a reply without passing safety checks. All queries are parameterized, read-only, and restricted to tables you allow.

---

## Quick start

```bash
npm install ticketless
```

Try it without an API key (uses a mock LLM):

```bash
npx tsx examples/basic-usage.ts
```

Try it with a real LLM:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx ticketless demo
```

This runs four sample tickets against a fake SaaS dataset so you can see the agent investigate and resolve them in your terminal.

Start the server:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx ticketless
```

Dashboard at `http://localhost:3100/dashboard`.

## Setting it up

The idea is you configure everything in one place and Ticketless wires it up:

```typescript
import {
  Agent, TicketlessServer, ConfidenceGate, FileAuditLog,
  buildLLM, buildSources, buildTools, buildEscalationRules,
} from "ticketless";

const llm = buildLLM({ provider: "claude", apiKey: process.env.ANTHROPIC_API_KEY! });

const sources = buildSources([
  { type: "zendesk", subdomain: "mycompany", email: "agent@co.com", apiToken: "..." },
]);

const tools = buildTools([
  { type: "postgres", connectionString: process.env.DATABASE_URL!, allowedTables: ["users", "orders"] },
  { type: "stripe", apiKey: process.env.STRIPE_SECRET_KEY! },
]);

const agent = new Agent(llm, new FileAuditLog("./data/audit.jsonl"), new ConfidenceGate(0.8), {
  confidenceThreshold: 0.8,
  maxToolCalls: 10,
  maxInvestigationRounds: 3,
  escalationRules: buildEscalationRules(),
});

for (const tool of tools) agent.registerTool(tool);

const server = new TicketlessServer({
  port: 3100,
  agent,
  audit: agent.audit,
  sources,
  async: true,
  reviewMode: true,        // human approves everything at first
  pollIntervalMs: 30_000,  // check for new tickets every 30s
});

server.start();
```

There's a fully commented version in [`examples/startup-setup.ts`](examples/startup-setup.ts).

## Supported providers

### Ticket sources

| Provider | Config |
|----------|--------|
| Zendesk | `{ type: "zendesk", subdomain, email, apiToken }` |
| Intercom | `{ type: "intercom", accessToken }` |
| Freshdesk | `{ type: "freshdesk", domain, apiKey }` |
| Webhook | `{ type: "webhook", port }` |

### LLM providers

| Provider | Config | Notes |
|----------|--------|-------|
| Claude | `{ provider: "claude", apiKey }` | Best results in our testing |
| OpenAI | `{ provider: "openai", apiKey }` | Works with any compatible API via `baseUrl` (Groq, Together, vLLM) |
| Ollama | `{ provider: "ollama", model }` | Local models, no API key needed |

### Data source tools

| Tool | What the agent can do with it |
|------|-------------------------------|
| Postgres | Query tables with parameterized WHERE clauses. Auto-discovers your schema on startup. |
| MySQL | Same as Postgres. Requires `mysql2` as a peer dep. |
| Stripe | Look up customers, subscriptions, invoices, charges, payment methods. |
| HTTP API | Call any REST API. You define the endpoints declaratively. |

### Custom tools

Tools are how you give the agent access to your systems. The agent can only see and do what you explicitly expose through tools. This is the most important part of your setup: the tools you define determine how useful the agent is.

#### Writing a tool

```typescript
import type { Tool, ToolDefinition } from "ticketless";

class FeatureFlagTool implements Tool {
  readonly definition: ToolDefinition = {
    name: "check_flags",
    description: "Check which feature flags are enabled for a user",
    parameters: {
      userId: { type: "string", description: "User ID", required: true },
    },
  };

  async execute(args: Record<string, unknown>) {
    return flagService.getFlags(String(args.userId));
  }
}

agent.registerTool(new FeatureFlagTool());
```

#### Using the HTTP API tool

Most of the time you don't need to write a custom class. If you have an existing REST API, use `HttpApiTool` to expose it declaratively:

```typescript
import { HttpApiTool } from "ticketless";

agent.registerTool(
  new HttpApiTool({
    name: "my_api",
    description: "Query the internal scheduling system",
    baseUrl: "http://localhost:3001",
    endpoints: [
      { action: "list_users", method: "GET", path: "/api/users",
        description: "List all staff members with name, role, and ID" },
      { action: "get_schedule", method: "GET", path: "/api/users/:id/schedule",
        description: "Get a user's schedule by name or numeric ID" },
    ],
  })
);
```

Path parameters (`:id`) are replaced automatically from the `params` argument.

#### Real-world example: shift scheduling + compliance

We connected Ticketless to a hospital shift exchange system and a labor compliance engine. Two tools, six endpoints total:

```typescript
// Tool 1: query shifts, schedules, and open exchanges
agent.registerTool(new HttpApiTool({
  name: "shift_exchange",
  baseUrl: "http://localhost:3001",
  description: "Hospital shift exchange system",
  endpoints: [
    { action: "list_users", method: "GET", path: "/api/users",
      description: "List all staff members" },
    { action: "get_schedule", method: "GET", path: "/api/users/:id/schedule",
      description: "Get a user's shift schedule by name or ID" },
    { action: "list_exchanges", method: "GET", path: "/api/exchanges",
      description: "List open shift exchange requests" },
  ],
}));

// Tool 2: validate shift changes against labor law
agent.registerTool(new HttpApiTool({
  name: "shift_comply",
  baseUrl: "http://localhost:8080",
  description: "Labor regulation compliance engine",
  endpoints: [
    { action: "get_rules", method: "GET", path: "/rules",
      description: "Get rules for a jurisdiction (ES, US, DE, etc.)" },
    { action: "validate_swap", method: "POST", path: "/validate-swap",
      description: "Check if a proposed shift swap is legal" },
  ],
}));
```

A nurse asks "Can I swap my morning shift for a night shift?". The agent looks up their schedule, finds a matching night shift, validates the swap against Spanish labor law, and replies with the specific legal constraint that prevents it (12h minimum rest between shifts, Article 34.3 of the Workers' Statute). No custom code beyond the tool definitions.

See [`examples/shift-exchange-server.ts`](examples/shift-exchange-server.ts) for the full working setup.

#### Lessons from building this

1. **Tool descriptions matter more than you think.** The LLM decides which tool to call based entirely on the `description` field. "Get a user's schedule by name or ID" works much better than "Get user schedule" because the LLM knows it can pass a name instead of requiring a numeric ID.

2. **Accept names, not just IDs.** If your API only accepts numeric IDs, the LLM has to call `list_users` first to resolve the name, then call `get_schedule` with the ID. That's two tool calls instead of one. If your endpoint accepts both (`/api/users/Alice/schedule` or `/api/users/1/schedule`), the agent is faster and the investigation steps look cleaner to the user.

3. **Keep tools read-only for support.** The agent should investigate, not mutate. Expose GET endpoints and validation endpoints. Don't give it the ability to delete records or execute transactions. If an action is needed, the agent should tell the user what to do or escalate to a human.

4. **You don't always need a custom tool class.** `HttpApiTool` covers most REST APIs. Write a custom `Tool` class only when you need to transform data, handle auth tokens, or interact with non-HTTP systems (message queues, gRPC, etc.).

5. **Use escalation rules for compliance-critical results.** If one of your tools returns a compliance violation, don't let the agent auto-reply. Add an escalation rule that routes it to a human reviewer:

```typescript
const agent = new Agent(llm, audit, gate, {
  escalationRules: [{
    name: "compliance-violation",
    condition: (_ticket, findings) =>
      findings.some(f => f.result?.result === "fail"),
    reason: "Compliance violation detected — requires human review",
  }],
});
```

### Embeddable chat widget

Drop a single script tag into any website to add a support chat:

```html
<script src="https://your-server/widget.js"
  data-server="https://your-server"
  data-title="Acme Support"
  data-subtitle="We reply instantly"
  data-accent="#2563eb"
  data-logo="https://acme.com/logo.png"
  data-greeting="Hi! How can we help?"
  data-placeholder="Ask a question..."
  data-user-name="Alice"
  data-user-email="alice@acme.com"
  data-presets="Check my order|Reset password|Billing question"
  data-position="right"
></script>
```

Zero dependencies, no framework needed. The widget connects directly to your Ticketless server, shows live investigation steps with animations, and renders markdown in responses. Customize the accent color, logo, greeting, and preset questions to match your brand.

For deeper integration with React or other frameworks (e.g., reading user context from your app state), see the [`SupportChat.tsx` example](examples/shift-exchange-server.ts) in the shift-exchange demo.

## Safety

The LLM assigns itself a confidence score, but we don't trust it blindly. Before any reply goes out, the framework checks the score against what actually happened during investigation:

| Situation | What happens |
|-----------|--------------|
| LLM says 95% confident but called zero tools | Capped to 40% |
| Every tool call returned an error | Capped to 30% |
| Tools ran but found nothing | Capped to 35% |
| LLM gave an empty answer | Capped to 30% |
| Very high confidence with only one tool call | 10% penalty |
| Ticket mentions "refund", "legal", etc. | Always escalates regardless of confidence |
| Custom business rules (e.g., enterprise customers) | Always escalates |

This stops the worst failure mode: the model confidently sending a wrong answer when it didn't actually find anything.

## Human review

You can start in review mode where every escalated ticket goes to a queue. Humans can approve the agent's draft, edit it before sending, or reject it entirely. Over time, as you trust the agent more, you raise the confidence threshold and let more through automatically.

```bash
GET  /api/review                                      # see the queue
POST /api/review/approve  { "ticketId": "..." }       # send as-is
POST /api/review/approve  { "ticketId": "...", "editedReply": "..." }
POST /api/review/reject   { "ticketId": "...", "reason": "..." }
```

## API

| Endpoint | Method | What it does |
|----------|--------|-------------|
| `/api/ticket` | POST | Submit a ticket |
| `/api/ticket/status` | GET | Check processing status (for async mode) |
| `/api/audit` | GET | Full audit trail, optionally filtered by ticket |
| `/api/resolution` | GET | Resolution details for a ticket |
| `/api/review` | GET | Review queue |
| `/api/review/approve` | POST | Approve a review item |
| `/api/review/reject` | POST | Reject a review item |
| `/api/stats` | GET | Aggregate stats |
| `/health` | GET | Health check |
| `/dashboard` | GET | Web UI |

All endpoints support Bearer token auth if you set an API key.

## Configuration

| Variable | Default | |
|----------|---------|---|
| `TICKETLESS_LLM_PROVIDER` | `claude` | `claude`, `openai`, or `ollama` |
| `TICKETLESS_MODEL` | `claude-sonnet-4-6` | Model to use |
| `TICKETLESS_PORT` | `3100` | Server port |
| `TICKETLESS_CONFIDENCE_THRESHOLD` | `0.75` | Minimum confidence to auto-reply |
| `ANTHROPIC_API_KEY` | | Required for Claude |
| `OPENAI_API_KEY` | | Required for OpenAI |
| `DATABASE_URL` | | Postgres connection string |

## Docker

```bash
docker build -t ticketless .
docker run -p 3100:3100 -e ANTHROPIC_API_KEY=sk-ant-... ticketless
```

## Project structure

```
src/
├── core/
│   ├── agent.ts              # The investigation loop
│   ├── confidence.ts         # Validates confidence against evidence
│   ├── server.ts             # HTTP server, API routes, dashboard
│   ├── queue.ts              # Async ticket processing
│   ├── review.ts             # Human review queue
│   ├── gate.ts               # Confidence + keyword checks
│   ├── config.ts             # Config builders for all providers
│   ├── validator.ts          # Input validation
│   ├── events.ts             # Typed event bus
│   ├── errors.ts             # Error types
│   ├── audit.ts              # In-memory audit log
│   ├── audit-persistent.ts   # File-backed audit log
│   ├── prompts.ts            # Prompt templates
│   └── interfaces.ts         # Tool, LLMProvider, TicketSource contracts
├── adapters/
│   ├── tools/                # postgres, mysql, stripe, http-api
│   ├── llm/                  # claude, openai, ollama
│   └── sources/              # zendesk, intercom, freshdesk, webhook
├── demo/                     # Demo mode with sample data
├── dashboard/                # Web UI
└── e2e/                      # End-to-end tests
```

## Tests

117 tests covering the agent loop, confidence grounding, safety gates, review queue, async processing, HTTP API, input validation, and full end-to-end flows through the server.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

Adapters are the easiest way to contribute. Some ideas: Jira Service Management, HubSpot, Linear, Datadog, CloudWatch, Sentry, Slack notifications.

## License

MIT
