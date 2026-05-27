/**
 * Example: Building a custom tool adapter
 *
 * Shows how to create your own tool that the agent can use during investigation.
 * This example creates a tool that queries a hypothetical feature flag service.
 *
 * Run with:
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/custom-tool.ts
 */

import {
  Agent,
  InMemoryAuditLog,
  ConfidenceGate,
  ClaudeProvider,
  type Tool,
  type ToolDefinition,
  type Ticket,
} from "../src/index.js";

class FeatureFlagTool implements Tool {
  readonly definition: ToolDefinition = {
    name: "check_feature_flags",
    description:
      "Check which feature flags are enabled for a specific user. Use this to diagnose issues where a feature isn't working for a customer — it might be behind a flag that's disabled for them.",
    parameters: {
      userId: {
        type: "string",
        description: "The user's ID",
        required: true,
      },
      flagName: {
        type: "string",
        description: "Specific flag to check (optional — returns all flags if omitted)",
      },
    },
  };

  private flags: Record<string, Record<string, boolean>> = {
    usr_001: { new_dashboard: true, dark_mode: true, export_v2: false, api_v3: false },
    usr_002: { new_dashboard: true, dark_mode: true, export_v2: true, api_v3: true },
    usr_003: { new_dashboard: false, dark_mode: true, export_v2: false, api_v3: false },
  };

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const userId = String(args.userId);
    const flagName = args.flagName ? String(args.flagName) : null;

    const userFlags = this.flags[userId];
    if (!userFlags) return { found: false, userId };

    if (flagName) {
      const enabled = userFlags[flagName];
      if (enabled === undefined) return { found: false, flagName };
      return { found: true, userId, flagName, enabled };
    }

    return { found: true, userId, flags: userFlags };
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Set ANTHROPIC_API_KEY");
    process.exit(1);
  }

  const llm = new ClaudeProvider(apiKey);
  const audit = new InMemoryAuditLog();
  const gate = new ConfidenceGate(0.7);
  const agent = new Agent(llm, audit, gate);

  agent.registerTool(new FeatureFlagTool());

  const ticket: Ticket = {
    id: "ff-001",
    source: "email",
    subject: "New export feature not showing up",
    body: "I heard you launched a new export feature but I don't see it anywhere in my dashboard. I'm on the Starter plan. Am I missing something?",
    customerEmail: "carol@freelance.dev",
    customerId: "usr_003",
    metadata: {},
    createdAt: new Date(),
  };

  console.log("Resolving ticket...\n");
  const resolution = await agent.resolve(ticket);

  console.log(`Action: ${resolution.action}`);
  console.log(`Confidence: ${resolution.confidence}`);
  console.log(`Tools: ${resolution.toolsUsed.join(", ")}`);
  if (resolution.reply) console.log(`\nReply:\n${resolution.reply}`);
  if (resolution.escalationReason) console.log(`\nEscalated: ${resolution.escalationReason}`);

  console.log("\nAudit trail:");
  for (const entry of audit.getEntries(ticket.id)) {
    console.log(`  [${entry.step}] ${entry.detail}`);
  }
}

main().catch(console.error);
