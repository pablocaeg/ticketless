# Ticketless

Self-hosted AI agent that autonomously resolves customer support tickets.

Not a chatbot with canned replies — an agent that connects to your systems, investigates the customer's specific issue, identifies the root cause, and writes a personalized response.

Plug in your ticketing system (Zendesk, Intercom, Freshdesk), your data sources (Postgres, Stripe, any API), and your preferred LLM (Claude, GPT, Ollama). Ticketless handles the rest.

---

## How It Works

Ticketless uses a **Reasoning → Action → Observation** loop. A frontier LLM (Claude, GPT-4o) acts as the brain — it reads the ticket, decides what to investigate, analyzes what it finds, and writes the reply. The framework orchestrates tool execution, validates confidence, and enforces safety gates.

```
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │                           TICKETLESS AGENT LOOP                             │
 │                                                                             │
 │  ┌─────────┐      ┌──────────────┐      ┌──────────────┐      ┌─────────┐  │
 │  │ RECEIVE │─────▶│     PLAN     │─────▶│ INVESTIGATE  │─────▶│SYNTHESIZE│ │
 │  │         │      │              │      │              │      │         │  │
 │  │ Ticket  │      │ LLM reads    │      │ Execute the  │      │ LLM     │  │
 │  │ arrives │      │ ticket +     │      │ planned tool │      │ analyzes │  │
 │  │ via API │      │ available    │      │ calls against│      │ all tool │  │
 │  │ webhook │      │ tools and    │      │ your real    │      │ results  │  │
 │  │ or poll │      │ decides what │      │ systems      │      │ and      │  │
 │  │         │      │ to query     │      │              │      │ assigns  │  │
 │  │         │      │              │      │ - Database   │      │ a conf.  │  │
 │  │         │      │ Returns:     │      │ - Billing    │      │ score    │  │
 │  │         │      │ tool calls   │      │ - Logs       │      │          │  │
 │  │         │      │ with args    │      │ - Docs       │      │ 0.0─1.0  │  │
 │  └─────────┘      └──────────────┘      └──────────────┘      └────┬────┘  │
 │                         ▲                                          │        │
 │                         │         ┌──────────────────┐             │        │
 │                         └─────────│  NEEDS MORE      │◀── no ─────┤        │
 │                                   │  INVESTIGATION?  │             │        │
 │                                   └──────────────────┘        yes ─┘        │
 │                                                                             │
 │  ┌──────────────────────────────────────────────────────────────────────┐   │
 │  │                        SAFETY GATES                                  │   │
 │  │                                                                      │   │
 │  │  1. Confidence Grounding                                             │   │
 │  │     LLM says 95% confident but no tools returned data?               │   │
 │  │     → Adjusted to 35%. Cannot hallucinate confidence.                │   │
 │  │                                                                      │   │
 │  │  2. Confidence Threshold                                             │   │
 │  │     Score below your threshold (default 0.75)?                       │   │
 │  │     → Escalate to human. Never sends a reply it's unsure about.      │   │
 │  │                                                                      │   │
 │  │  3. Keyword Gate                                                     │   │
 │  │     Ticket mentions "refund", "legal", "cancel"?                     │   │
 │  │     → Always escalates. Configurable blocklist.                      │   │
 │  │                                                                      │   │
 │  │  4. Escalation Rules                                                 │   │
 │  │     Custom business logic (e.g., enterprise customers always human)   │   │
 │  │     → Checked before every auto-reply.                               │   │
 │  └──────────────────────────────────────────────────────────────────────┘   │
 │                                                                             │
 │                              passes all gates                               │
 │                                    │                                        │
 │                                    ▼                                        │
 │                        ┌──────────────────────┐                             │
 │                        │    COMPOSE REPLY      │                            │
 │                        │                       │                            │
 │                        │  LLM writes a         │                            │
 │                        │  customer-facing       │                            │
 │                        │  response using the    │                            │
 │                        │  actual data found     │                            │
 │                        └───────────┬───────────┘                            │
 │                                    │                                        │
 │                                    ▼                                        │
 │                        ┌──────────────────────┐                             │
 │                        │  DELIVER              │                            │
 │                        │  → Auto-reply         │                            │
 │                        │  → Or: Review queue   │                            │
 │                        │  → Or: Escalate       │                            │
 │                        └──────────────────────┘                             │
 └──────────────────────────────────────────────────────────────────────────────┘

 Every step is recorded in the audit trail.
```

### Concrete Example

A customer writes: *"I can't log into my account."*

| Step | What happens | Who does it |
|------|-------------|-------------|
| **1. Receive** | Ticket arrives from Zendesk via polling | Framework |
| **2. Plan** | LLM reads the ticket and sees `user_lookup`, `search_logs`, `search_docs` are available. Decides: "look up the user by email, then check auth logs." | LLM (Claude/GPT) |
| **3. Investigate** | Framework calls `user_lookup(email: "alice@co.com")` against your Postgres DB. Returns: `{status: "locked", failedAttempts: 5, lockoutExpires: "15min"}` | Framework → Your DB |
| **4. Investigate** | Framework calls `search_logs(userId: "usr_001", service: "auth")`. Returns: 3 failed login entries. | Framework → Your logs |
| **5. Synthesize** | LLM sees: account is locked, 5 failed attempts, lockout in 15 min. Says: confidence 0.92, root cause clear. | LLM |
| **6. Ground** | Framework validates: 2 tools called, both returned data, answer is substantive. Confidence stays at 0.92. | Framework |
| **7. Gate** | 0.92 > 0.75 threshold, no blocked keywords. Passes. | Framework |
| **8. Reply** | LLM writes: *"Your account is temporarily locked after multiple failed login attempts. It'll unlock in ~15 minutes, or you can reset your password now."* | LLM |
| **9. Deliver** | Framework sends the reply back through Zendesk and marks the ticket as solved. | Framework → Zendesk |

Total time: 3-8 seconds. Total LLM calls: 3 (plan, synthesize, reply). The customer gets a specific, accurate answer — not a generic "have you tried restarting?"

### What the LLM Never Does

- **Never executes code** — the LLM plans, the framework executes
- **Never touches your database directly** — all queries go through parameterized, read-only adapters with table allowlists
- **Never sends a reply without passing safety gates** — confidence grounding + threshold + keyword blocking + custom rules
- **Never sees more data than necessary** — tools return scoped results, not full table dumps

---

## Features

- **Multi-provider** — works with any ticketing system, any database, any LLM
- **Pluggable adapters** — Zendesk, Intercom, Freshdesk, Postgres, MySQL, Stripe, custom APIs
- **LLM-agnostic** — Claude, GPT, Ollama, or any OpenAI-compatible endpoint
- **Confidence grounding** — prevents the LLM from hallucinating certainty
- **Human review queue** — approve, edit, or reject replies before sending
- **Async processing** — ticket queue with configurable concurrency
- **Full audit trail** — every investigation step logged and queryable
- **Dashboard** — web UI with live stats, ticket history, and review workflow
- **Self-hosted** — your infrastructure, your data, your rules

## Quick Start

```bash
npm install ticketless
```

### Try it locally (no API key needed)

```bash
npx tsx examples/basic-usage.ts
```

### Run with a real LLM

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx ticketless demo
```

Runs 4 realistic ticket scenarios with a mock SaaS dataset so you can see the agent investigate and resolve issues in your terminal.

### Start the server

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx ticketless
```

Open `http://localhost:3100/dashboard` for the web UI.

## How a Startup Uses This

1. **Pick your stack** — Ticketless adapts to whatever you already use
2. **Configure in one file** — connect your ticketing system, database, and LLM
3. **Start in review mode** — human approves every reply until you trust the agent
4. **Increase autonomy** — raise the confidence threshold gradually
5. **Monitor** — dashboard shows resolution rate, response times, escalations

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
  reviewMode: true,
  pollIntervalMs: 30_000,
});

server.start();
```

See [`examples/startup-setup.ts`](examples/startup-setup.ts) for a fully commented version.

## Supported Providers

### Ticket Sources

| Provider | Config | What It Does |
|----------|--------|--------------|
| **Zendesk** | `{ type: "zendesk", subdomain, email, apiToken }` | Polls new tickets, replies, escalates with internal notes |
| **Intercom** | `{ type: "intercom", accessToken }` | Searches conversations, replies, assigns on escalation |
| **Freshdesk** | `{ type: "freshdesk", domain, apiKey }` | Polls open tickets, replies, adds private notes |
| **Webhook** | `{ type: "webhook", port }` | Receives tickets via HTTP POST |

### LLM Providers

| Provider | Config | Notes |
|----------|--------|-------|
| **Claude** | `{ provider: "claude", apiKey }` | Anthropic API — recommended for best quality |
| **OpenAI** | `{ provider: "openai", apiKey }` | GPT-4o and compatible. Set `baseUrl` for proxies |
| **Ollama** | `{ provider: "ollama", model }` | Local models — no API key, no data leaves your machine |

The OpenAI provider works with any OpenAI-compatible API (Together, Groq, vLLM, LiteLLM) via `baseUrl`.

### Data Source Tools

| Tool | Config | What the Agent Can Query |
|------|--------|--------------------------|
| **Postgres** | `{ type: "postgres", connectionString }` | Schema-aware — auto-discovers your tables and columns |
| **MySQL** | `{ type: "mysql", host, user, password, database }` | Schema-aware, parameterized queries, table allowlists |
| **Stripe** | `{ type: "stripe", apiKey }` | Customers, subscriptions, invoices, charges, payment methods |
| **HTTP API** | `{ type: "http", baseUrl, endpoints }` | Any REST API — define endpoints declaratively |

### Building Custom Tools

Any system the agent should query gets a `Tool` adapter:

```typescript
import type { Tool, ToolDefinition } from "ticketless";

class DatadogLogTool implements Tool {
  readonly definition: ToolDefinition = {
    name: "search_logs",
    description: "Search Datadog logs by service, level, or message content",
    parameters: {
      query: { type: "string", description: "Datadog log query", required: true },
      timeRange: { type: "string", description: "e.g., '1h', '24h'" },
    },
  };

  async execute(args: Record<string, unknown>) {
    return datadogClient.logs.search({ query: String(args.query) });
  }
}

agent.registerTool(new DatadogLogTool());
```

The LLM reads your tool's `description` to decide when to use it. Clear descriptions = better investigation.

## Safety & Confidence Grounding

The LLM's self-reported confidence is validated against objective evidence before any reply is sent:

| Check | What It Catches | Action |
|-------|-----------------|--------|
| **No investigation** | LLM claims high confidence without calling any tools | Confidence capped at 0.40 |
| **All tools failed** | Every tool call returned an error | Confidence capped at 0.30 |
| **No data found** | Tools ran but returned empty/not-found results | Confidence capped at 0.35 |
| **Empty answer** | LLM provides no substantive answer | Confidence capped at 0.30 |
| **Overconfidence** | >90% confidence with only 1 tool call | 10% penalty applied |
| **Keyword gate** | Ticket mentions "refund", "legal", etc. | Always escalates |
| **Custom rules** | Your business logic (e.g., enterprise = human) | Always escalates |

This prevents the most dangerous failure mode: the LLM confidently sending a wrong answer when it has no evidence.

## Human Review Queue

In review mode, escalated tickets go to a queue where humans can:

- **Approve** — send the agent's reply as-is
- **Edit & approve** — modify the reply before sending
- **Reject** — handle manually

API:
```bash
GET  /api/review                                    # List queue
POST /api/review/approve  { "ticketId": "..." }     # Approve
POST /api/review/approve  { "ticketId": "...", "editedReply": "..." }  # Edit & send
POST /api/review/reject   { "ticketId": "...", "reason": "..." }       # Reject
```

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ticket` | POST | Submit a ticket for resolution |
| `/api/ticket/status` | GET | Check async processing status |
| `/api/audit` | GET | Query audit trail |
| `/api/resolution` | GET | Get resolution for a ticket |
| `/api/review` | GET | List review queue |
| `/api/review/approve` | POST | Approve a pending review |
| `/api/review/reject` | POST | Reject a pending review |
| `/api/stats` | GET | Aggregate statistics |
| `/health` | GET | Health check |
| `/dashboard` | GET | Web dashboard |

All endpoints support optional Bearer token auth.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TICKETLESS_LLM_PROVIDER` | `claude` | `claude`, `openai`, or `ollama` |
| `TICKETLESS_MODEL` | `claude-sonnet-4-6` | Model name |
| `TICKETLESS_PORT` | `3100` | Server port |
| `TICKETLESS_CONFIDENCE_THRESHOLD` | `0.75` | Auto-reply threshold |
| `ANTHROPIC_API_KEY` | — | Required for Claude |
| `OPENAI_API_KEY` | — | Required for OpenAI |
| `DATABASE_URL` | — | Postgres connection string |

## Docker

```bash
docker build -t ticketless .
docker run -p 3100:3100 -e ANTHROPIC_API_KEY=sk-ant-... ticketless
```

## Architecture

```
src/
├── core/
│   ├── agent.ts              # Reasoning → Action → Observation loop
│   ├── confidence.ts         # Grounded confidence validation
│   ├── server.ts             # HTTP API + dashboard + review endpoints
│   ├── queue.ts              # Async ticket processing with concurrency
│   ├── review.ts             # Human review queue
│   ├── gate.ts               # Confidence threshold + keyword blocking
│   ├── config.ts             # Unified config builders
│   ├── validator.ts          # Input validation
│   ├── events.ts             # Typed event bus
│   ├── errors.ts             # Custom error hierarchy
│   ├── audit.ts              # In-memory audit log
│   ├── audit-persistent.ts   # File-backed audit log
│   ├── prompts.ts            # LLM prompt templates
│   └── interfaces.ts         # Tool, LLMProvider, TicketSource contracts
├── adapters/
│   ├── tools/                # postgres, mysql, stripe, http-api
│   ├── llm/                  # claude, openai, ollama
│   └── sources/              # zendesk, intercom, freshdesk, webhook
├── demo/                     # Demo mode with mock SaaS dataset
├── dashboard/                # Web dashboard UI
└── e2e/                      # End-to-end test suite with scripted LLM
```

## Test Coverage

117 tests across unit, integration, and end-to-end:

- **Agent loop** — resolution, escalation, confidence grounding, event emission
- **Safety gates** — confidence threshold, keyword blocking, grounded confidence
- **Review queue** — approve, edit, reject workflows
- **Async queue** — concurrent processing, graceful shutdown
- **Server** — HTTP routing, auth, validation, all API endpoints
- **E2E** — full ticket resolution through HTTP with scripted LLM and demo tools
- **Config** — provider builder correctness for all adapters

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The most impactful contributions are new adapters.

**Wanted:**
- Jira Service Management / HubSpot / Linear ticket sources
- Datadog / CloudWatch / Sentry data tools
- Slack / Discord notification sinks

## License

MIT
