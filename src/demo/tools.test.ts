import { describe, it, expect } from "vitest";
import {
  DemoUserLookupTool,
  DemoOrderLookupTool,
  DemoLogSearchTool,
  DemoKnowledgeBaseTool,
} from "./tools.js";

describe("DemoUserLookupTool", () => {
  const tool = new DemoUserLookupTool();

  it("finds user by email", async () => {
    const result = (await tool.execute({ email: "alice@startup.io" })) as Record<string, unknown>;
    expect(result.found).toBe(true);
    expect(result.name).toBe("Alice Chen");
    expect(result.status).toBe("locked");
  });

  it("finds user by ID", async () => {
    const result = (await tool.execute({ userId: "usr_002" })) as Record<string, unknown>;
    expect(result.found).toBe(true);
    expect(result.name).toBe("Bob Martinez");
  });

  it("returns not found for unknown email", async () => {
    const result = (await tool.execute({ email: "unknown@x.com" })) as Record<string, unknown>;
    expect(result.found).toBe(false);
  });

  it("is case-insensitive for email", async () => {
    const result = (await tool.execute({ email: "ALICE@STARTUP.IO" })) as Record<string, unknown>;
    expect(result.found).toBe(true);
  });
});

describe("DemoOrderLookupTool", () => {
  const tool = new DemoOrderLookupTool();

  it("finds orders by userId", async () => {
    const result = (await tool.execute({ userId: "usr_002" })) as { count: number; orders: unknown[] };
    expect(result.count).toBe(2);
  });

  it("finds order by orderId", async () => {
    const result = (await tool.execute({ orderId: "ord_002" })) as { count: number; orders: Array<Record<string, unknown>> };
    expect(result.count).toBe(1);
    expect(result.orders[0].status).toBe("failed");
  });

  it("filters by status", async () => {
    const result = (await tool.execute({ userId: "usr_002", status: "failed" })) as { count: number; orders: unknown[] };
    expect(result.count).toBe(1);
  });
});

describe("DemoLogSearchTool", () => {
  const tool = new DemoLogSearchTool();

  it("filters by userId", async () => {
    const result = (await tool.execute({ userId: "usr_001" })) as { count: number; logs: unknown[] };
    expect(result.count).toBeGreaterThan(0);
  });

  it("filters by service", async () => {
    const result = (await tool.execute({ service: "billing" })) as { count: number; logs: unknown[] };
    expect(result.count).toBeGreaterThan(0);
  });

  it("filters by level", async () => {
    const result = (await tool.execute({ level: "error" })) as { count: number; logs: unknown[] };
    expect(result.count).toBeGreaterThan(0);
  });

  it("filters by keyword", async () => {
    const result = (await tool.execute({ keyword: "locked" })) as { count: number; logs: unknown[] };
    expect(result.count).toBeGreaterThan(0);
  });
});

describe("DemoKnowledgeBaseTool", () => {
  const tool = new DemoKnowledgeBaseTool();

  it("finds relevant articles", async () => {
    const result = (await tool.execute({ query: "account locked login" })) as { count: number; articles: unknown[] };
    expect(result.count).toBeGreaterThan(0);
  });

  it("finds export-related articles", async () => {
    const result = (await tool.execute({ query: "export csv limit" })) as { count: number; articles: unknown[] };
    expect(result.count).toBeGreaterThan(0);
  });

  it("returns empty for unrelated query", async () => {
    const result = (await tool.execute({ query: "xyznonexistent" })) as { count: number; articles: unknown[] };
    expect(result.count).toBe(0);
  });
});
