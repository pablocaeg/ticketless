import pg from "pg";
import type { ToolDefinition } from "../../types.js";
import type { Tool } from "../../core/interfaces.js";
import { DatabaseError } from "../../core/errors.js";

interface PostgresToolConfig {
  connectionString: string;
  allowedTables?: string[];
  maxRows?: number;
  schemaName?: string;
}

interface TableSchema {
  table: string;
  columns: Array<{ name: string; type: string; nullable: boolean }>;
}

export class PostgresLookupTool implements Tool {
  private pool: pg.Pool;
  private allowedTables: Set<string> | null;
  private maxRows: number;
  private schemaName: string;
  private tableSchemas: TableSchema[] = [];
  private _definition: ToolDefinition;

  get definition(): ToolDefinition {
    return this._definition;
  }

  constructor(private config: PostgresToolConfig) {
    this.pool = new pg.Pool({ connectionString: config.connectionString });
    this.allowedTables = config.allowedTables
      ? new Set(config.allowedTables.map((t) => t.toLowerCase()))
      : null;
    this.maxRows = config.maxRows ?? 50;
    this.schemaName = config.schemaName ?? "public";

    this._definition = this.buildDefinition();
  }

  async init(): Promise<void> {
    await this.discoverSchema();
    this._definition = this.buildDefinition();
  }

  async destroy(): Promise<void> {
    await this.pool.end();
  }

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const table = String(args.table ?? "");
    const where = String(args.where ?? "");
    const paramsStr = String(args.params ?? "");
    const columns = String(args.columns ?? "*");

    if (!table) {
      throw new DatabaseError("'table' parameter is required");
    }

    if (!where) {
      throw new DatabaseError("'where' parameter is required — unrestricted queries are not allowed");
    }

    if (!isValidIdentifier(table)) {
      throw new DatabaseError(`Invalid table name: ${table}`, { table });
    }

    if (this.allowedTables && !this.allowedTables.has(table.toLowerCase())) {
      throw new DatabaseError(
        `Table "${table}" is not in the allowed list. Available: ${[...this.allowedTables].join(", ")}`,
        { table, allowed: [...this.allowedTables] }
      );
    }

    const columnList = columns.split(",").map((c) => c.trim()).filter(Boolean);
    for (const col of columnList) {
      if (col !== "*" && !isValidIdentifier(col)) {
        throw new DatabaseError(`Invalid column name: ${col}`, { column: col });
      }
    }

    if (containsDangerousSQL(where)) {
      throw new DatabaseError("WHERE clause contains disallowed SQL keywords (write operations are blocked)");
    }

    const params = paramsStr
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

    const columnsSql = columnList.join(", ");
    const query = `SELECT ${columnsSql} FROM ${this.schemaName}.${table} WHERE ${where} LIMIT ${this.maxRows}`;

    try {
      const result = await this.pool.query(query, params);
      return {
        rowCount: result.rowCount,
        rows: result.rows,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new DatabaseError(`Query failed: ${message}`, { query, params });
    }
  }

  private async discoverSchema(): Promise<void> {
    const schemaQuery = `
      SELECT
        t.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable
      FROM information_schema.tables t
      JOIN information_schema.columns c
        ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE t.table_schema = $1
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name, c.ordinal_position
    `;

    try {
      const result = await this.pool.query(schemaQuery, [this.schemaName]);
      const tableMap = new Map<string, TableSchema>();

      for (const row of result.rows) {
        const tableName = row.table_name as string;

        if (this.allowedTables && !this.allowedTables.has(tableName.toLowerCase())) {
          continue;
        }

        if (!tableMap.has(tableName)) {
          tableMap.set(tableName, { table: tableName, columns: [] });
        }

        tableMap.get(tableName)!.columns.push({
          name: row.column_name as string,
          type: row.data_type as string,
          nullable: row.is_nullable === "YES",
        });
      }

      this.tableSchemas = [...tableMap.values()];
    } catch {
      // Schema discovery is best-effort — tool still works without it
    }
  }

  private buildDefinition(): ToolDefinition {
    let description =
      "Query the application database to look up customer data. Returns matching rows as JSON.";

    if (this.tableSchemas.length > 0) {
      description += "\n\nAvailable tables and columns:";
      for (const schema of this.tableSchemas) {
        const cols = schema.columns
          .map((c) => `${c.name} (${c.type})`)
          .join(", ");
        description += `\n  - ${schema.table}: ${cols}`;
      }
    } else if (this.allowedTables) {
      description += `\n\nAllowed tables: ${[...this.allowedTables].join(", ")}`;
    }

    return {
      name: "database_lookup",
      description,
      parameters: {
        table: {
          type: "string",
          description: "Table name to query",
          required: true,
        },
        where: {
          type: "string",
          description: 'WHERE clause with parameterized values (e.g., "email = $1" or "id = $1 AND status = $2")',
          required: true,
        },
        params: {
          type: "string",
          description: "Comma-separated values for $1, $2, etc. in the WHERE clause",
          required: true,
        },
        columns: {
          type: "string",
          description: "Comma-separated column names to return (default: all columns)",
        },
      },
    };
  }
}

function isValidIdentifier(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(name);
}

function containsDangerousSQL(clause: string): boolean {
  return /\b(DROP|DELETE|INSERT|UPDATE|ALTER|TRUNCATE|EXEC|EXECUTE|CREATE|GRANT|REVOKE)\b/i.test(clause);
}
