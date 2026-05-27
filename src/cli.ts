#!/usr/bin/env node
import { Agent } from "./core/agent.js";
import { TicketlessServer } from "./core/server.js";
import { InMemoryAuditLog } from "./core/audit.js";
import { ConfidenceGate } from "./core/gate.js";
import { ClaudeProvider } from "./adapters/llm/claude.js";
import { OpenAIProvider } from "./adapters/llm/openai.js";
import { PostgresLookupTool } from "./adapters/tools/postgres.js";
import type { LLMProvider } from "./core/interfaces.js";

const HELP = `
  Ticketless — AI Support Agent

  Usage:
    ticketless              Start the server
    ticketless demo         Run demo with sample tickets (requires LLM API key)
    ticketless --help       Show this help

  Environment:
    TICKETLESS_LLM_PROVIDER   "claude" (default) or "openai"
    TICKETLESS_MODEL          Model name (default: claude-sonnet-4-6 / gpt-4o)
    TICKETLESS_PORT           Server port (default: 3100)
    TICKETLESS_CONFIDENCE_THRESHOLD  Auto-reply threshold (default: 0.75)
    TICKETLESS_MAX_TOOL_CALLS Max tool calls per ticket (default: 10)
    ANTHROPIC_API_KEY         Required for Claude provider
    OPENAI_API_KEY            Required for OpenAI provider
    DATABASE_URL              Postgres connection string (optional)
    TICKETLESS_ALLOWED_TABLES Comma-separated table allowlist (optional)
`;

function loadLLM(): LLMProvider {
  const provider = process.env.TICKETLESS_LLM_PROVIDER ?? "claude";

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is required when using OpenAI provider");
    return new OpenAIProvider(apiKey, process.env.TICKETLESS_MODEL ?? "gpt-4o");
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required when using Claude provider");
  return new ClaudeProvider(apiKey, process.env.TICKETLESS_MODEL ?? "claude-sonnet-4-6");
}

async function runServer(): Promise<void> {
  const llm = loadLLM();
  const port = parseInt(process.env.TICKETLESS_PORT ?? "3100", 10);
  const confidenceThreshold = parseFloat(process.env.TICKETLESS_CONFIDENCE_THRESHOLD ?? "0.75");
  const maxToolCalls = parseInt(process.env.TICKETLESS_MAX_TOOL_CALLS ?? "10", 10);

  const audit = new InMemoryAuditLog();
  const gate = new ConfidenceGate(confidenceThreshold);

  const agent = new Agent(llm, audit, gate, {
    confidenceThreshold,
    maxToolCalls,
    maxInvestigationRounds: 3,
    escalationRules: [],
  });

  if (process.env.DATABASE_URL) {
    const allowedTables = process.env.TICKETLESS_ALLOWED_TABLES?.split(",").map((t) => t.trim());
    const pgTool = new PostgresLookupTool({
      connectionString: process.env.DATABASE_URL,
      allowedTables,
    });
    agent.registerTool(pgTool);
    console.log(`  Postgres adapter: connected`);
    if (allowedTables) console.log(`  Allowed tables: ${allowedTables.join(", ")}`);
  }

  const server = new TicketlessServer({
    port,
    agent,
    audit,
    sources: [],
  });

  await server.start();

  console.log(`Ticketless — AI Support Agent`);
  console.log(`============================\n`);
  console.log(`  Server listening on http://localhost:${port}`);
  console.log(`  Dashboard:      http://localhost:${port}/dashboard`);
  console.log(`  LLM provider:   ${llm.name}`);
  console.log(`  Confidence:     ${confidenceThreshold}`);
  console.log(`\n  API Endpoints:`);
  console.log(`    POST /api/ticket     — Submit a ticket for resolution`);
  console.log(`    GET  /api/audit      — View audit trail`);
  console.log(`    GET  /api/resolution — Get resolution by ticketId`);
  console.log(`    GET  /health         — Health check`);
  console.log();

  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await server.stop();
    process.exit(0);
  });
}

async function runDemo(): Promise<void> {
  const llm = loadLLM();
  const { runDemo } = await import("./demo/runner.js");
  await runDemo(llm);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }

  if (args[0] === "demo") {
    await runDemo();
    return;
  }

  await runServer();
}

main().catch((err) => {
  console.error("Failed to start:", err.message);
  process.exit(1);
});
