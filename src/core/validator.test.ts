import { describe, it, expect } from "vitest";
import { validateTicket } from "./validator.js";
import { ValidationError } from "./errors.js";

describe("validateTicket", () => {
  it("validates a complete ticket", () => {
    const ticket = validateTicket({
      subject: "Help",
      body: "I need help",
      customerEmail: "user@example.com",
    });
    expect(ticket.subject).toBe("Help");
    expect(ticket.body).toBe("I need help");
    expect(ticket.customerEmail).toBe("user@example.com");
    expect(ticket.id).toBeTruthy();
    expect(ticket.source).toBe("api");
  });

  it("accepts ticket with only subject (no body)", () => {
    const ticket = validateTicket({
      subject: "Help",
      customerEmail: "user@example.com",
    });
    expect(ticket.subject).toBe("Help");
  });

  it("accepts ticket with only body (no subject)", () => {
    const ticket = validateTicket({
      body: "I need help",
      customerEmail: "user@example.com",
    });
    expect(ticket.body).toBe("I need help");
  });

  it("rejects ticket with no subject and no body", () => {
    expect(() => validateTicket({ customerEmail: "user@example.com" }))
      .toThrow(ValidationError);
  });

  it("rejects ticket with no email", () => {
    expect(() => validateTicket({ subject: "Help" }))
      .toThrow(ValidationError);
  });

  it("rejects invalid email", () => {
    expect(() => validateTicket({ subject: "Help", customerEmail: "not-an-email" }))
      .toThrow(ValidationError);
  });

  it("rejects non-object input", () => {
    expect(() => validateTicket("string")).toThrow(ValidationError);
    expect(() => validateTicket(null)).toThrow(ValidationError);
    expect(() => validateTicket(42)).toThrow(ValidationError);
  });

  it("uses provided id and source", () => {
    const ticket = validateTicket({
      id: "custom-id",
      source: "zendesk",
      subject: "Help",
      customerEmail: "user@example.com",
    });
    expect(ticket.id).toBe("custom-id");
    expect(ticket.source).toBe("zendesk");
  });

  it("trims whitespace from fields", () => {
    const ticket = validateTicket({
      subject: "  Help  ",
      customerEmail: " user@example.com ",
    });
    expect(ticket.subject).toBe("Help");
    expect(ticket.customerEmail).toBe("user@example.com");
  });

  it("accepts 'email' as alias for customerEmail", () => {
    const ticket = validateTicket({
      subject: "Help",
      email: "user@example.com",
    });
    expect(ticket.customerEmail).toBe("user@example.com");
  });
});
