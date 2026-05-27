import { describe, it, expect } from "vitest";
import { EventBus } from "./events.js";

describe("EventBus", () => {
  it("emits and receives events", () => {
    const bus = new EventBus();
    const received: string[] = [];

    bus.on("ticket:received", (data) => {
      received.push(data.ticket.id);
    });

    bus.emit("ticket:received", {
      ticket: {
        id: "t-1",
        source: "test",
        subject: "Test",
        body: "Body",
        customerEmail: "a@b.com",
        metadata: {},
        createdAt: new Date(),
      },
    });

    expect(received).toEqual(["t-1"]);
  });

  it("returns unsubscribe function", () => {
    const bus = new EventBus();
    let count = 0;

    const unsub = bus.on("ticket:received", () => { count++; });
    bus.emit("ticket:received", { ticket: { id: "t", source: "", subject: "", body: "", customerEmail: "", metadata: {}, createdAt: new Date() } });
    expect(count).toBe(1);

    unsub();
    bus.emit("ticket:received", { ticket: { id: "t", source: "", subject: "", body: "", customerEmail: "", metadata: {}, createdAt: new Date() } });
    expect(count).toBe(1);
  });

  it("handles multiple listeners", () => {
    const bus = new EventBus();
    const results: number[] = [];

    bus.on("ticket:received", () => results.push(1));
    bus.on("ticket:received", () => results.push(2));

    bus.emit("ticket:received", { ticket: { id: "t", source: "", subject: "", body: "", customerEmail: "", metadata: {}, createdAt: new Date() } });
    expect(results).toEqual([1, 2]);
  });

  it("does not crash if handler throws", () => {
    const bus = new EventBus();
    let called = false;

    bus.on("ticket:received", () => { throw new Error("boom"); });
    bus.on("ticket:received", () => { called = true; });

    bus.emit("ticket:received", { ticket: { id: "t", source: "", subject: "", body: "", customerEmail: "", metadata: {}, createdAt: new Date() } });
    expect(called).toBe(true);
  });

  it("removeAllListeners clears everything", () => {
    const bus = new EventBus();
    let count = 0;

    bus.on("ticket:received", () => { count++; });
    bus.removeAllListeners();
    bus.emit("ticket:received", { ticket: { id: "t", source: "", subject: "", body: "", customerEmail: "", metadata: {}, createdAt: new Date() } });

    expect(count).toBe(0);
  });
});
