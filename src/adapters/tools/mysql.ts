import type { ToolDefinition } from "../../types.js";
import type { Tool } from "../../core/interfaces.js";
import { DatabaseError } from "../../core/errors.js";

interface MySQLToolConfig {
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  allowedTables?: string[];
  maxRows?: number;
}

interface TableSchema {
  table: string;
  columns: Array<{ name: string; type: string }>;
}

/**
 * MySQL database lookup tool.
 *
 * Requires the `mysql2` package as a peer dependency:
 *   npm install mysql2
 */
export class MySQLLookupTool implements Tool {
  private pool: unknown = null;
  private allowedTables: Set<string> | null;
  private maxRows: number;
  private tableSchemas: TableSchema[] = [];
  private _definition: ToolDefinition;
  private config: MySQLToolConfig;

  get definition(): ToolDefinition {
    return this._definition;
  }

  constructor(config: MySQLToolConfig) {
    this.config = config;
    this.allowedTables = config.allowedTables
      ? new Set(config.allowedTables.map((t) => t.toLowerCase()))
      : null;
    this.maxRows = config.maxRows ?? 50;
    this._definition = this.buildDefinition();
  }

  async init(): Promise<void> {
    let mysql2: { createPool: (config: Record<string, unknown>) => unknown };
    try {
      mysql2 = await (Function('return import("mysql2/promise")')() as Promise<typeof mysql2>);
    } catch {
      throw new DatabaseError(
        'MySQL adapter requires the "mysql2" package. Install it with: npm install mysql2'
      );
    }

    this.pool = mysql2.createPool({
      host: this.config.host,
      port: this.config.port ?? 3306,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
    });

    await this.discoverSchema();
    this._definition = this.buildDefinition();
  }

  async destroy(): Promise<void> {
    if (this.pool && typeof (this.pool as { end?: () => Promise<void> }).end === "function") {
      await (this.pool as { end: () => Promise<void> }).end();
    }
  }

  async execute(args: Record<string, unknown>): Promise<unknown> {
    if (!this.pool) {
      throw new DatabaseError("MySQL tool not initialized. Call init() first.");
    }

    const table = String(args.table ?? "");
    const where = String(args.where ?? "");
    const paramsStr = String(args.params ?? "");
    const columns = String(args.columns ?? "*");

    if (!table) throw new DatabaseError("'table' parameter is required");
    if (!where) throw new DatabaseError("'where' parameter is required");

    if (!isValidIdentifier(table)) {
      throw new DatabaseError(`Invalid table name: ${table}`);
    }

    if (this.allowedTables && !this.allowedTables.has(table.toLowerCase())) {
      throw new DatabaseError(
        `Table "${table}" not allowed. Available: ${[...this.allowedTables].join(", ")}`
      );
    }

    const columnList = columns.split(",").map((c) => c.trim()).filter(Boolean);
    for (const col of columnList) {
      if (col !== "*" && !isValidIdentifier(col)) {
        throw new DatabaseError(`Invalid column name: ${col}`);
      }
    }

    if (containsDangerousSQL(where)) {
      throw new DatabaseError("WHERE clause contains disallowed SQL keywords");
    }

    const params = paramsStr.split(",").map((p) => p.trim()).filter(Boolean);

    // Convert $1, $2 style params to MySQL ? style
    let mysqlWhere = where;
    for (let i = params.length; i >= 1; i--) {
      mysqlWhere = mysqlWhere.replace(new RegExp(`\\$${i}`, "g"), "?");
    }

    const columnsSql = columnList.join(", ");
    const query = `SELECT ${columnsSql} FROM \`${table}\` WHERE ${mysqlWhere} LIMIT ${this.maxRows}`;

    try {
      const pool = this.pool as { execute: (sql: string, params: unknown[]) => Promise<[unknown[], unknown]> };
      const [rows] = await pool.execute(query, params);
      const rowArray = rows as Record<string, unknown>[];
      return { rowCount: rowArray.length, rows: rowArray };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new DatabaseError(`Query failed: ${message}`);
    }
  }

  private async discoverSchema(): Promise<void> {
    if (!this.pool) return;

    try {
      const pool = this.pool as { execute: (sql: string, params: unknown[]) => Promise<[unknown[], unknown]> };
      const [rows] = await pool.execute(
        `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [this.config.database]
      );

      const tableMap = new Map<string, TableSchema>();
      for (const row of rows as Array<Record<string, string>>) {
        const tableName = row.TABLE_NAME;
        if (this.allowedTables && !this.allowedTables.has(tableName.toLowerCase())) continue;

        if (!tableMap.has(tableName)) {
          tableMap.set(tableName, { table: tableName, columns: [] });
        }
        tableMap.get(tableName)!.columns.push({
          name: row.COLUMN_NAME,
          type: row.DATA_TYPE,
        });
      }

      this.tableSchemas = [...tableMap.values()];
    } catch {
      // Best-effort schema discovery
    }
  }

  private buildDefinition(): ToolDefinition {
    let description = "Query the MySQL database to look up customer data. Returns matching rows as JSON.";

    if (this.tableSchemas.length > 0) {
      description += "\n\nAvailable tables and columns:";
      for (const schema of this.tableSchemas) {
        const cols = schema.columns.map((c) => `${c.name} (${c.type})`).join(", ");
        description += `\n  - ${schema.table}: ${cols}`;
      }
    } else if (this.allowedTables) {
      description += `\n\nAllowed tables: ${[...this.allowedTables].join(", ")}`;
    }

    return {
      name: "database_lookup",
      description,
      parameters: {
        table: { type: "string", description: "Table name to query", required: true },
        where: { type: "string", description: 'WHERE clause (e.g., "email = $1")', required: true },
        params: { type: "string", description: "Comma-separated values for $1, $2, etc.", required: true },
        columns: { type: "string", description: "Comma-separated column names (default: all)" },
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
