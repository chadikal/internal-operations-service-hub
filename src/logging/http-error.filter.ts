import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { currentRequestId } from './request-context';
import { RequestWithId } from './request-id.middleware';

@Catch()
export class HttpErrorLoggingFilter implements ExceptionFilter {
  private readonly httpLogger = new Logger('Http');

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === 'http') {
      this.logFailure(exception, host);
    }
    if (exception instanceof HttpException) {
      this.reply(host, httpExceptionBody(exception), exception.getStatus());
      return;
    }
    this.replyUnknown(exception, host);
  }

  private logFailure(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const status = statusOf(exception);
    if (status < 400) {
      return;
    }
    const requestId = request.requestId ?? currentRequestId();
    this.httpLogger.error(
      `HTTP ${request.method ?? 'unknown'} ${requestPath(request)} status=${status} requestId=${requestId} ${categoryOf(exception)}`,
    );
  }

  private replyUnknown(exception: unknown, host: ArgumentsHost): void {
    const httpError = asHttpError(exception);
    const body = httpError
      ? { statusCode: httpError.statusCode, message: httpError.message }
      : {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
        };
    this.reply(host, body, body.statusCode);
  }

  private reply(host: ArgumentsHost, body: unknown, status: number): void {
    const adapter = this.adapterHost.httpAdapter;
    const response = host.switchToHttp().getResponse<unknown>();
    if (!adapter.isHeadersSent(response)) {
      adapter.reply(response, body, status);
    } else {
      adapter.end(response);
    }
  }
}

function httpExceptionBody(exception: HttpException): unknown {
  const response = exception.getResponse();
  if (response !== null && typeof response === 'object') {
    return response;
  }
  return {
    statusCode: exception.getStatus(),
    message: response,
  };
}

function statusOf(exception: unknown): number {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }
  return asHttpError(exception)?.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
}

function categoryOf(exception: unknown): string {
  if (exception instanceof HttpException) {
    const detail = httpExceptionLogDetail(exception.getResponse());
    const parts = [`category=${exception.constructor.name}`];
    if (detail.code) {
      parts.push(`code=${detail.code}`);
    }
    if (detail.message) {
      parts.push(`message=${detail.message}`);
    }
    return parts.join(' ');
  }
  if (exception instanceof Error) {
    const code = safeErrorCode(exception);
    return `category=unhandled name=${exception.name}${code ? ` code=${code}` : ''}`;
  }
  return 'category=unhandled name=unknown';
}

const SAFE_FIXED_MESSAGES = new Set([
  'Another person cannot be assigned. An eligible handler claims the request.',
  'An account with this email already exists',
  'A current owner must be assigned before a status transition',
  'A denied request cannot be handled',
  'A department with employees or requests cannot be deleted',
  'A request type that is used by requests cannot be removed',
  'Authentication is required',
  'Available requests are already limited to work you can claim',
  'changedBy must match the acting user',
  'Claim status filters only the requests you submitted',
  'companyName is required',
  'Completed requests are already limited to work you finished',
  'Completed work is on the Completed list',
  'Confirmed request types must not use the same name more than once',
  'CSRF token is missing or invalid',
  'Current password is incorrect',
  'Denial requires a reason',
  'departmentId is required',
  'Department names must be unique',
  'email must be a valid email address',
  'Email could not be sent. Try again later.',
  'Email delivery is not configured. Company signup, invitations, and password reset cannot run until a mail provider is chosen.',
  'Filter department approval requests by approval state',
  'Invalid email or password',
  'name is required',
  'name or approvalPolicy is required',
  'No staff changes were provided',
  'Only a Department Admin can view this department',
  'Only a Super Admin can manage this company',
  'Only the current owner can update the request status',
  'password must be at least 12 characters',
  'Passwords do not match',
  'The intake assistant is unavailable. Try again later.',
  'The intake assistant returned an invalid result.',
  'The last Super Admin cannot be removed',
  'This account still owns unfinished work',
  'This link has already been used.',
  'This link is invalid or expired.',
  'This origin is not allowed to sign in.',
  'This request already has an approval decision',
  'This request already has an owner',
  'This request cannot be claimed',
  'This request does not require an approval decision',
  'This request is waiting for approval and cannot be handled yet',
  'Too many attempts. Try again later.',
  'Too many login attempts. Try again later.',
  'Unknown department template',
  'Use work status to filter requests you have claimed',
  'You are not allowed to claim requests',
  'You are not allowed to decide this request',
  'You are not allowed to handle requests',
  'You are not allowed to review approvals',
  'You are not allowed to view department approval requests',
  'You are not allowed to view requests',
  'You are not allowed to view this request',
  'You are not assigned to a department',
  'You can claim requests only in your department',
  'You can only edit your own department',
  'You can only invite employees',
  'You can only invite staff into your own department',
  'You can only manage employees in your department',
  'You can only submit requests as yourself',
  'You cannot approve or deny your own request',
  'You cannot change your own access',
  'You cannot claim a request you submitted',
  'You cannot remove your own account',
]);

const SAFE_ID_MESSAGE =
  /^(?:Request|Employee|Department|Request type) \d+ was not found$/;
const SAFE_TRANSITION_MESSAGE =
  /^Transition from (?:SUBMITTED|IN_PROGRESS|COMPLETED) to (?:SUBMITTED|IN_PROGRESS|COMPLETED) is not allowed$/;

function httpExceptionLogDetail(response: string | object): { message?: string; code?: string } {
  if (typeof response === 'string') {
    return { message: safeFixedMessage(response) };
  }
  if (Array.isArray(response)) {
    return { code: 'validation' };
  }
  if (response === null || typeof response !== 'object') {
    return {};
  }
  const record = response as Record<string, unknown>;
  if (Array.isArray(record.message)) {
    return { code: 'validation' };
  }
  if (typeof record.message === 'string') {
    return { message: safeFixedMessage(record.message) };
  }
  if (record.status === 'not_ready') {
    return { message: 'not_ready' };
  }
  return {};
}

function safeFixedMessage(value: string): string | undefined {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (
    SAFE_FIXED_MESSAGES.has(collapsed) ||
    SAFE_ID_MESSAGE.test(collapsed) ||
    SAFE_TRANSITION_MESSAGE.test(collapsed)
  ) {
    return collapsed;
  }
  return undefined;
}

function safeErrorCode(error: Error): string | undefined {
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string' || !/^[A-Za-z0-9_]{1,32}$/.test(code)) {
    return undefined;
  }
  return code;
}

function requestPath(request: RequestWithId): string {
  const raw = request.path || request.originalUrl || request.url || 'unknown';
  const withoutQuery = raw.split('?')[0] || 'unknown';
  return withoutQuery.slice(0, 200);
}

function asHttpError(exception: unknown): { statusCode: number; message: string } | undefined {
  if (typeof exception !== 'object' || exception === null) {
    return undefined;
  }
  const record = exception as { statusCode?: unknown; message?: unknown };
  if (typeof record.statusCode !== 'number' || typeof record.message !== 'string') {
    return undefined;
  }
  return { statusCode: record.statusCode, message: record.message };
}
