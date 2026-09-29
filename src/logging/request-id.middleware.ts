import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { acceptRequestId, runWithRequestId } from './request-context';

export type RequestWithId = Request & { requestId?: string };

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const requestId = acceptRequestId(request.header('x-request-id')) ?? randomUUID();
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    runWithRequestId(requestId, () => next());
  }
}
