import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { parseActorId } from '../requests/parse-actor-id';
import { AiService } from './ai.service';
import { AnalyzeIntakeDto } from './dto/analyze-intake.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('intake')
  @HttpCode(200)
  analyze(
    @Headers('x-actor-id') actorHeader: string | undefined,
    @Body() dto: AnalyzeIntakeDto,
  ) {
    return this.aiService.analyze(parseActorId(actorHeader), dto.text);
  }
}
