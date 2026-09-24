import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { RecordsActivity } from '../auth/auth.decorators';
import { AuthenticatedRequest } from '../auth/session.guard';
import { AiService } from './ai.service';
import { AnalyzeIntakeDto } from './dto/analyze-intake.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('intake')
  @HttpCode(200)
  @RecordsActivity()
  analyze(@Req() request: AuthenticatedRequest, @Body() dto: AnalyzeIntakeDto) {
    return this.aiService.analyze(request.auth!.id, dto.text);
  }
}
