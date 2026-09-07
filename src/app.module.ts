import { Module } from '@nestjs/common';
import { RequestsModule } from './requests/requests.module';

@Module({
  imports: [RequestsModule],
})
export class AppModule {}
