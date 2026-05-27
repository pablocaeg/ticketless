import type { LLMMessage, LLMResponse } from "../../types.js";
import type { LLMProvider } from "../../core/interfaces.js";
import { LLMError } from "../../core/errors.js";

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";

  constructor(
    private apiKey: string,
    private model: string = "gpt-4o",
    private maxTokens: number = 1024,
    private baseUrl: string = "https://api.openai.com/v1"
  ) {
    if (!apiKey) {
      throw new LLMError("openai", "API key is required");
    }
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new LLMError("openai", `Network error: ${message}`);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new LLMError("openai", `API returned ${response.status}: ${text}`, response.status);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    return {
      content: data.choices[0]?.message.content ?? "",
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      },
    };
  }
}
