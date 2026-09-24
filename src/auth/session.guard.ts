import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC } from './auth.decorators';
import { AuthService, SessionAccount } from './auth.service';
import { readSessionCookie } from './session-cookie';

export type AuthenticatedRequest = Request & {
  auth?: SessionAccount;
};

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.auth = await this.authService.authenticate(
      readSessionCookie(request.headers.cookie),
    );
    return true;
  }
}
