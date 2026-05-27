import type {
  Ticket,
  TicketResolution,
  ToolResult,
  AgentConfig,
  AgentPlan,
  AgentSynthesis,
} from "../types.js";
import type { Tool, LLMProvider, AuditLog, ResponseGate } from "./interfaces.js";
import { EventBus } from "./events.js";
import { ToolNotFoundError } from "./errors.js";
import { groundConfidence } from "./confidence.js";
import { buildPlanPrompt, buildSynthesisPrompt, buildReplyPrompt } from "./prompts.js";

const DEFAULT_CONFIG: AgentConfig = {
  confidenceThreshold: 0.75,
  maxToolCalls: 10,
  maxInvestigationRounds: 3,
  escalationRules: [],
};

export class Agent {
  private tools: Map<string, Tool> = new Map();
  readonly events = new EventBus();

  constructor(
    private llm: LLMProvider,
    private auditLog: AuditLog,
    private gate: ResponseGate,
    private config: AgentConfig = DEFAULT_CONFIG
  ) {}

  get audit(): AuditLog {
    return this.auditLog;
  }

  registerTool(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  getTools(): Tool[] {
    return [...this.tools.values()];
  }

  async init(): Promise<void> {
    for (const tool of this.tools.values()) {
      if (tool.init) await tool.init();
    }
  }

  async destroy(): Promise<void> {
    for (const tool of this.tools.values()) {
      if (tool.destroy) await tool.destroy();
    }
    this.events.removeAllListeners();
  }

  async resolve(ticket: Ticket): Promise<TicketResolution> {
    const startTime = Date.now();
    const allFindings: ToolResult[] = [];
    let totalToolCalls = 0;

    this.appendAudit(ticket.id, "received", `Ticket received: ${ticket.subject}`, {
      source: ticket.source,
      customerEmail: ticket.customerEmail,
    });

    this.events.emit("ticket:received", { ticket });

    try {
      for (let round = 0; round < this.config.maxInvestigationRounds; round++) {
        const plan = await this.plan(ticket, allFindings);

        this.appendAudit(ticket.id, "planning", `Round ${round + 1}: ${plan.reasoning}`, {
          steps: plan.steps.map((s) => `${s.tool}(${JSON.stringify(s.args)})`),
        });

        const roundFindings = await this.investigate(ticket, plan, totalToolCalls);
        allFindings.push(...roundFindings);
        totalToolCalls += roundFindings.length;

        const synthesis = await this.synthesize(ticket, allFindings);

        if (!synthesis.needsMoreInvestigation) {
          return this.buildResolution(ticket, synthesis, allFindings, startTime);
        }

        this.appendAudit(ticket.id, "investigating",
          `Needs more investigation: ${synthesis.reasoning}`);
      }

      return this.escalate(
        ticket,
        `Reached max investigation rounds (${this.config.maxInvestigationRounds})`,
        allFindings,
        startTime
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.appendAudit(ticket.id, "error", `Agent error: ${error.message}`);
      this.events.emit("ticket:error", { ticket, error });
      return this.escalate(ticket, `Agent error: ${error.message}`, allFindings, startTime);
    }
  }

  private async plan(ticket: Ticket, priorFindings: ToolResult[]): Promise<AgentPlan> {
    const toolDefs = [...this.tools.values()].map((t) => t.definition);
    const prompt = buildPlanPrompt(ticket, toolDefs, priorFindings);
    const response = await this.llm.chat(prompt);
    return parsePlan(response.content);
  }

  private async investigate(
    ticket: Ticket,
    plan: AgentPlan,
    currentToolCalls: number
  ): Promise<ToolResult[]> {
    const findings: ToolResult[] = [];

    for (const step of plan.steps) {
      if (currentToolCalls + findings.length >= this.config.maxToolCalls) {
        this.appendAudit(ticket.id, "investigating",
          `Hit tool call limit (${this.config.maxToolCalls})`);
        break;
      }

      const result = await this.executeTool(ticket.id, step.tool, step.args);
      findings.push(result);
    }

    return findings;
  }

  private async executeTool(
    ticketId: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    const startTime = Date.now();

    if (!tool) {
      const result: ToolResult = {
        tool: toolName,
        args,
        result: null,
        durationMs: Date.now() - startTime,
        error: new ToolNotFoundError(toolName).message,
      };
      this.appendAudit(ticketId, "tool_call", `Tool not found: ${toolName}`, result);
      this.events.emit("tool:called", { ticketId, result });
      return result;
    }

    try {
      const output = await tool.execute(args);
      const result: ToolResult = {
        tool: toolName,
        args,
        result: output,
        durationMs: Date.now() - startTime,
      };
      this.appendAudit(ticketId, "tool_call",
        `${toolName}(${JSON.stringify(args)}) completed in ${result.durationMs}ms`, result);
      this.events.emit("tool:called", { ticketId, result });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result: ToolResult = {
        tool: toolName,
        args,
        result: null,
        durationMs: Date.now() - startTime,
        error: message,
      };
      this.appendAudit(ticketId, "tool_call",
        `${toolName}(${JSON.stringify(args)}) failed: ${message}`, result);
      this.events.emit("tool:called", { ticketId, result });
      return result;
    }
  }

  private async synthesize(ticket: Ticket, findings: ToolResult[]): Promise<AgentSynthesis> {
    this.appendAudit(ticket.id, "synthesizing", "Synthesizing findings");
    const prompt = buildSynthesisPrompt(ticket, findings);
    const response = await this.llm.chat(prompt);
    const raw = parseSynthesis(response.content);

    // Ground the LLM's self-reported confidence against objective evidence
    const { adjustedConfidence, checks } = groundConfidence(raw, findings);

    if (adjustedConfidence !== raw.confidence) {
      this.appendAudit(ticket.id, "synthesizing",
        `Confidence adjusted: ${raw.confidence} → ${adjustedConfidence} (${checks.filter((c) => !c.passed).map((c) => c.name).join(", ")})`,
        { checks }
      );
    }

    return { ...raw, confidence: adjustedConfidence };
  }

  private async buildResolution(
    ticket: Ticket,
    synthesis: AgentSynthesis,
    findings: ToolResult[],
    startTime: number
  ): Promise<TicketResolution> {
    for (const rule of this.config.escalationRules) {
      if (rule.condition(ticket, findings)) {
        return this.escalate(ticket, rule.reason, findings, startTime);
      }
    }

    if (synthesis.confidence < this.config.confidenceThreshold) {
      return this.escalate(
        ticket,
        `Confidence ${synthesis.confidence} below threshold ${this.config.confidenceThreshold}`,
        findings,
        startTime
      );
    }

    const replyPrompt = buildReplyPrompt(ticket, synthesis);
    const replyResponse = await this.llm.chat(replyPrompt);

    const resolution: TicketResolution = {
      ticketId: ticket.id,
      action: "reply",
      reply: replyResponse.content,
      confidence: synthesis.confidence,
      investigationSummary: synthesis.reasoning,
      toolsUsed: findings.map((f) => f.tool),
      durationMs: Date.now() - startTime,
    };

    const gateResult = this.gate.shouldAutoReply(ticket, resolution);
    if (!gateResult.approved) {
      return this.escalate(ticket, `Gate blocked: ${gateResult.reason}`, findings, startTime);
    }

    this.appendAudit(ticket.id, "responding",
      `Auto-reply sent (confidence: ${synthesis.confidence})`);
    this.events.emit("ticket:resolved", { ticket, resolution });

    return resolution;
  }

  private escalate(
    ticket: Ticket,
    reason: string,
    findings: ToolResult[],
    startTime: number
  ): TicketResolution {
    this.appendAudit(ticket.id, "escalating", reason);

    const resolution: TicketResolution = {
      ticketId: ticket.id,
      action: "escalate",
      escalationReason: reason,
      confidence: 0,
      investigationSummary: findings.length > 0
        ? `Investigated with ${findings.length} tool calls before escalating`
        : "Escalated without investigation",
      toolsUsed: findings.map((f) => f.tool),
      durationMs: Date.now() - startTime,
    };

    this.events.emit("ticket:escalated", { ticket, resolution });
    return resolution;
  }

  private appendAudit(
    ticketId: string,
    step: AuditEntry["step"],
    detail: string,
    data?: unknown
  ): void {
    const entry = { ticketId, timestamp: new Date(), step, detail, data };
    this.auditLog.append(entry);
    this.events.emit("audit:entry", { entry });
  }
}

// --- Parsing helpers (private to this module) ---

import type { AuditEntry } from "../types.js";

function parsePlan(raw: string): AgentPlan {
  try {
    const json = extractJSON(raw);
    const parsed = JSON.parse(json);
    return {
      reasoning: String(parsed.reasoning ?? ""),
      steps: Array.isArray(parsed.steps)
        ? parsed.steps.map((s: Record<string, unknown>) => ({
            tool: String(s.tool ?? ""),
            args: (s.args && typeof s.args === "object" ? s.args : {}) as Record<string, unknown>,
            purpose: String(s.purpose ?? ""),
          }))
        : [],
    };
  } catch {
    return { reasoning: "Failed to parse plan", steps: [] };
  }
}

function parseSynthesis(raw: string): AgentSynthesis {
  try {
    const json = extractJSON(raw);
    const parsed = JSON.parse(json);
    return {
      answer: String(parsed.answer ?? ""),
      confidence: clamp(Number(parsed.confidence ?? 0), 0, 1),
      reasoning: String(parsed.reasoning ?? ""),
      needsMoreInvestigation: Boolean(parsed.needsMoreInvestigation ?? false),
      nextSteps: parsed.nextSteps,
    };
  } catch {
    return {
      answer: "",
      confidence: 0,
      reasoning: "Failed to parse synthesis",
      needsMoreInvestigation: false,
    };
  }
}

function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  const braced = text.match(/\{[\s\S]*\}/);
  if (braced) return braced[0];

  return text;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
