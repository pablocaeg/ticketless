// Core
export { Agent } from "./core/agent.js";
export { TicketlessServer } from "./core/server.js";
export { InMemoryAuditLog } from "./core/audit.js";
export { FileAuditLog } from "./core/audit-persistent.js";
export { ConfidenceGate } from "./core/gate.js";
export { TicketQueue } from "./core/queue.js";
export { ReviewQueue } from "./core/review.js";
export { EventBus } from "./core/events.js";
export { validateTicket } from "./core/validator.js";
export { groundConfidence } from "./core/confidence.js";
export { buildLLM, buildSources, buildTools, buildEscalationRules } from "./core/config.js";

// Errors
export {
  TicketlessError,
  ToolError,
  ToolNotFoundError,
  LLMError,
  ValidationError,
  ConfigError,
  DatabaseError,
} from "./core/errors.js";

// LLM Providers
export { ClaudeProvider } from "./adapters/llm/claude.js";
export { OpenAIProvider } from "./adapters/llm/openai.js";
export { OllamaProvider } from "./adapters/llm/ollama.js";

// Tools
export { PostgresLookupTool } from "./adapters/tools/postgres.js";
export { MySQLLookupTool } from "./adapters/tools/mysql.js";
export { StripeLookupTool } from "./adapters/tools/stripe.js";
export { HttpApiTool } from "./adapters/tools/http-api.js";

// Ticket Sources
export { WebhookSource } from "./adapters/sources/webhook.js";
export { ZendeskSource } from "./adapters/sources/zendesk.js";
export { IntercomSource } from "./adapters/sources/intercom.js";
export { FreshdeskSource } from "./adapters/sources/freshdesk.js";

// Types
export type {
  Ticket,
  TicketResolution,
  ToolDefinition,
  ToolResult,
  AuditEntry,
  AgentConfig,
  EscalationRule,
  LLMMessage,
  LLMResponse,
  AgentPlan,
  AgentSynthesis,
  PlannedStep,
  ToolParameter,
} from "./types.js";

export type {
  TicketSource,
  Tool,
  LLMProvider,
  AuditLog,
  ResponseGate,
  GateResult,
} from "./core/interfaces.js";

export type {
  TicketlessConfig,
  LLMConfig,
  SourceConfig,
  ToolConfig,
} from "./core/config.js";

export type { ReviewItem } from "./core/review.js";
export type { QueuedTicket } from "./core/queue.js";
export type { TicketlessEvents } from "./core/events.js";
