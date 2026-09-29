import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { currentRequestId } from '../logging/request-context';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async ready(): Promise<{ status: 'ready' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      this.logger.error(`Database readiness check failed requestId=${currentRequestId()}`);
      throw new HttpException({ status: 'not_ready' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
