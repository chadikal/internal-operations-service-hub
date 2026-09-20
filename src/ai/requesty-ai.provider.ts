import { AiProvider, AiProviderInput } from './ai-provider';
import { INTAKE_JSON_SCHEMA } from './intake-json-schema';
import { buildSystemPrompt, buildUserPrompt } from './intake-prompt';
import { InvalidAiOutputError } from './invalid-ai-output.error';

export const DEFAULT_REQUESTY_MODEL = 'nemotron-3.5-lightning-30b-a3b';
export const REQUESTY_CHAT_COMPLETIONS_URL =
  'https://router.requesty.ai/v1/chat/completions';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 400;

type RequestyFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export class RequestyAiProvider implements AiProvider {
  constructor(private readonly fetchImpl: RequestyFetch = fetch as RequestyFetch) {}

  async complete(input: AiProviderInput): Promise<unknown> {
    const apiKey = process.env.REQUESTY_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('Requesty is not configured');
    }

    const model = process.env.REQUESTY_MODEL?.trim() || DEFAULT_REQUESTY_MODEL;
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(input.employeeText, input.departments) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'intake_result',
          schema: INTAKE_JSON_SCHEMA,
        },
      },
    });

    const response = await this.requestWithRetry(apiKey, body);
    if (!response.ok) {
      throw new Error(`Requesty request failed with status ${response.status}`);
    }

    const payload = await response.json();
    const text = extractAssistantContent(payload);
    if (text === null) {
      throw new InvalidAiOutputError('Requesty returned no JSON text');
    }
    return parseJsonText(text);
  }

  private async requestWithRetry(
    apiKey: string,
    body: string,
  ): Promise<Pick<Response, 'ok' | 'status' | 'json'>> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.fetchImpl(REQUESTY_CHAT_COMPLETIONS_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body,
          signal: AbortSignal.timeout(20_000),
        });
        if (response.ok || !isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS) {
          return response;
        }
      } catch (error) {
        if (error instanceof InvalidAiOutputError) {
          throw error;
        }
        lastError = new Error('Requesty request failed');
        if (attempt === MAX_ATTEMPTS) {
          throw lastError;
        }
      }
      await waitForRetry();
    }

    throw lastError ?? new Error('Requesty request failed');
  }
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
    throw new InvalidAiOutputError('Requesty returned malformed JSON');
  }
}
