import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  INestApplication,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import * as request from 'supertest';
import { closeTestApp, createTestApp } from '../requests/test-helpers';
import { HttpErrorLoggingFilter } from './http-error.filter';
import { startupLogLine } from './startup-log';

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('startup log', () => {
  it('names the environment, port, and trust proxy without configuration values', () => {
    const line = startupLogLine('production', 3000, true);
    expect(line).toContain('Application started');
    expect(line).toContain('NODE_ENV=production');
    expect(line).toContain('port=3000');
    expect(line).toContain('trustProxy=true');
    expect(startupLogLine(undefined, 3000, false)).toContain('NODE_ENV=unset');
    expect(startupLogLine('postgresql://user:secret@localhost/db', 3000, false)).toContain(
      'NODE_ENV=invalid',
    );
    expect(startupLogLine('postgresql://user:secret@localhost/db', 3000, false)).not.toContain(
      'secret',
    );
  });
});

describe('HTTP request logging', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('returns a generated request id when none is supplied', async () => {
    const response = await request(app.getHttpServer()).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toMatch(REQUEST_ID);
  });

  it('preserves a safe incoming request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Request-Id', 'trace-123');
    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe('trace-123');
  });

  it('replaces an unsafe request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Request-Id', 'not safe');
    expect(response.headers['x-request-id']).toMatch(REQUEST_ID);
    expect(response.headers['x-request-id']).not.toBe('not safe');
  });

  it('logs a failed request without the body', async () => {
    const logs: string[] = [];
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    const password = 'login-password-that-must-not-be-logged';
    try {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Request-Id', 'login-trace-9')
        .send({ email: 'person@example.test', password });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(response.body)).not.toContain(password);
      const printed = logs.join('\n');
      expect(printed).toContain('HTTP POST /auth/login');
      expect(printed).toContain(`status=${response.status}`);
      expect(printed).toContain('requestId=login-trace-9');
      expect(printed).not.toContain(password);
      expect(printed).not.toContain('person@example.test');
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('unhandled HTTP errors', () => {
  it('returns a sanitized 500 and logs the category without the exception text', () => {
    const response = { body: undefined as unknown, status: 0 };
    const adapter = {
      isHeadersSent: () => false,
      reply: (_res: unknown, body: unknown, status: number) => {
        response.body = body;
        response.status = status;
      },
      end: () => undefined,
    };
    const filter = new HttpErrorLoggingFilter({ httpAdapter: adapter } as unknown as HttpAdapterHost);
    const logs: string[] = [];
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', path: '/boom', requestId: 'req-500' }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
    const secret = 'postgres://user:super-secret@localhost:5432/operations_hub';

    try {
      filter.catch(Object.assign(new Error(`connect failed ${secret}`), { code: 'ECONNREFUSED' }), host);
    } finally {
      errorSpy.mockRestore();
    }

    expect(response.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.body).toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });
    const printed = logs.join('\n');
    expect(printed).toContain('HTTP GET /boom');
    expect(printed).toContain('status=500');
    expect(printed).toContain('requestId=req-500');
    expect(printed).toContain('category=unhandled');
    expect(printed).toContain('code=ECONNREFUSED');
    expect(printed).not.toContain(secret);
    expect(printed).not.toContain('super-secret');
  });

  it('logs fixed 4xx messages and omits messages that embed user text', () => {
    const response = { body: undefined as unknown, status: 0 };
    const adapter = {
      isHeadersSent: () => false,
      reply: (_res: unknown, body: unknown, status: number) => {
        response.body = body;
        response.status = status;
      },
      end: () => undefined,
    };
    const filter = new HttpErrorLoggingFilter({ httpAdapter: adapter } as unknown as HttpAdapterHost);
    const logs: string[] = [];
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', path: '/departments/1/request-types', requestId: 'req-4xx' }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
    const typeName = 'user@example.com secret-description';

    try {
      filter.catch(
        new ConflictException(`A request type named "${typeName}" already exists in this department`),
        host,
      );
      filter.catch(new ForbiddenException('This origin is not allowed to sign in.'), host);
      filter.catch(
        new BadRequestException({
          message: [`property ${typeName} should not exist`],
          error: 'Bad Request',
          statusCode: 400,
        }),
        host,
      );
    } finally {
      errorSpy.mockRestore();
    }

    expect(response.body).toEqual({
      message: [`property ${typeName} should not exist`],
      error: 'Bad Request',
      statusCode: 400,
    });
    const printed = logs.join('\n');
    expect(printed).toContain('category=ConflictException');
    expect(printed).toContain('message=This origin is not allowed to sign in.');
    expect(printed).toContain('code=validation');
    expect(printed).not.toContain(typeName);
    expect(printed).not.toContain('secret-description');
  });
});
