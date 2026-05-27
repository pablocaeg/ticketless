import type { AgentConfig, EscalationRule } from "../types.js";
import type { LLMProvider, TicketSource, Tool } from "./interfaces.js";
import { ConfigError } from "./errors.js";
import { ClaudeProvider } from "../adapters/llm/claude.js";
import { OpenAIProvider } from "../adapters/llm/openai.js";
import { OllamaProvider } from "../adapters/llm/ollama.js";
import { PostgresLookupTool } from "../adapters/tools/postgres.js";
import { MySQLLookupTool } from "../adapters/tools/mysql.js";
import { StripeLookupTool } from "../adapters/tools/stripe.js";
import { HttpApiTool } from "../adapters/tools/http-api.js";
import { WebhookSource } from "../adapters/sources/webhook.js";
import { ZendeskSource } from "../adapters/sources/zendesk.js";
import { IntercomSource } from "../adapters/sources/intercom.js";
import { FreshdeskSource } from "../adapters/sources/freshdesk.js";

export interface TicketlessConfig {
  llm: LLMConfig;
  sources?: SourceConfig[];
  tools?: ToolConfig[];
  agent?: Partial<AgentConfig>;
  server?: { port?: number; apiKey?: string };
  gate?: { confidenceThreshold?: number; blockedKeywords?: string[] };
  queue?: { concurrency?: number };
}

export type LLMConfig =
  | { provider: "claude"; apiKey: string; model?: string }
  | { provider: "openai"; apiKey: string; model?: string; baseUrl?: string }
  | { provider: "ollama"; model?: string; baseUrl?: string };

export type SourceConfig =
  | { type: "webhook"; port?: number }
  | { type: "zendesk"; subdomain: string; email: string; apiToken: string }
  | { type: "intercom"; accessToken: string }
  | { type: "freshdesk"; domain: string; apiKey: string };

export type ToolConfig =
  | { type: "postgres"; connectionString: string; allowedTables?: string[]; maxRows?: number }
  | { type: "mysql"; host: string; port?: number; user: string; password: string; database: string; allowedTables?: string[]; maxRows?: number }
  | { type: "stripe"; apiKey: string }
  | { type: "http"; name: string; description: string; baseUrl: string; headers?: Record<string, string>; endpoints: Array<{ action: string; method: "GET" | "POST"; path: string; description: string }> };

export function buildLLM(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case "claude":
      return new ClaudeProvider(config.apiKey, config.model);
    case "openai":
      return new OpenAIProvider(config.apiKey, config.model, undefined, config.baseUrl);
    case "ollama":
      return new OllamaProvider(config.model, config.baseUrl);
    default:
      throw new ConfigError(`Unknown LLM provider: ${(config as { provider: string }).provider}`);
  }
}

export function buildSources(configs: SourceConfig[]): TicketSource[] {
  return configs.map((config) => {
    switch (config.type) {
      case "webhook":
        return new WebhookSource(config.port);
      case "zendesk":
        return new ZendeskSource(config);
      case "intercom":
        return new IntercomSource(config);
      case "freshdesk":
        return new FreshdeskSource(config);
      default:
        throw new ConfigError(`Unknown source type: ${(config as { type: string }).type}`);
    }
  });
}

export function buildTools(configs: ToolConfig[]): Tool[] {
  return configs.map((config) => {
    switch (config.type) {
      case "postgres":
        return new PostgresLookupTool(config);
      case "mysql":
        return new MySQLLookupTool(config);
      case "stripe":
        return new StripeLookupTool(config.apiKey);
      case "http":
        return new HttpApiTool(config);
      default:
        throw new ConfigError(`Unknown tool type: ${(config as { type: string }).type}`);
    }
  });
}

export function buildEscalationRules(): EscalationRule[] {
  return [
    {
      name: "sensitive-topic",
      condition: (ticket) => {
        const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
        return /\b(legal|lawsuit|attorney|lawyer|gdpr|compliance|data breach)\b/.test(text);
      },
      reason: "Ticket involves legal/compliance topics — requires human review",
    },
    {
      name: "angry-customer",
      condition: (ticket) => {
        const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
        return /\b(furious|unacceptable|disgusting|worst|scam|fraud|rip.?off)\b/.test(text);
      },
      reason: "Customer appears very upset — routing to human for empathetic handling",
    },
  ];
}
