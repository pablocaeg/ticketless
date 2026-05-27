import type { AuditEntry } from "../types.js";
import type { AuditLog } from "./interfaces.js";

export class InMemoryAuditLog implements AuditLog {
  private entries: AuditEntry[] = [];

  append(entry: AuditEntry): void {
    this.entries.push(entry);
  }

  getEntries(ticketId: string): AuditEntry[] {
    return this.entries.filter((e) => e.ticketId === ticketId);
  }

  getAllEntries(): AuditEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}
