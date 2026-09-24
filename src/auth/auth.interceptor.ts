import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { concatMap, Observable } from 'rxjs';
import { RECORDS_ACTIVITY } from './auth.decorators';
import { AuthService } from './auth.service';
import { AuthenticatedRequest } from './session.guard';

@Injectable()
export class AuthResponseInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<{ setHeader: (name: string, value: string) => void }>();
    const url = request.originalUrl ?? request.url ?? '';
    if (url.startsWith('/auth')) {
      response.setHeader('Cache-Control', 'private, no-store');
    }
    const recordsActivity = this.reflector.get<boolean>(RECORDS_ACTIVITY, context.getHandler());
    return next.handle().pipe(
      concatMap(async (body) => {
        if (recordsActivity && request.auth) {
          try {
            await this.authService.touchActivity(request.auth.sessionId);
          } catch {
            // The business change is already committed. Losing the activity
            // stamp must not turn that success into an error. The next
            // request still enforces revocation, idle expiry, and absolute expiry.
            console.error('Session activity was not recorded.');
          }
        }
        return body;
      }),
    );
  }
}
