import {
  Injectable,
  MiddlewareConsumer,
  Module,
  NestMiddleware,
  NestModule,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { NextFunction, Response } from 'express';
import { AuthController, HealthController } from './auth.controller';
import { AuthResponseInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { CsrfGuard } from './csrf.guard';
import { EmailSender } from './email-sender';
import { LoginRateLimiter } from './login-rate-limit';
import { SessionGuard } from './session.guard';

@Injectable()
export class NoStoreAuthMiddleware implements NestMiddleware {
  use(_request: unknown, response: Response, next: NextFunction) {
    response.setHeader('Cache-Control', 'private, no-store');
    next();
  }
}

@Module({
  controllers: [AuthController, HealthController],
  providers: [
    AuthService,
    EmailSender,
    LoginRateLimiter,
    NoStoreAuthMiddleware,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_INTERCEPTOR, useClass: AuthResponseInterceptor },
  ],
  exports: [AuthService, EmailSender, LoginRateLimiter],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NoStoreAuthMiddleware).forRoutes(AuthController);
  }
}
