# Contributing to Ticketless

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/YOUR_USERNAME/ticketless.git
cd ticketless
npm install
npm run typecheck   # verify TypeScript compiles
npm test            # run test suite
```

## Making Changes

1. **Fork** the repo and create a branch from `main`
2. Write your code — make sure `npm run typecheck` and `npm test` pass
3. If you add a feature, add tests for it
4. Submit a PR with a clear description of what changed and why

## Building Adapters

The most impactful contributions are new adapters. See the [adapter guide](#writing-a-tool-adapter) below.

### Writing a Tool Adapter

Implement the `Tool` interface:

```typescript
import type { Tool, ToolDefinition } from "ticketless";

export class MyTool implements Tool {
  readonly definition: ToolDefinition = {
    name: "my_tool",
    description: "What this tool does — the LLM reads this to decide when to use it",
    parameters: {
      param1: { type: "string", description: "What this param is", required: true },
    },
  };

  async execute(args: Record<string, unknown>): Promise<unknown> {
    // Your logic here — query an API, database, etc.
    return { result: "data" };
  }
}
```

Key guidelines for tool adapters:
- **Description matters** — the LLM decides which tools to call based on the description
- **Return structured data** — objects/arrays, not formatted strings
- **Validate inputs** — don't trust args blindly
- **Handle errors** — throw with a clear message, the agent will log it

### Writing a Ticket Source

Implement the `TicketSource` interface:

```typescript
import type { TicketSource, Ticket } from "ticketless";

export class MySource implements TicketSource {
  readonly name = "my_source";
  async poll(): Promise<Ticket[]> { /* ... */ }
  async reply(ticketId: string, message: string): Promise<void> { /* ... */ }
  async escalate(ticketId: string, reason: string): Promise<void> { /* ... */ }
  async markResolved(ticketId: string): Promise<void> { /* ... */ }
}
```

### Writing an LLM Provider

Implement the `LLMProvider` interface:

```typescript
import type { LLMProvider, LLMMessage, LLMResponse } from "ticketless";

export class MyProvider implements LLMProvider {
  readonly name = "my_llm";
  async chat(messages: LLMMessage[]): Promise<LLMResponse> { /* ... */ }
}
```

## Code Style

- TypeScript strict mode — no `any`, no implicit returns
- No comments unless the "why" is non-obvious
- Keep dependencies minimal
- Prefer explicit over clever

## Reporting Issues

- Use the GitHub issue templates
- Include reproduction steps
- Include your Node.js version and OS

## License

By contributing, you agree your contributions are licensed under the MIT License.
