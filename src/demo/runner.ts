import { Agent } from "../core/agent.js";
import { InMemoryAuditLog } from "../core/audit.js";
import { ConfidenceGate } from "../core/gate.js";
import type { LLMProvider } from "../core/interfaces.js";
import { DEMO_TICKETS } from "./data.js";
import {
  DemoUserLookupTool,
  DemoOrderLookupTool,
  DemoLogSearchTool,
  DemoKnowledgeBaseTool,
} from "./tools.js";
import type { Ticket, TicketResolution, AuditEntry } from "../types.js";

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgRed: "\x1b[41m",
  white: "\x1b[37m",
};

function c(color: keyof typeof COLORS, text: string): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function printHeader(): void {
  console.log();
  console.log(c("bold", "  ╔══════════════════════════════════════════════════╗"));
  console.log(c("bold", "  ║") + c("cyan", "          Ticketless — Demo Mode              ") + c("bold", "  ║"));
  console.log(c("bold", "  ║") + c("dim", "    AI Support Agent resolving live tickets     ") + c("bold", "  ║"));
  console.log(c("bold", "  ╚══════════════════════════════════════════════════╝"));
  console.log();
}

function printTicket(ticket: Ticket, index: number, total: number): void {
  console.log(c("bold", `  ┌─ Ticket ${index + 1}/${total} ─────────────────────────────────────`));
  console.log(c("bold", "  │ ") + c("cyan", `ID:      ${ticket.id}`));
  console.log(c("bold", "  │ ") + c("cyan", `From:    ${ticket.customerEmail}`));
  console.log(c("bold", "  │ ") + c("cyan", `Subject: ${ticket.subject}`));
  console.log(c("bold", "  │ ") + c("dim", `Body:    ${ticket.body.slice(0, 80)}...`));
  console.log(c("bold", "  │"));
}

function printAuditStep(entry: AuditEntry): void {
  const icons: Record<string, string> = {
    received: "📥",
    classifying: "🏷️ ",
    planning: "🧠",
    investigating: "🔍",
    tool_call: "🔧",
    synthesizing: "⚡",
    responding: "✉️ ",
    escalating: "🚨",
    error: "❌",
  };
  const icon = icons[entry.step] ?? "  ";
  const color = entry.step === "error" || entry.step === "escalating" ? "yellow" : "dim";
  console.log(c("bold", "  │ ") + `${icon} ${c(color, `[${entry.step}]`)} ${entry.detail}`);
}

function printResolution(resolution: TicketResolution): void {
  console.log(c("bold", "  │"));

  if (resolution.action === "reply") {
    const badge = `${COLORS.bgGreen}${COLORS.white}${COLORS.bold} RESOLVED ${COLORS.reset}`;
    console.log(c("bold", "  │ ") + badge + c("green", ` confidence: ${resolution.confidence} | ${resolution.durationMs}ms`));
    console.log(c("bold", "  │"));
    console.log(c("bold", "  │ ") + c("bold", "Reply:"));
    for (const line of (resolution.reply ?? "").split("\n")) {
      console.log(c("bold", "  │   ") + c("green", line));
    }
  } else {
    const badge = `${COLORS.bgYellow}${COLORS.white}${COLORS.bold} ESCALATED ${COLORS.reset}`;
    console.log(c("bold", "  │ ") + badge + c("yellow", ` ${resolution.escalationReason}`));
  }

  console.log(c("bold", "  └──────────────────────────────────────────────────"));
  console.log();
}

export async function runDemo(llm: LLMProvider): Promise<void> {
  printHeader();

  const audit = new InMemoryAuditLog();
  const gate = new ConfidenceGate(0.7);

  const agent = new Agent(llm, audit, gate, {
    confidenceThreshold: 0.7,
    maxToolCalls: 10,
    maxInvestigationRounds: 3,
    escalationRules: [],
  });

  agent.registerTool(new DemoUserLookupTool());
  agent.registerTool(new DemoOrderLookupTool());
  agent.registerTool(new DemoLogSearchTool());
  agent.registerTool(new DemoKnowledgeBaseTool());

  console.log(c("dim", `  LLM: ${llm.name}`));
  console.log(c("dim", `  Tools: user_lookup, order_lookup, search_logs, search_docs`));
  console.log(c("dim", `  Tickets: ${DEMO_TICKETS.length} demo scenarios`));
  console.log();

  const results: { ticket: Ticket; resolution: TicketResolution }[] = [];

  for (let i = 0; i < DEMO_TICKETS.length; i++) {
    const ticket = DEMO_TICKETS[i];
    printTicket(ticket, i, DEMO_TICKETS.length);

    const startEntryCount = audit.getAllEntries().length;
    const resolution = await agent.resolve(ticket);

    const newEntries = audit.getAllEntries().slice(startEntryCount);
    for (const entry of newEntries) {
      printAuditStep(entry);
    }

    printResolution(resolution);
    results.push({ ticket, resolution });
  }

  printSummary(results);
}

function printSummary(results: { ticket: Ticket; resolution: TicketResolution }[]): void {
  const resolved = results.filter((r) => r.resolution.action === "reply");
  const escalated = results.filter((r) => r.resolution.action === "escalate");
  const avgTime = Math.round(
    results.reduce((sum, r) => sum + r.resolution.durationMs, 0) / results.length
  );
  const avgConfidence = resolved.length > 0
    ? (resolved.reduce((sum, r) => sum + r.resolution.confidence, 0) / resolved.length).toFixed(2)
    : "N/A";

  console.log(c("bold", "  ══════════════════════════════════════════════════"));
  console.log(c("bold", "  Summary"));
  console.log(c("bold", "  ══════════════════════════════════════════════════"));
  console.log(`  Total tickets:     ${results.length}`);
  console.log(`  Auto-resolved:     ${c("green", String(resolved.length))} (${Math.round((resolved.length / results.length) * 100)}%)`);
  console.log(`  Escalated:         ${c("yellow", String(escalated.length))}`);
  console.log(`  Avg response time: ${avgTime}ms`);
  console.log(`  Avg confidence:    ${avgConfidence}`);
  console.log();
}
