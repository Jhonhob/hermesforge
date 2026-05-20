import { describe, expect, it } from "vitest";
import { createTaskUsageState, trackTaskUsage } from "./task-usage-meter";
import { estimateTextTokens } from "../shared/token-estimator";
import type { EngineRuntimeEnv, RuntimeConfig } from "../shared/types";

describe("task usage meter", () => {
  it("uses model option pricing when available", () => {
    const config: RuntimeConfig = {
      defaultModelProfileId: "default",
      modelProfiles: [{ id: "default", provider: "openai", model: "gpt-5.4" }],
      providerProfiles: [{
        id: "openai-default",
        provider: "openai",
        label: "OpenAI",
        models: [{ id: "gpt-5.4", label: "GPT-5.4", inputCostPer1kUsd: 1, outputCostPer1kUsd: 2 }],
        status: "ready",
      }],
      updateSources: {},
    };
    const runtimeEnv: EngineRuntimeEnv = {
      profileId: "default",
      provider: "openai",
      providerProfileId: "openai-default",
      model: "gpt-5.4",
      env: {},
    };

    const usage = createTaskUsageState(1000, runtimeEnv, config);
    trackTaskUsage(usage, { type: "stdout", line: "abcd", at: new Date().toISOString() }, () => 1000);
    expect(usage.estimatedCostUsd).toBe(3);
  });

  it("falls back to default pricing when model pricing is missing", () => {
    const config: RuntimeConfig = {
      defaultModelProfileId: "default",
      modelProfiles: [{ id: "default", provider: "openai", model: "gpt-5.4" }],
      updateSources: {},
    };
    const runtimeEnv: EngineRuntimeEnv = {
      profileId: "default",
      provider: "openai",
      model: "gpt-5.4",
      env: {},
    };

    const usage = createTaskUsageState(1000, runtimeEnv, config);
    trackTaskUsage(usage, { type: "stdout", line: "abcd", at: new Date().toISOString() }, () => 1000);
    expect(usage.estimatedCostUsd).toBeCloseTo(0.008);
  });

  it("prefers actual usage events over local text estimates", () => {
    const config: RuntimeConfig = {
      defaultModelProfileId: "default",
      modelProfiles: [{ id: "default", provider: "openai", model: "gpt-5.4" }],
      updateSources: {},
    };
    const runtimeEnv: EngineRuntimeEnv = {
      profileId: "default",
      provider: "openai",
      model: "gpt-5.4",
      env: {},
    };

    const usage = createTaskUsageState(1000, runtimeEnv, config);
    trackTaskUsage(usage, {
      type: "usage",
      source: "actual",
      inputTokens: 120,
      outputTokens: 80,
      estimatedCostUsd: 0.0042,
      totalTokens: 230,
      cacheReadTokens: 10,
      reasoningTokens: 20,
      contextTokens: 180,
      contextWindow: 1000,
      contextPercent: 18,
      message: "actual",
      at: new Date().toISOString(),
    }, () => 9999);
    trackTaskUsage(usage, { type: "stdout", line: "this should not inflate actual usage", at: new Date().toISOString() }, () => 9999);
    trackTaskUsage(usage, {
      type: "usage",
      source: "estimated",
      inputTokens: 9999,
      outputTokens: 9999,
      totalTokens: 19998,
      contextTokens: 19998,
      contextWindow: 20000,
      estimatedCostUsd: 999,
      message: "late estimate",
      at: new Date().toISOString(),
    }, () => 9999);

    expect(usage.source).toBe("actual");
    expect(usage.inputTokens).toBe(120);
    expect(usage.outputTokens).toBe(80);
    expect(usage.totalTokens).toBe(230);
    expect(usage.cacheReadTokens).toBe(10);
    expect(usage.reasoningTokens).toBe(20);
    expect(usage.contextTokens).toBe(180);
    expect(usage.contextWindow).toBe(1000);
    expect(usage.contextPercent).toBe(18);
    expect(usage.estimatedCostUsd).toBe(0.0042);
  });

  it("counts streamed message chunks and does not double count the final result", () => {
    const config: RuntimeConfig = {
      defaultModelProfileId: "default",
      modelProfiles: [{ id: "default", provider: "openai", model: "gpt-5.4" }],
      updateSources: {},
    };
    const runtimeEnv: EngineRuntimeEnv = {
      profileId: "default",
      provider: "openai",
      model: "gpt-5.4",
      env: {},
    };

    const usage = createTaskUsageState(100, runtimeEnv, config);
    trackTaskUsage(usage, { type: "message_chunk", content: "abcd", at: new Date().toISOString() }, () => 1);
    trackTaskUsage(usage, { type: "result", success: true, title: "done", detail: "abcd", at: new Date().toISOString() }, () => 999);

    expect(usage.outputTokens).toBe(1);
    expect(usage.totalTokens).toBe(101);
  });

  it("uses the shared mixed Chinese and English token estimator", () => {
    expect(estimateTextTokens("abcd")).toBe(1);
    expect(estimateTextTokens("你好世界")).toBe(4);
    expect(estimateTextTokens("hello 你好")).toBe(4);
  });
});
