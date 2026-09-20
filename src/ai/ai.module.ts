import { Module } from '@nestjs/common';
import { AI_PROVIDER } from './ai-provider';
import { createAiProvider } from './ai-provider.factory';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  controllers: [AiController],
  providers: [
    AiService,
    {
      provide: AI_PROVIDER,
      useFactory: () => createAiProvider(),
    },
  ],
})
export class AiModule {}
