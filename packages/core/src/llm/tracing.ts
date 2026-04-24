import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  chatCompletion,
  chatWithTools,
  type AgentMessage,
  type ChatWithToolsResult,
  type LLMClient,
  type LLMMessage,
  type LLMResponse,
  type OnStreamProgress,
  type ToolDefinition,
} from "./provider.js";
import type { Logger } from "../utils/logger.js";

export interface RawLLMTraceContext {
  readonly projectRoot: string;
  readonly agent: string;
  readonly promptId?: string;
  readonly bookId?: string;
  readonly logger?: Logger;
}

async function appendRawLLMTrace(
  projectRoot: string,
  payload: Record<string, unknown>,
  logger?: Logger,
): Promise<void> {
  try {
    await appendFile(
      join(projectRoot, "inkos-ai.log"),
      `${JSON.stringify(payload)}\n`,
      "utf-8",
    );
  } catch (error) {
    logger?.warn(`Failed to append raw agent trace: ${String(error)}`);
  }
}

function buildCommonTracePayload(
  client: LLMClient,
  model: string,
  trace: RawLLMTraceContext,
  traceId: string,
): Record<string, unknown> {
  return {
    traceId,
    promptId: trace.promptId,
    agent: trace.agent,
    bookId: trace.bookId,
    model,
    provider: client.provider,
    baseUrl: client.baseUrl,
  };
}

function resolveClientDefaults(client: LLMClient): {
  readonly temperature?: number;
  readonly maxTokens?: number;
} {
  return {
    temperature: client.defaults?.temperature,
    maxTokens: client.defaults?.maxTokens,
  };
}

export async function tracedChatCompletion(
  client: LLMClient,
  model: string,
  messages: ReadonlyArray<LLMMessage>,
  options: {
    readonly temperature?: number;
    readonly maxTokens?: number;
    readonly webSearch?: boolean;
    readonly onStreamProgress?: OnStreamProgress;
    readonly onTextDelta?: (text: string) => void;
  } | undefined,
  trace: RawLLMTraceContext,
): Promise<LLMResponse> {
  const traceId = randomUUID();
  const common = buildCommonTracePayload(client, model, trace, traceId);
  const defaults = resolveClientDefaults(client);

  await appendRawLLMTrace(trace.projectRoot, {
    timestamp: new Date().toISOString(),
    phase: "request",
    mode: "chat",
    ...common,
    temperature: options?.temperature ?? defaults.temperature,
    maxTokens: options?.maxTokens ?? defaults.maxTokens,
    webSearch: options?.webSearch ?? false,
    messages,
  }, trace.logger);

  try {
    const response = await chatCompletion(client, model, messages, options);
    await appendRawLLMTrace(trace.projectRoot, {
      timestamp: new Date().toISOString(),
      phase: "response",
      mode: "chat",
      ...common,
      content: response.content,
      usage: response.usage,
    }, trace.logger);
    return response;
  } catch (error) {
    await appendRawLLMTrace(trace.projectRoot, {
      timestamp: new Date().toISOString(),
      phase: "error",
      mode: "chat",
      ...common,
      error: String(error),
    }, trace.logger);
    throw error;
  }
}

export async function tracedChatWithTools(
  client: LLMClient,
  model: string,
  messages: ReadonlyArray<AgentMessage>,
  tools: ReadonlyArray<ToolDefinition>,
  options: {
    readonly temperature?: number;
    readonly maxTokens?: number;
  } | undefined,
  trace: RawLLMTraceContext,
): Promise<ChatWithToolsResult> {
  const traceId = randomUUID();
  const common = buildCommonTracePayload(client, model, trace, traceId);
  const defaults = resolveClientDefaults(client);

  await appendRawLLMTrace(trace.projectRoot, {
    timestamp: new Date().toISOString(),
    phase: "request",
    mode: "tools",
    ...common,
    temperature: options?.temperature ?? defaults.temperature,
    maxTokens: options?.maxTokens ?? defaults.maxTokens,
    messages,
    tools,
  }, trace.logger);

  try {
    const response = await chatWithTools(client, model, messages, tools, options);
    await appendRawLLMTrace(trace.projectRoot, {
      timestamp: new Date().toISOString(),
      phase: "response",
      mode: "tools",
      ...common,
      content: response.content,
      toolCalls: response.toolCalls,
    }, trace.logger);
    return response;
  } catch (error) {
    await appendRawLLMTrace(trace.projectRoot, {
      timestamp: new Date().toISOString(),
      phase: "error",
      mode: "tools",
      ...common,
      error: String(error),
    }, trace.logger);
    throw error;
  }
}
