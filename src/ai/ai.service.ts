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
    const actor = await this.requireActor(actorId);

    const departments = await this.prisma.department.findMany({
      where: { companyId: actor.companyId },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
    const requestTypes = await this.prisma.requestType.findMany({
      where: { companyId: actor.companyId },
      select: { id: true, name: true, departmentId: true },
      orderBy: { id: 'asc' },
    });
    const allowedDepartmentIds = new Set(departments.map((department) => department.id));

    let raw: unknown;
    try {
      raw = await this.provider.complete({
        employeeText: text,
        departments,
        requestTypes,
      });
    } catch (error) {
      if (error instanceof InvalidAiOutputError) {
        this.logger.error(`Requesty intake invalid output: ${error.message}`);
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
      return validateIntakeResult(raw, allowedDepartmentIds, text, requestTypes);
    } catch (error) {
      if (error instanceof InvalidAiOutputError) {
        this.logger.error(
          `Requesty intake invalid output: ${error.message}; ${summarizePayload(raw)}`,
        );
        throw new BadGatewayException('The intake assistant returned an invalid result.');
      }
      throw error;
    }
  }

  private async requireActor(actorId: number) {
    const actor = await this.prisma.employee.findUnique({
      where: { id: actorId },
      select: { id: true, companyId: true },
    });
    if (!actor) {
      throw new BadRequestException(`Employee ${actorId} was not found`);
    }
    return actor;
  }
}

function summarizePayload(raw: unknown): string {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return `payloadType=${raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw}`;
  }
  const record = raw as Record<string, unknown>;
  const situation =
    record.situation === 'problem' || record.situation === 'need' ? record.situation : 'other';
  return `payloadKeys=${Object.keys(record).sort().join(',') || 'none'} situation=${situation}`;
}
