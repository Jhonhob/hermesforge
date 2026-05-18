import type { EngineEvent, EngineRuntimeEnv, RuntimeConfig } from "../shared/types";

export type TaskUsageState = {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  contextTokens?: number;
  contextWindow?: number;
  contextPercent?: number;
  estimatedCostUsd: number;
  inputCostPer1kUsd: number;
  outputCostPer1kUsd: number;
  source: "estimated" | "actual";
  streamedOutputTokens: number;
  countedResult: boolean;
};

const FALLBACK_INPUT_COST_PER_1K = 0.002;
const FALLBACK_OUTPUT_COST_PER_1K = 0.006;

export function createTaskUsageState(inputTokens: number, runtimeEnv: EngineRuntimeEnv, config: RuntimeConfig): TaskUsageState {
  const pricing = resolvePricing(runtimeEnv, config);
  return {
    inputTokens,
    outputTokens: 0,
    estimatedCostUsd: 0,
    inputCostPer1kUsd: pricing.inputCostPer1kUsd,
    outputCostPer1kUsd: pricing.outputCostPer1kUsd,
    source: "estimated",
    streamedOutputTokens: 0,
    countedResult: false,
  };
}

export function trackTaskUsage(usage: TaskUsageState | undefined, event: EngineEvent, estimateTokens: (text: string) => number) {
  if (!usage) return;
  if (event.type === "usage" && event.source === "actual") {
    usage.inputTokens = event.inputTokens;
    usage.outputTokens = event.outputTokens;
    usage.totalTokens = event.totalTokens;
    usage.promptTokens = event.promptTokens;
    usage.completionTokens = event.completionTokens;
    usage.cacheReadTokens = event.cacheReadTokens;
    usage.cacheWriteTokens = event.cacheWriteTokens;
    usage.reasoningTokens = event.reasoningTokens;
    usage.contextTokens = event.contextTokens;
    usage.contextWindow = event.contextWindow;
    usage.contextPercent = event.contextPercent;
    usage.estimatedCostUsd = event.estimatedCostUsd;
    usage.source = "actual";
    return;
  }
  if (event.type === "usage" && event.source !== "actual") {
    usage.inputTokens = Math.max(usage.inputTokens, event.inputTokens);
    usage.outputTokens = Math.max(usage.outputTokens, event.outputTokens);
    usage.totalTokens = event.totalTokens ?? usage.totalTokens;
    usage.reasoningTokens = event.reasoningTokens ?? usage.reasoningTokens;
    usage.contextTokens = event.contextTokens ?? usage.contextTokens;
    usage.contextWindow = event.contextWindow ?? usage.contextWindow;
    usage.contextPercent = event.contextPercent ?? usage.contextPercent;
    usage.estimatedCostUsd =
      (usage.inputTokens * usage.inputCostPer1kUsd + usage.outputTokens * usage.outputCostPer1kUsd) / 1000;
    return;
  }
  if (usage.source === "actual") return;
  if (event.type === "message_chunk") {
    const tokens = estimateTokens(event.content);
    usage.outputTokens += tokens;
    usage.streamedOutputTokens += tokens;
  } else if (event.type === "reasoning") {
    const tokens = estimateTokens(event.content);
    usage.reasoningTokens = (usage.reasoningTokens ?? 0) + tokens;
    usage.outputTokens += tokens;
    usage.streamedOutputTokens += tokens;
  } else if (event.type === "stdout" || event.type === "stderr") {
    usage.outputTokens += estimateTokens(event.line);
  } else if (event.type === "result") {
    if (usage.streamedOutputTokens > 0 || usage.countedResult) return;
    usage.outputTokens += estimateTokens(`${event.title} ${event.detail}`);
    usage.countedResult = true;
  } else {
    return;
  }
  usage.totalTokens = usage.inputTokens + usage.outputTokens;
  usage.estimatedCostUsd =
    (usage.inputTokens * usage.inputCostPer1kUsd + usage.outputTokens * usage.outputCostPer1kUsd) / 1000;
}

function resolvePricing(runtimeEnv: EngineRuntimeEnv, config: RuntimeConfig) {
  const providerProfile = config.providerProfiles?.find((profile) => profile.id === runtimeEnv.providerProfileId)
    ?? config.providerProfiles?.find((profile) => profile.provider === runtimeEnv.provider);
  const modelOption = providerProfile?.models.find((model) => model.id === runtimeEnv.model);
  return {
    inputCostPer1kUsd: modelOption?.inputCostPer1kUsd ?? FALLBACK_INPUT_COST_PER_1K,
    outputCostPer1kUsd: modelOption?.outputCostPer1kUsd ?? FALLBACK_OUTPUT_COST_PER_1K,
  };
}
