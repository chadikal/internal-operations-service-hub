import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import { RecordsActivity } from '../auth/auth.decorators';
import { AuthenticatedRequest } from '../auth/session.guard';
import { AssignOwnerDto } from './dto/assign-owner.dto';
import { CreateRequestDto } from './dto/create-request.dto';
import { TransitionRequestDto } from './dto/transition-request.dto';
import { RequestsService } from './requests.service';

@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  @RecordsActivity()
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateRequestDto) {
    return this.requestsService.create(request.auth!.id, dto);
  }

  @Get(':id/history')
  @RecordsActivity()
  getHistory(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.requestsService.getHistory(request.auth!.id, id);
  }

  @Get(':id')
  @RecordsActivity()
  findOne(@Req() request: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.requestsService.findOne(request.auth!.id, id);
  }

  @Patch(':id/owner')
  @RecordsActivity()
  assignOwner(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignOwnerDto,
  ) {
    return this.requestsService.assignOwner(request.auth!.id, id, dto);
  }

  @Patch(':id/transition')
  @RecordsActivity()
  transition(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransitionRequestDto,
  ) {
    return this.requestsService.transition(request.auth!.id, id, dto);
  }
}
