import { InvalidAiOutputError } from './invalid-ai-output.error';
import { buildSystemPrompt } from './intake-prompt';
import {
  DEFAULT_REQUESTY_MODEL,
  REQUESTY_CHAT_COMPLETIONS_URL,
  RequestyAiProvider,
} from './requesty-ai.provider';

const departments = [{ id: 1, name: 'IT' }];

const intakeJson = {
  situation: 'need',
  troubleshootingSteps: [],
  missingInformation: [],
  draft: { departmentId: 1, summary: 'Laptop', description: 'I need a laptop.' },
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function chatCompletion(content: string) {
  return {
    choices: [{ message: { content } }],
  };
}

describe('RequestyAiProvider', () => {
  const previousKey = process.env.REQUESTY_API_KEY;
  const previousModel = process.env.REQUESTY_MODEL;

  afterEach(() => {
    if (previousKey === undefined) {
      delete process.env.REQUESTY_API_KEY;
    } else {
      process.env.REQUESTY_API_KEY = previousKey;
    }
    if (previousModel === undefined) {
      delete process.env.REQUESTY_MODEL;
    } else {
      process.env.REQUESTY_MODEL = previousModel;
    }
  });

  it('throws when REQUESTY_API_KEY is missing', async () => {
    delete process.env.REQUESTY_API_KEY;
    const fetchImpl = jest.fn();
    const provider = new RequestyAiProvider(fetchImpl);

    await expect(
      provider.complete({ employeeText: 'I need a laptop.', departments }),
    ).rejects.toThrow('Requesty is not configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the chat completions endpoint, Bearer key, model, and json_schema', async () => {
    process.env.REQUESTY_API_KEY = 'test-key-not-real';
    delete process.env.REQUESTY_MODEL;
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(chatCompletion(JSON.stringify(intakeJson))),
    );
    const provider = new RequestyAiProvider(fetchImpl);

    const result = await provider.complete({
      employeeText: 'I need a laptop.',
      departments,
    });

    expect(result).toEqual(intakeJson);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe(REQUESTY_CHAT_COMPLETIONS_URL);
    expect(url).not.toContain('test-key-not-real');
    expect(init.headers.Authorization).toBe('Bearer test-key-not-real');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      response_format: {
        type: string;
        json_schema: { name: string; schema: { required?: string[] } };
      };
    };
    expect(body.model).toBe(DEFAULT_REQUESTY_MODEL);
    expect(body.messages[0]?.role).toBe('system');
    expect(body.messages[1]?.role).toBe('user');
    expect(body.messages[1]?.content).toContain('I need a laptop.');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.name).toBe('intake_result');
    expect(body.response_format.json_schema.schema.required).toEqual([
      'situation',
      'troubleshootingSteps',
      'missingInformation',
      'draft',
    ]);
  });

  it('uses REQUESTY_MODEL in the request body', async () => {
    process.env.REQUESTY_API_KEY = 'test-key-not-real';
    process.env.REQUESTY_MODEL = 'custom-requesty-model';
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(chatCompletion('{"situation":"need"}')));
    const provider = new RequestyAiProvider(fetchImpl);

    await provider.complete({ employeeText: 'I need a laptop.', departments });

    const [, init] = fetchImpl.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body).model).toBe('custom-requesty-model');
  });

  it('tells the model not to invent a draft for thin input', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toMatch(/I need help/);
    expect(prompt).toMatch(/set draft to null/);
    expect(prompt).toMatch(/situation "need" does not mean a draft is ready/);
  });

  it('throws on HTTP failure so the service can map it to 503', async () => {
    process.env.REQUESTY_API_KEY = 'test-key-not-real';
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ error: 'down' }, 503));
    const provider = new RequestyAiProvider(fetchImpl);

    await expect(
      provider.complete({ employeeText: 'I need a laptop.', departments }),
    ).rejects.toThrow(/Requesty request failed/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries a 429 and then returns structured JSON', async () => {
    process.env.REQUESTY_API_KEY = 'test-key-not-real';
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429))
      .mockResolvedValueOnce(jsonResponse(chatCompletion('{"situation":"need"}')));
    const provider = new RequestyAiProvider(fetchImpl);

    await expect(
      provider.complete({ employeeText: 'I need a laptop.', departments }),
    ).resolves.toEqual({ situation: 'need' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws on network failure so the service can map it to 503', async () => {
    process.env.REQUESTY_API_KEY = 'test-key-not-real';
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const provider = new RequestyAiProvider(fetchImpl);

    await expect(
      provider.complete({ employeeText: 'I need a laptop.', departments }),
    ).rejects.toThrow('Requesty request failed');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('treats malformed model text as invalid output', async () => {
    process.env.REQUESTY_API_KEY = 'test-key-not-real';
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(chatCompletion('not json')));
    const provider = new RequestyAiProvider(fetchImpl);

    await expect(
      provider.complete({ employeeText: 'I need a laptop.', departments }),
    ).rejects.toBeInstanceOf(InvalidAiOutputError);
  });

  it('treats a missing assistant message as invalid output', async () => {
    process.env.REQUESTY_API_KEY = 'test-key-not-real';
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ choices: [] }));
    const provider = new RequestyAiProvider(fetchImpl);

    await expect(
      provider.complete({ employeeText: 'I need a laptop.', departments }),
    ).rejects.toBeInstanceOf(InvalidAiOutputError);
  });
});
