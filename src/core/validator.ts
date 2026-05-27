import type { Ticket } from "../types.js";
import { ValidationError } from "./errors.js";

export function validateTicket(data: unknown): Ticket {
  if (!data || typeof data !== "object") {
    throw new ValidationError("Ticket must be an object");
  }

  const obj = data as Record<string, unknown>;

  const subject = toString(obj.subject);
  const body = toString(obj.body);
  const customerEmail = toString(obj.customerEmail ?? obj.email);

  if (!subject && !body) {
    throw new ValidationError("Ticket must have at least a subject or body", "subject");
  }

  if (!customerEmail) {
    throw new ValidationError("Customer email is required", "customerEmail");
  }

  if (!isValidEmail(customerEmail)) {
    throw new ValidationError(`Invalid email: ${customerEmail}`, "customerEmail");
  }

  return {
    id: toString(obj.id) || crypto.randomUUID(),
    source: toString(obj.source) || "api",
    subject,
    body,
    customerEmail,
    customerId: obj.customerId ? toString(obj.customerId) : undefined,
    metadata: (typeof obj.metadata === "object" && obj.metadata !== null
      ? obj.metadata
      : {}) as Record<string, unknown>,
    createdAt: new Date(),
  };
}

function toString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
