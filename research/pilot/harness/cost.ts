// Token accounting and the budget guard. Prices come from easycode's own
// table, SUPPORTED_CHAT_MODELS (brief, Section 2).
import { findSupportedChatModel } from "./easycode.ts";

export type UsageLike = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  outputTokenDetails?: { reasoningTokens?: number };
};

export type Billed = { inputTokens: number; outputTokens: number; reasoningTokens: number; billedOutputTokens: number };

// Gemini through @ai-sdk/google 2.x (a v2 provider adapted by ai 6) reports
// thinking tokens apart from outputTokens, and ai's totalTokens leaves them
// out; Google bills them as output. OpenAI and Anthropic already count
// reasoning inside outputTokens. See NOTEBOOK.md, 2026-09-25.
export function billedTokens(provider: string, usage: UsageLike | undefined): Billed {
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const reasoningTokens = usage?.outputTokenDetails?.reasoningTokens ?? usage?.reasoningTokens ?? 0;
  const billedOutputTokens = provider === "google" ? outputTokens + reasoningTokens : outputTokens;
  return { inputTokens, outputTokens, reasoningTokens, billedOutputTokens };
}

export function pricingFor(modelId: string): { inputUsdPerMillionTokens: number; outputUsdPerMillionTokens: number } {
  const model = findSupportedChatModel(modelId);
  if (!model) throw new Error(`No pricing for ${modelId}`);
  return model.pricing;
}

export function costUsd(modelId: string, provider: string, usage: UsageLike | undefined): number {
  const p = pricingFor(modelId);
  const b = billedTokens(provider, usage);
  return (b.inputTokens * p.inputUsdPerMillionTokens + b.billedOutputTokens * p.outputUsdPerMillionTokens) / 1e6;
}

export class BudgetExceeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceeded";
  }
}

// Refuses a model call when spend so far, plus what calls in flight may cost,
// plus this call's estimate would pass the limit. The estimate is the largest
// turn cost seen so far for the model, with a margin, or a starting guess
// before any turn has finished.
export class Budget {
  private reserved = 0;
  private maxSeen = new Map<string, number>();

  constructor(
    public readonly limitUsd: number,
    public spentUsd = 0,
    // Starting guess per turn: 60k input and 8k output tokens
    private readonly initialTokens = { input: 60_000, output: 8_000 },
    private readonly margin = 1.25,
  ) {}

  estimate(modelId: string): number {
    const seen = this.maxSeen.get(modelId);
    if (seen !== undefined) return seen * this.margin;
    const p = pricingFor(modelId);
    return (this.initialTokens.input * p.inputUsdPerMillionTokens + this.initialTokens.output * p.outputUsdPerMillionTokens) / 1e6;
  }

  reserve(modelId: string): { modelId: string; amount: number } {
    const amount = this.estimate(modelId);
    const projected = this.spentUsd + this.reserved + amount;
    if (projected > this.limitUsd) {
      throw new BudgetExceeded(
        `projected spend ${projected.toFixed(4)} USD would pass the ${this.limitUsd} USD budget (spent ${this.spentUsd.toFixed(4)}, in flight ${this.reserved.toFixed(4)})`,
      );
    }
    this.reserved += amount;
    return { modelId, amount };
  }

  settle(reservation: { modelId: string; amount: number }, actualUsd: number): void {
    this.reserved -= reservation.amount;
    this.spentUsd += actualUsd;
    this.maxSeen.set(reservation.modelId, Math.max(this.maxSeen.get(reservation.modelId) ?? 0, actualUsd));
  }

  get inFlightUsd(): number {
    return this.reserved;
  }
}
