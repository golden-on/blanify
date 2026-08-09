import Anthropic from "@anthropic-ai/sdk";

export interface SuggestReplyContext {
  guestName: string;
  channel: string;
  propertyName: string | null;
  unitName: string | null;
  checkInInstructions: string | null;
  checkIn: string | null;
  checkOut: string | null;
  history: Array<{ senderType: string; content: string }>;
}

export interface LLMDriver {
  generateReply(context: SuggestReplyContext): Promise<string>;
}

function buildPrompt(context: SuggestReplyContext): { system: string; conversation: string } {
  const system = [
    "You are drafting a short-term rental host's reply to a guest message.",
    "Write a concise, friendly draft reply the host can review and edit before sending.",
    `Guest name: ${context.guestName}`,
    context.propertyName ? `Property: ${context.propertyName}` : null,
    context.unitName ? `Unit: ${context.unitName}` : null,
    context.checkIn ? `Check-in: ${context.checkIn}` : null,
    context.checkOut ? `Check-out: ${context.checkOut}` : null,
    context.checkInInstructions ? `Check-in instructions: ${context.checkInInstructions}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const conversation = context.history.map((m) => `${m.senderType}: ${m.content}`).join("\n");

  return { system, conversation };
}

export class AnthropicLLMDriver implements LLMDriver {
  #client: Anthropic;
  #model: string;

  constructor(apiKey: string, model: string) {
    this.#client = new Anthropic({ apiKey });
    this.#model = model;
  }

  async generateReply(context: SuggestReplyContext): Promise<string> {
    const { system, conversation } = buildPrompt(context);

    const response = await this.#client.messages.create({
      model: this.#model,
      max_tokens: 512,
      system,
      messages: [{ role: "user", content: conversation }],
    });

    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
}

export const llmDriver: LLMDriver = new AnthropicLLMDriver(
  process.env.ANTHROPIC_API_KEY ?? "sk-ant-dev-placeholder",
  process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest",
);
