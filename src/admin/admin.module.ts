import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RequestsModule } from '../requests/requests.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { DepartmentAdminController } from './department-admin.controller';

@Module({
  imports: [AuthModule, RequestsModule],
  controllers: [AdminController, DepartmentAdminController],
  providers: [AdminService],
})
export class AdminModule {}
