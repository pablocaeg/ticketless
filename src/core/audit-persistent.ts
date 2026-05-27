import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AuditEntry } from "../types.js";
import type { AuditLog } from "./interfaces.js";

export class FileAuditLog implements AuditLog {
  private cache: AuditEntry[] | null = null;

  constructor(private filePath: string) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(filePath)) writeFileSync(filePath, "");
  }

  append(entry: AuditEntry): void {
    this.cache = null;
    const line = JSON.stringify(entry) + "\n";
    appendFileSync(this.filePath, line);
  }

  getEntries(ticketId: string): AuditEntry[] {
    return this.loadAll().filter((e) => e.ticketId === ticketId);
  }

  getAllEntries(): AuditEntry[] {
    return this.loadAll();
  }

  private loadAll(): AuditEntry[] {
    if (this.cache) return this.cache;

    if (!existsSync(this.filePath)) return [];

    const content = readFileSync(this.filePath, "utf-8").trim();
    if (!content) return [];

    this.cache = content.split("\n").map((line) => {
      const entry = JSON.parse(line) as AuditEntry;
      entry.timestamp = new Date(entry.timestamp);
      return entry;
    });

    return this.cache;
  }
}
