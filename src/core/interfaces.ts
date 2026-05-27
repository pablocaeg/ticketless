import type {
  Ticket,
  TicketResolution,
  ToolDefinition,
  ToolResult,
  AuditEntry,
  LLMMessage,
  LLMResponse,
} from "../types.js";

export interface TicketSource {
  readonly name: string;
  init?(): Promise<void>;
  destroy?(): Promise<void>;
  poll(): Promise<Ticket[]>;
  reply(ticketId: string, message: string): Promise<void>;
  escalate(ticketId: string, reason: string): Promise<void>;
  markResolved(ticketId: string): Promise<void>;
}

export interface Tool {
  readonly definition: ToolDefinition;
  init?(): Promise<void>;
  destroy?(): Promise<void>;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

export interface LLMProvider {
  readonly name: string;
  chat(messages: LLMMessage[]): Promise<LLMResponse>;
}

export interface AuditLog {
  append(entry: AuditEntry): void;
  getEntries(ticketId: string): AuditEntry[];
  getAllEntries(): AuditEntry[];
}

export interface ResponseGate {
  shouldAutoReply(
    ticket: Ticket,
    resolution: TicketResolution
  ): GateResult;
}

export interface GateResult {
  approved: boolean;
  reason: string;
}
