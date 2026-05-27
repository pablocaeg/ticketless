import type { LLMMessage, LLMResponse } from "../../types.js";
import type { LLMProvider } from "../../core/interfaces.js";
import { LLMError } from "../../core/errors.js";

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";

  constructor(
    private apiKey: string,
    private model: string = "claude-sonnet-4-6",
    private maxTokens: number = 1024
  ) {
    if (!apiKey) {
      throw new LLMError("claude", "API key is required");
    }
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const systemMessage = messages.find((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: nonSystemMessages.map((m) => ({ role: m.role, content: m.content })),
    };

    if (systemMessage) {
      body.system = systemMessage.content;
    }

    let response: Response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new LLMError("claude", `Network error: ${message}`);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new LLMError("claude", `API returned ${response.status}: ${text}`, response.status);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    const textContent = data.content.find((c) => c.type === "text");

    return {
      content: textContent?.text ?? "",
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      },
    };
  }
}
