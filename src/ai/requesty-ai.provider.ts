import { AiProvider, AiProviderInput } from './ai-provider';
import { INTAKE_JSON_SCHEMA } from './intake-json-schema';
import { buildSystemPrompt, buildUserPrompt } from './intake-prompt';
import { InvalidAiOutputError } from './invalid-ai-output.error';

export const DEFAULT_REQUESTY_MODEL = 'gemma-4-31b-it';
export const REQUESTY_CHAT_COMPLETIONS_URL =
  'https://router.requesty.ai/v1/chat/completions';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 400;
const REQUEST_TIMEOUT_MS = 30_000;

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
        { role: 'user', content: buildUserPrompt(input.employeeText, input.departments) },
      ],
      max_tokens: 1024,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'intake_result',
          schema: INTAKE_JSON_SCHEMA,
        },
      },
    });

    const response = await this.requestWithRetry(apiKey, body);
    const payload = await response.json();
    const text = extractAssistantContent(payload);
    if (text === null) {
      throw new InvalidAiOutputError('Requesty returned no JSON text');
    }
    return parseJsonText(text);
  }

  private async requestWithRetry(apiKey: string, body: string): Promise<RequestyResponse> {
    let lastError: Error | null = null;
    const earlier: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
        if (response.ok) {
          return response;
        }
        const failure = new Error(
          formatHttpFailure(response.status, await readUpstreamDetail(response), attempt, earlier),
        );
        if (!isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS) {
          throw failure;
        }
        earlier.push(String(response.status));
        lastError = failure;
      } catch (error) {
        if (error instanceof InvalidAiOutputError || isUpstreamHttpFailure(error)) {
          throw error;
        }
        if (isTimeoutError(error)) {
          throw new Error(formatTimeoutFailure(error, attempt, earlier));
        }
        lastError = new Error(formatNetworkFailure(error, attempt, earlier));
        if (attempt === MAX_ATTEMPTS) {
          throw lastError;
        }
        earlier.push(networkAttemptLabel(error));
      }
      await waitForRetry();
    }

    throw lastError ?? new Error('Requesty request failed');
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
): string {
  return `Requesty request failed with status ${status} on attempt ${attempt}: ${detail}${earlierSuffix(earlier)}`;
}

function formatTimeoutFailure(error: unknown, attempt: number, earlier: string[]): string {
  return `Requesty request timed out (${errorLabel(error, 'TimeoutError')}) on attempt ${attempt}${earlierSuffix(earlier)}`;
}

function formatNetworkFailure(error: unknown, attempt: number, earlier: string[]): string {
  return `Requesty request failed (${errorLabel(error, 'Error')}) on attempt ${attempt}${earlierSuffix(earlier)}`;
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
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
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
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1));
      } catch {
        // The surrounding text is not a JSON object either.
      }
    }
    throw new InvalidAiOutputError('Requesty returned malformed JSON');
  }
}
