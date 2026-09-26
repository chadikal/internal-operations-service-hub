import { Logger } from '@nestjs/common';
import { AiProvider, AiProviderInput } from './ai-provider';
import { INTAKE_JSON_SCHEMA } from './intake-json-schema';
import { buildSystemPrompt, buildUserPrompt } from './intake-prompt';
import { InvalidAiOutputError } from './invalid-ai-output.error';

export const DEFAULT_REQUESTY_MODEL = 'mistral/leanstral-1-5';
export const REQUESTY_CHAT_COMPLETIONS_URL =
  'https://router.requesty.ai/v1/chat/completions';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 400;
export const REQUEST_TIMEOUT_MS = 90_000;

const MAX_UPSTREAM_ERROR_LENGTH = 500;

type RequestyResponse = Pick<Response, 'ok' | 'status' | 'json'> & {
  text?: () => Promise<string>;
};

type RequestyFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<RequestyResponse>;

export class RequestyAiProvider implements AiProvider {
  private readonly logger = new Logger(RequestyAiProvider.name);

  constructor(private readonly fetchImpl: RequestyFetch = fetch as RequestyFetch) {}

  async complete(input: AiProviderInput): Promise<unknown> {
    const apiKey = process.env.REQUESTY_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('Requesty is not configured');
    }

    const model = resolveRequestyModel();
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(input.employeeText, input.departments, input.requestTypes) },
      ],
      max_tokens: 4096,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'intake_result',
          schema: INTAKE_JSON_SCHEMA,
        },
      },
    });

    const outcome = await this.requestWithRetry(apiKey, body, model);
    const payload = await outcome.response.json();
    const text = extractAssistantContent(payload);
    const facts = attemptFacts(model, outcome.attempt, outcome.elapsedMs, outcome.response.status);
    if (text === null) {
      throw new InvalidAiOutputError(`Requesty returned no JSON text${facts} contentKind=empty`);
    }
    try {
      const parsed = parseJsonText(text);
      this.logIntake(
        `Requesty intake completed${facts} finishReason=${finishReason(payload)} completionTokens=${completionTokens(payload)}`,
      );
      return parsed;
    } catch (error) {
      if (error instanceof InvalidAiOutputError) {
        throw new InvalidAiOutputError(
          `${error.message}${facts} contentKind=${contentKind(text)} contentLength=${text.length}`,
        );
      }
      throw error;
    }
  }

  private async requestWithRetry(
    apiKey: string,
    body: string,
    model: string,
  ): Promise<{ response: RequestyResponse; attempt: number; elapsedMs: number }> {
    let lastError: Error | null = null;
    const earlier: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const started = Date.now();
      try {
        const response = await this.fetchImpl(REQUESTY_CHAT_COMPLETIONS_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const elapsedMs = Date.now() - started;
        if (response.ok) {
          return { response, attempt, elapsedMs };
        }
        const failure = new Error(
          formatHttpFailure(
            response.status,
            await readUpstreamDetail(response),
            attempt,
            earlier,
            model,
            elapsedMs,
          ),
        );
        if (!isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS) {
          throw failure;
        }
        earlier.push(String(response.status));
        lastError = failure;
      } catch (error) {
        const elapsedMs = Date.now() - started;
        if (error instanceof InvalidAiOutputError || isUpstreamHttpFailure(error)) {
          throw error;
        }
        if (isTimeoutError(error)) {
          throw new Error(formatTimeoutFailure(error, attempt, earlier, model, elapsedMs));
        }
        lastError = new Error(formatNetworkFailure(error, attempt, earlier, model, elapsedMs));
        if (attempt === MAX_ATTEMPTS) {
          throw lastError;
        }
        earlier.push(networkAttemptLabel(error));
      }
      await waitForRetry();
    }

    throw lastError ?? new Error('Requesty request failed');
  }

  private logIntake(line: string) {
    if (process.env.JEST_WORKER_ID !== undefined) {
      return;
    }
    this.logger.log(line);
  }
}

function resolveRequestyModel(): string {
  const configured = process.env.REQUESTY_MODEL?.trim();
  if (!configured) {
    return DEFAULT_REQUESTY_MODEL;
  }
  return configured;
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

function isUpstreamHttpFailure(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Requesty request failed with status ');
}

function formatHttpFailure(
  status: number,
  detail: string,
  attempt: number,
  earlier: string[],
  model: string,
  elapsedMs: number,
): string {
  return `Requesty request failed with status ${status} on attempt ${attempt}: ${detail}${earlierSuffix(earlier)}${attemptFacts(model, attempt, elapsedMs, status)}`;
}

function formatTimeoutFailure(
  error: unknown,
  attempt: number,
  earlier: string[],
  model: string,
  elapsedMs: number,
): string {
  return `Requesty request timed out (${errorLabel(error, 'TimeoutError')}) on attempt ${attempt}${earlierSuffix(earlier)}${attemptFacts(model, attempt, elapsedMs, 'none')}`;
}

function formatNetworkFailure(
  error: unknown,
  attempt: number,
  earlier: string[],
  model: string,
  elapsedMs: number,
): string {
  return `Requesty request failed (${errorLabel(error, 'Error')}) on attempt ${attempt}${earlierSuffix(earlier)}${attemptFacts(model, attempt, elapsedMs, 'none')}`;
}

function attemptFacts(
  model: string,
  attempt: number,
  elapsedMs: number,
  httpStatus: number | 'none',
): string {
  return ` model=${model} attempt=${attempt} elapsedMs=${elapsedMs} httpStatus=${httpStatus} timeoutMs=${REQUEST_TIMEOUT_MS}`;
}

function finishReason(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') {
    return 'none';
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return 'none';
  }
  const reason = (choices[0] as { finish_reason?: unknown }).finish_reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim() : 'none';
}

function completionTokens(payload: unknown): number | 'none' {
  if (payload === null || typeof payload !== 'object') {
    return 'none';
  }
  const usage = (payload as { usage?: { completion_tokens?: unknown } }).usage;
  return typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 'none';
}

function contentKind(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    return 'json-object';
  }
  if (trimmed.startsWith('```')) {
    return 'fenced';
  }
  if (/^<think>/i.test(trimmed)) {
    return 'think-tag';
  }
  return 'other';
}

function earlierSuffix(earlier: string[]): string {
  return earlier.length > 0 ? `; earlier attempts: ${earlier.join(', ')}` : '';
}

function errorLabel(error: unknown, fallbackName: string): string {
  if (!(error instanceof Error)) {
    return `${fallbackName}: unknown error`;
  }
  return `${error.name}: ${sanitizeUpstreamDetail(error.message)}`;
}

function networkAttemptLabel(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'network';
  }
  return `network ${error.name}`;
}

async function readUpstreamDetail(response: RequestyResponse): Promise<string> {
  try {
    if (typeof response.text === 'function') {
      return sanitizeUpstreamDetail(await response.text());
    }
    const payload = await response.json();
    return sanitizeUpstreamDetail(payload === undefined ? '' : JSON.stringify(payload));
  } catch {
    return 'unreadable error body';
  }
}

function sanitizeUpstreamDetail(raw: string): string {
  const summary = summarizeIfJson(raw) ?? raw;
  const collapsed = summary.replace(/\s+/g, ' ').trim() || 'empty error body';
  const redacted = redactSecrets(collapsed);
  if (redacted.length <= MAX_UPSTREAM_ERROR_LENGTH) {
    return redacted;
  }
  return `${redacted.slice(0, MAX_UPSTREAM_ERROR_LENGTH)}…`;
}

function summarizeIfJson(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }
  try {
    return summarizeErrorPayload(JSON.parse(trimmed) as unknown);
  } catch {
    return null;
  }
}

function summarizeErrorPayload(payload: unknown): string | null {
  if (typeof payload === 'string') {
    return payload;
  }
  if (payload === null || typeof payload !== 'object') {
    return null;
  }
  const error = (payload as { error?: unknown }).error;
  if (typeof error === 'string') {
    return error;
  }
  if (error !== null && typeof error === 'object') {
    return formatErrorFields(error as Record<string, unknown>);
  }
  return formatErrorFields(payload as Record<string, unknown>);
}

function formatErrorFields(record: Record<string, unknown>): string | null {
  const parts = ['status', 'code', 'type', 'message'].flatMap((key) => {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return [`${key}=${value.trim()}`];
    }
    if (typeof value === 'number') {
      return [`${key}=${value}`];
    }
    return [];
  });
  return parts.length > 0 ? parts.join(' ') : null;
}

function redactSecrets(value: string): string {
  let redacted = value.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  const apiKey = process.env.REQUESTY_API_KEY?.trim();
  if (apiKey && apiKey.length >= 8) {
    redacted = redacted.split(apiKey).join('[redacted]');
  }
  return redacted;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503;
}

function waitForRetry(): Promise<void> {
  const delayMs = process.env.JEST_WORKER_ID !== undefined ? 0 : RETRY_DELAY_MS;
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function extractAssistantContent(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') {
    return null;
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const message = (choices[0] as { message?: Record<string, unknown> }).message;
  if (!message || typeof message !== 'object') {
    return null;
  }

  const fromContent = contentToText(message.content);
  if (fromContent) {
    return fromContent;
  }
  if (typeof message.reasoning === 'string' && message.reasoning.trim()) {
    return message.reasoning.trim();
  }
  if (message.parsed !== null && typeof message.parsed === 'object') {
    try {
      return JSON.stringify(message.parsed);
    } catch {
      return null;
    }
  }
  return null;
}

function contentToText(content: unknown): string | null {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        typeof part === 'string'
          ? part
          : typeof part === 'object' && part && 'text' in part
            ? String(part.text)
            : '',
      )
      .join('')
      .trim();
    return text.length > 0 ? text : null;
  }
  return null;
}

function parseJsonText(text: string): unknown {
  const prepared = prepareJsonText(text);
  try {
    return JSON.parse(prepared);
  } catch {
    const objects = extractJsonObjects(prepared);
    const intake = [...objects].reverse().find(isIntakeShaped);
    if (intake !== undefined) {
      return intake;
    }
    if (objects.length > 0) {
      return objects[objects.length - 1];
    }
    throw new InvalidAiOutputError('Requesty returned malformed JSON');
  }
}

function prepareJsonText(text: string): string {
  return text
    .trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, ' ')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function isIntakeShaped(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'situation' in value
  );
}

function extractJsonObjects(text: string): unknown[] {
  const objects: unknown[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') {
      continue;
    }
    const parsed = parseBalancedObject(text, i);
    if (parsed !== undefined) {
      objects.push(parsed.value);
      i = parsed.endIndex;
    }
  }
  return objects;
}

function parseBalancedObject(
  text: string,
  start: number,
): { value: unknown; endIndex: number } | undefined {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return { value: JSON.parse(text.slice(start, i + 1)), endIndex: i };
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}
