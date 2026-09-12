import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class LookupsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('employees')
  findEmployees() {
    return this.prisma.employee.findMany({
      select: { id: true, name: true, departmentId: true, canHandle: true },
      orderBy: { id: 'asc' },
    });
  }

  @Get('departments')
  findDepartments() {
    return this.prisma.department.findMany({
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
  }
}
