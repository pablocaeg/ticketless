import { describe, it, expect } from "vitest";
import { buildLLM, buildSources, buildTools, buildEscalationRules } from "./config.js";

describe("config builders", () => {
  it("builds Claude provider", () => {
    const llm = buildLLM({ provider: "claude", apiKey: "test-key" });
    expect(llm.name).toBe("claude");
  });

  it("builds OpenAI provider", () => {
    const llm = buildLLM({ provider: "openai", apiKey: "test-key" });
    expect(llm.name).toBe("openai");
  });

  it("builds Ollama provider", () => {
    const llm = buildLLM({ provider: "ollama" });
    expect(llm.name).toBe("ollama");
  });

  it("builds webhook source", () => {
    const sources = buildSources([{ type: "webhook", port: 4000 }]);
    expect(sources).toHaveLength(1);
    expect(sources[0].name).toBe("webhook");
  });

  it("builds zendesk source", () => {
    const sources = buildSources([
      { type: "zendesk", subdomain: "test", email: "a@b.com", apiToken: "tok" },
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0].name).toBe("zendesk");
  });

  it("builds intercom source", () => {
    const sources = buildSources([{ type: "intercom", accessToken: "tok" }]);
    expect(sources).toHaveLength(1);
    expect(sources[0].name).toBe("intercom");
  });

  it("builds freshdesk source", () => {
    const sources = buildSources([{ type: "freshdesk", domain: "test", apiKey: "key" }]);
    expect(sources).toHaveLength(1);
    expect(sources[0].name).toBe("freshdesk");
  });

  it("builds default escalation rules", () => {
    const rules = buildEscalationRules();
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((r) => r.name === "sensitive-topic")).toBe(true);
    expect(rules.some((r) => r.name === "angry-customer")).toBe(true);
  });

  it("sensitive-topic rule triggers on legal keywords", () => {
    const rules = buildEscalationRules();
    const rule = rules.find((r) => r.name === "sensitive-topic")!;
    const ticket = {
      id: "t",
      source: "test",
      subject: "GDPR data request",
      body: "I need my data deleted",
      customerEmail: "a@b.com",
      metadata: {},
      createdAt: new Date(),
    };
    expect(rule.condition(ticket, [])).toBe(true);
  });
});
