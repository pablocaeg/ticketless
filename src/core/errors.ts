export class TicketlessError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "TicketlessError";
  }
}

export class ToolError extends TicketlessError {
  constructor(toolName: string, message: string, context?: Record<string, unknown>) {
    super(`Tool "${toolName}": ${message}`, "TOOL_ERROR", { toolName, ...context });
    this.name = "ToolError";
  }
}

export class ToolNotFoundError extends TicketlessError {
  constructor(toolName: string) {
    super(`Tool "${toolName}" is not registered`, "TOOL_NOT_FOUND", { toolName });
    this.name = "ToolNotFoundError";
  }
}

export class LLMError extends TicketlessError {
  constructor(provider: string, message: string, public readonly statusCode?: number) {
    super(`LLM "${provider}": ${message}`, "LLM_ERROR", { provider, statusCode });
    this.name = "LLMError";
  }
}

export class ValidationError extends TicketlessError {
  constructor(message: string, public readonly field?: string) {
    super(message, "VALIDATION_ERROR", { field });
    this.name = "ValidationError";
  }
}

export class ConfigError extends TicketlessError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR");
    this.name = "ConfigError";
  }
}

export class DatabaseError extends TicketlessError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "DATABASE_ERROR", context);
    this.name = "DatabaseError";
  }
}
