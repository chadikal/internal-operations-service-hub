import { Module } from '@nestjs/common';
import { LookupsModule } from './lookups/lookups.module';
import { PrismaModule } from './prisma/prisma.module';
import { RequestsModule } from './requests/requests.module';

@Module({
  imports: [PrismaModule, RequestsModule, LookupsModule],
})
export class AppModule {}
