import type { ToolDefinition } from "../../types.js";
import type { Tool } from "../../core/interfaces.js";

interface HttpApiToolConfig {
  name: string;
  description: string;
  baseUrl: string;
  headers?: Record<string, string>;
  endpoints: EndpointConfig[];
}

interface EndpointConfig {
  action: string;
  method: "GET" | "POST";
  path: string;
  description: string;
}

export class HttpApiTool implements Tool {
  readonly definition: ToolDefinition;
  private baseUrl: string;
  private headers: Record<string, string>;
  private endpoints: Map<string, EndpointConfig>;

  constructor(config: HttpApiToolConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.headers = config.headers ?? {};
    this.endpoints = new Map(config.endpoints.map((e) => [e.action, e]));

    const endpointDescs = config.endpoints
      .map((e) => `  - "${e.action}": ${e.description}`)
      .join("\n");

    this.definition = {
      name: config.name,
      description: `${config.description}\n\nAvailable actions:\n${endpointDescs}`,
      parameters: {
        action: {
          type: "string",
          description: "Which action to perform",
          required: true,
        },
        params: {
          type: "string",
          description: "JSON string of path/query parameters. Path params replace :param in URL. Others become query params (GET) or body (POST).",
          required: true,
        },
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<unknown> {
    const action = String(args.action ?? "");
    const endpoint = this.endpoints.get(action);
    if (!endpoint) {
      throw new Error(`Unknown action: ${action}. Available: ${[...this.endpoints.keys()].join(", ")}`);
    }

    let params: Record<string, string> = {};
    try {
      params = JSON.parse(String(args.params ?? "{}"));
    } catch {
      throw new Error("params must be a valid JSON string");
    }

    let path = endpoint.path;
    for (const [key, value] of Object.entries(params)) {
      if (path.includes(`:${key}`)) {
        path = path.replace(`:${key}`, encodeURIComponent(value));
        delete params[key];
      }
    }

    let url = `${this.baseUrl}${path}`;

    if (endpoint.method === "GET" && Object.keys(params).length > 0) {
      const qs = new URLSearchParams(params).toString();
      url += `?${qs}`;
    }

    const fetchOptions: RequestInit = {
      method: endpoint.method,
      headers: { ...this.headers, "Content-Type": "application/json" },
    };

    if (endpoint.method === "POST" && Object.keys(params).length > 0) {
      fetchOptions.body = JSON.stringify(params);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error ${response.status}: ${text}`);
    }

    return response.json();
  }
}
