/**
 * Basic usage example — run with: npx tsx examples/basic-usage.ts
 *
 * Demonstrates the core agent loop with a mock LLM and a custom tool.
 * No external services needed.
 */

import {
  Agent,
  InMemoryAuditLog,
  ConfidenceGate,
  type LLMProvider,
  type LLMMessage,
  type LLMResponse,
  type Tool,
  type ToolDefinition,
  type Ticket,
} from "../src/index.js";

// --- Mock LLM that simulates the agent's reasoning ---
class MockLLM implements LLMProvider {
  readonly name = "mock";
  private callCount = 0;

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    this.callCount++;
    const lastMessage = messages[messages.length - 1].content;

    // First call: planning — the agent decides what tools to call
    if (lastMessage.includes("Plan your next investigation steps")) {
      return {
        content: JSON.stringify({
          reasoning: "Customer reports they can't log in. Let me look up their account status.",
          steps: [
            {
              tool: "user_lookup",
              args: { email: "alice@example.com" },
              purpose: "Check if account exists and its current status",
            },
          ],
        }),
      };
    }

    // Second call: synthesis — analyzing what the tools found
    if (lastMessage.includes("Synthesize these findings")) {
      return {
        content: JSON.stringify({
          answer: "The user's account is locked due to too many failed login attempts. The lockout expires in 15 minutes.",
          confidence: 0.92,
          reasoning: "Found clear account status: locked_too_many_attempts, with a lockout expiry timestamp",
          needsMoreInvestigation: false,
        }),
      };
    }

    // Third call: composing the customer reply
    return {
      content: `Hi Alice,

Your account is temporarily locked because of multiple failed login attempts — this is a security measure to protect your account.

The lockout will automatically lift in about 15 minutes. After that, you'll be able to log in normally.

If you've forgotten your password, you can reset it at any time using the "Forgot Password" link on the login page.

Let me know if you need anything else!

Best,
Support Team`,
    };
  }
}

// --- Custom tool: a fake user database lookup ---
class UserLookupTool implements Tool {
  readonly definition: ToolDefinition = {
    name: "user_lookup",
    description: "Look up a user by email address to check their account status",
    parameters: {
      email: {
        type: "string",
        description: "The user's email address",
        required: true,
      },
    },
  };

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const email = String(args.email);

    // Simulated database
    const users: Record<string, unknown> = {
      "alice@example.com": {
        id: "usr_123",
        email: "alice@example.com",
        name: "Alice Johnson",
        plan: "pro",
        status: "locked_too_many_attempts",
        lockoutExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        lastLoginAttempt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        failedAttempts: 5,
      },
    };

    const user = users[email];
    if (!user) return { found: false, email };
    return { found: true, ...user as object };
  }
}

// --- Run the example ---
async function main() {
  const audit = new InMemoryAuditLog();
  const gate = new ConfidenceGate(0.75);
  const llm = new MockLLM();

  const agent = new Agent(llm, audit, gate, {
    confidenceThreshold: 0.75,
    maxToolCalls: 10,
    maxInvestigationRounds: 3,
    escalationRules: [],
  });

  agent.registerTool(new UserLookupTool());

  const ticket: Ticket = {
    id: "ticket-001",
    source: "email",
    subject: "Can't log into my account",
    body: "Hi, I've been trying to log in for the past 10 minutes but it keeps saying my credentials are wrong. I'm sure I'm using the right password. Can you help?",
    customerEmail: "alice@example.com",
    metadata: {},
    createdAt: new Date(),
  };

  console.log("Submitting ticket...\n");
  console.log(`  Subject: ${ticket.subject}`);
  console.log(`  From: ${ticket.customerEmail}\n`);

  const resolution = await agent.resolve(ticket);

  console.log("--- Resolution ---");
  console.log(`  Action: ${resolution.action}`);
  console.log(`  Confidence: ${resolution.confidence}`);
  console.log(`  Tools used: ${resolution.toolsUsed.join(", ")}`);
  console.log(`  Duration: ${resolution.durationMs}ms`);

  if (resolution.reply) {
    console.log(`\n--- Reply ---\n${resolution.reply}`);
  }
  if (resolution.escalationReason) {
    console.log(`\n  Escalation reason: ${resolution.escalationReason}`);
  }

  console.log("\n--- Audit Trail ---");
  for (const entry of audit.getEntries(ticket.id)) {
    console.log(`  [${entry.step}] ${entry.detail}`);
  }
}

main().catch(console.error);
