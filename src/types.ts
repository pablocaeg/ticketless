export interface Ticket {
  id: string;
  source: string;
  subject: string;
  body: string;
  customerEmail: string;
  customerId?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface TicketResolution {
  ticketId: string;
  action: "reply" | "escalate";
  reply?: string;
  escalationReason?: string;
  confidence: number;
  investigationSummary: string;
  toolsUsed: string[];
  durationMs: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
}

export interface ToolParameter {
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
}

export interface ToolResult {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
  error?: string;
}

export interface AuditEntry {
  ticketId: string;
  timestamp: Date;
  step: "received" | "classifying" | "planning" | "investigating" | "tool_call" | "synthesizing" | "responding" | "escalating" | "error";
  detail: string;
  data?: unknown;
}

export interface AgentConfig {
  confidenceThreshold: number;
  maxToolCalls: number;
  maxInvestigationRounds: number;
  escalationRules: EscalationRule[];
}

export interface EscalationRule {
  name: string;
  condition: (ticket: Ticket, findings: ToolResult[]) => boolean;
  reason: string;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AgentPlan {
  reasoning: string;
  steps: PlannedStep[];
}

export interface PlannedStep {
  tool: string;
  args: Record<string, unknown>;
  purpose: string;
}

export interface AgentSynthesis {
  answer: string;
  confidence: number;
  reasoning: string;
  needsMoreInvestigation: boolean;
  nextSteps?: PlannedStep[];
}
