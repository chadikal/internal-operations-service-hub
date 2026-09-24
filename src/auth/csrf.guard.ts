import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from './auth.decorators';
import { AuthenticatedRequest } from './session.guard';
import { tokensMatch } from './session-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(request.method)) {
      return true;
    }
    const header = request.header('x-csrf-token');
    if (!request.auth || !header || !tokensMatch(header, request.auth.csrfToken)) {
      throw new ForbiddenException('CSRF token is missing or invalid');
    }
    return true;
  }
}
