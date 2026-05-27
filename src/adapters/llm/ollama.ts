import type { LLMMessage, LLMResponse } from "../../types.js";
import type { LLMProvider } from "../../core/interfaces.js";
import { LLMError } from "../../core/errors.js";

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";

  constructor(
    private model: string = "llama3.1",
    private baseUrl: string = "http://localhost:11434"
  ) {}

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: false,
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new LLMError("ollama", `Connection failed (is Ollama running at ${this.baseUrl}?): ${message}`);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new LLMError("ollama", `API returned ${response.status}: ${text}`, response.status);
    }

    const data = (await response.json()) as {
      message: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      content: data.message.content,
      usage: {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
      },
    };
  }
}
