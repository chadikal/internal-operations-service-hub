import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AdminModule } from './admin/admin.module';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { HttpErrorLoggingFilter } from './logging/http-error.filter';
import { RequestIdMiddleware } from './logging/request-id.middleware';
import { LookupsModule } from './lookups/lookups.module';
import { PrismaModule } from './prisma/prisma.module';
import { RequestsModule } from './requests/requests.module';

@Module({
  imports: [PrismaModule, AuthModule, HealthModule, RequestsModule, LookupsModule, AiModule, AdminModule],
  providers: [{ provide: APP_FILTER, useClass: HttpErrorLoggingFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
