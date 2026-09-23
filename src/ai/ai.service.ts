import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AI_PROVIDER, AiProvider } from './ai-provider';
import { IntakeResult, validateIntakeResult } from './intake.schema';
import { InvalidAiOutputError } from './invalid-ai-output.error';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}

  async analyze(actorId: number, text: string): Promise<IntakeResult> {
    await this.requireActor(actorId);

    const departments = await this.prisma.department.findMany({
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
    const allowedDepartmentIds = new Set(departments.map((department) => department.id));

    let raw: unknown;
    try {
      raw = await this.provider.complete({
        employeeText: text,
        departments,
      });
    } catch (error) {
      if (error instanceof InvalidAiOutputError) {
        throw new BadGatewayException('The intake assistant returned an invalid result.');
      }
      const detail = error instanceof Error ? error.message : 'Requesty request failed';
      this.logger.error(
        `Requesty intake upstream failure: ${detail}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'The intake assistant is unavailable. Try again later.',
      );
    }

    try {
      return validateIntakeResult(raw, allowedDepartmentIds, text);
    } catch (error) {
      if (error instanceof InvalidAiOutputError) {
        throw new BadGatewayException('The intake assistant returned an invalid result.');
      }
      throw error;
    }
  }

  private async requireActor(actorId: number) {
    const actor = await this.prisma.employee.findUnique({ where: { id: actorId } });
    if (!actor) {
      throw new BadRequestException(`Employee ${actorId} was not found`);
    }
    return actor;
  }
}
