import type { LLMMessage, LLMResponse } from "../types.js";
import type { LLMProvider } from "../core/interfaces.js";

/**
 * A deterministic LLM that reads prompts and responds based on ticket content.
 * Used for e2e testing — exercises the full agent loop without hitting a real API.
 *
 * It pattern-matches on the ticket subject/body to decide which tools to call
 * and what confidence to assign, simulating realistic agent behavior.
 */
export class ScriptedLLM implements LLMProvider {
  readonly name = "scripted";
  readonly calls: Array<{ role: string; content: string }> = [];

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const last = messages[messages.length - 1].content;
    const system = messages.find((m) => m.role === "system")?.content ?? "";

    this.calls.push({ role: "user", content: last });

    // Planning phase — decide what tools to call
    if (system.includes("plan what tools to call")) {
      return { content: this.planResponse(last) };
    }

    // Synthesis phase — analyze findings
    if (system.includes("Analyze investigation findings")) {
      return { content: this.synthesisResponse(last) };
    }

    // Reply phase — compose customer response
    if (system.includes("writing a reply to a customer")) {
      return { content: this.replyResponse(last) };
    }

    return { content: '{"reasoning":"unknown phase","steps":[]}' };
  }

  private planResponse(prompt: string): string {
    const lower = prompt.toLowerCase();

    // Login issues → look up user + search logs
    if (lower.includes("log in") || lower.includes("login") || lower.includes("locked")) {
      const email = extractEmail(prompt);
      return JSON.stringify({
        reasoning: "Customer can't log in — checking account status and auth logs",
        steps: [
          { tool: "user_lookup", args: { email }, purpose: "Check account status" },
          { tool: "search_logs", args: { userId: "", service: "auth", level: "error" }, purpose: "Check for login errors" },
        ],
      });
    }

    // Payment issues → look up user + check orders
    if (lower.includes("payment") || lower.includes("charge") || lower.includes("billing")) {
      const email = extractEmail(prompt);
      return JSON.stringify({
        reasoning: "Payment issue — checking customer account and recent orders",
        steps: [
          { tool: "user_lookup", args: { email }, purpose: "Get customer ID" },
          { tool: "order_lookup", args: { userId: "", status: "failed" }, purpose: "Check failed orders" },
        ],
      });
    }

    // Export issues → look up user + search logs
    if (lower.includes("export") || lower.includes("csv") || lower.includes("download")) {
      const email = extractEmail(prompt);
      return JSON.stringify({
        reasoning: "Export issue — checking user plan and export logs",
        steps: [
          { tool: "user_lookup", args: { email }, purpose: "Check plan limits" },
          { tool: "search_logs", args: { service: "export", level: "error" }, purpose: "Check export errors" },
        ],
      });
    }

    // Seat/provisioning issues → look up user + orders + logs
    if (lower.includes("seat") || lower.includes("team") || lower.includes("invite")) {
      const email = extractEmail(prompt);
      return JSON.stringify({
        reasoning: "Seat provisioning issue — checking order and provisioning status",
        steps: [
          { tool: "user_lookup", args: { email }, purpose: "Get user info" },
          { tool: "search_logs", args: { service: "provisioning", level: "error" }, purpose: "Check provisioning errors" },
        ],
      });
    }

    // If we have prior findings and email in prompt, look up user by email from findings
    if (prompt.includes("Prior Investigation Results")) {
      // Second round — search docs for solution
      return JSON.stringify({
        reasoning: "Have enough data from investigation, searching docs for solution",
        steps: [
          { tool: "search_docs", args: { query: extractTopicFromFindings(prompt) }, purpose: "Find relevant help article" },
        ],
      });
    }

    // Default: look up user
    const email = extractEmail(prompt);
    return JSON.stringify({
      reasoning: "General issue — looking up customer account",
      steps: [
        { tool: "user_lookup", args: { email }, purpose: "Check account status" },
      ],
    });
  }

  private synthesisResponse(prompt: string): string {
    const lower = prompt.toLowerCase();

    // Check if findings contain useful data
    const hasUserData = prompt.includes('"found": true') || prompt.includes('"found":true');
    const hasErrors = prompt.includes('"level": "error"') || prompt.includes('"level":"error"');

    if (!hasUserData && !hasErrors) {
      return JSON.stringify({
        answer: "Could not find relevant customer data",
        confidence: 0.3,
        reasoning: "No matching records found in the database",
        needsMoreInvestigation: false,
      });
    }

    // Account locked
    if (lower.includes("locked") || lower.includes("lock")) {
      return JSON.stringify({
        answer: "Customer account is locked due to multiple failed login attempts. The lockout will expire automatically.",
        confidence: 0.92,
        reasoning: "Found clear evidence: account status is locked, auth logs confirm failed attempts",
        needsMoreInvestigation: false,
      });
    }

    // Payment failed
    if (lower.includes("card expired") || lower.includes("payment failed") || lower.includes("declined")) {
      return JSON.stringify({
        answer: "Payment failed because the card on file has expired. Customer needs to update their payment method.",
        confidence: 0.88,
        reasoning: "Found failed order with clear error: card expired",
        needsMoreInvestigation: false,
      });
    }

    // Export limit
    if (lower.includes("export") && (lower.includes("limit") || lower.includes("exceeds"))) {
      return JSON.stringify({
        answer: "CSV export failed because the data exceeds the Starter plan's 1,000 row limit. Customer needs to upgrade to Pro for unlimited exports.",
        confidence: 0.90,
        reasoning: "Logs show export exceeded plan limit, user is on starter plan",
        needsMoreInvestigation: false,
      });
    }

    // Provisioning stuck
    if (lower.includes("provisioning") || lower.includes("timeout") || lower.includes("seat")) {
      return JSON.stringify({
        answer: "Seat provisioning is stuck due to a timeout with the license server. The order was placed but seats haven't been assigned yet.",
        confidence: 0.85,
        reasoning: "Found provisioning timeout error in logs, order exists but is pending",
        needsMoreInvestigation: false,
      });
    }

    // Generic with data
    return JSON.stringify({
      answer: "Found relevant customer data but the root cause is unclear",
      confidence: 0.6,
      reasoning: "Have some data but not enough to confidently resolve",
      needsMoreInvestigation: false,
    });
  }

  private replyResponse(prompt: string): string {
    const lower = prompt.toLowerCase();

    // Match on the synthesis answer (in "What We Found" section) — more specific first
    if (lower.includes("card") && lower.includes("expired")) {
      return "Hi there,\n\nI looked into your payment issue. The charge didn't go through because the card on file has expired.\n\nYou can update your payment method at Settings > Billing > Payment Method. Once updated, the failed charge will be automatically retried within 24 hours.\n\nLet me know if you need anything else!\n\nBest,\nSupport";
    }

    if (lower.includes("export") && (lower.includes("limit") || lower.includes("row"))) {
      return "Hi there,\n\nThe export failed because your project has 2,847 rows, which exceeds the Starter plan's limit of 1,000 rows per export.\n\nYou can either:\n1. Filter your data to under 1,000 rows before exporting\n2. Upgrade to the Pro plan for unlimited exports\n\nLet me know if you have any questions!\n\nBest,\nSupport";
    }

    if (lower.includes("provisioning") || (lower.includes("seat") && lower.includes("stuck"))) {
      return "Hi there,\n\nI can see your order for 3 extra seats went through, but the provisioning system experienced a delay. I've flagged this for our team to manually provision your seats.\n\nYou should see the seats appear within the next 30 minutes. I'll follow up to confirm once they're active.\n\nSorry for the inconvenience!\n\nBest,\nSupport";
    }

    if (lower.includes("locked") || lower.includes("failed login")) {
      return "Hi there,\n\nYour account has been temporarily locked as a security measure after multiple failed login attempts. The lockout will automatically lift in about 15 minutes.\n\nIf you'd like to regain access sooner, you can reset your password using the \"Forgot Password\" link on the login page.\n\nLet me know if you need any further help!\n\nBest,\nSupport";
    }

    if (lower.includes("payment") || lower.includes("billing") || lower.includes("charge")) {
      return "Hi there,\n\nI looked into your payment issue and found the problem. Please update your payment method at Settings > Billing and the charge will be retried.\n\nLet me know if you need anything else!\n\nBest,\nSupport";
    }

    return "Hi there,\n\nThank you for reaching out. I've looked into your issue and I'm working on getting this resolved for you.\n\nBest,\nSupport";
  }
}

function extractEmail(text: string): string {
  const match = text.match(/[\w.-]+@[\w.-]+\.\w+/);
  return match ? match[0] : "";
}

function extractTopicFromFindings(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("locked") || lower.includes("login")) return "account lockout policy";
  if (lower.includes("payment") || lower.includes("expired")) return "updating payment methods";
  if (lower.includes("export") || lower.includes("limit")) return "export plan limits";
  if (lower.includes("seat") || lower.includes("provision")) return "seat provisioning";
  return "troubleshooting";
}
