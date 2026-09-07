import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { AssignOwnerDto } from './dto/assign-owner.dto';
import { CreateRequestDto } from './dto/create-request.dto';
import { TransitionRequestDto } from './dto/transition-request.dto';
import { RequestsService } from './requests.service';

@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  create(@Body() dto: CreateRequestDto) {
    return this.requestsService.create(dto);
  }

  @Get(':id/history')
  getHistory(@Param('id', ParseIntPipe) id: number) {
    return this.requestsService.getHistory(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.requestsService.findOne(id);
  }

  @Patch(':id/owner')
  assignOwner(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignOwnerDto,
  ) {
    return this.requestsService.assignOwner(id, dto);
  }

  @Patch(':id/transition')
  transition(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransitionRequestDto,
  ) {
    return this.requestsService.transition(id, dto);
  }
}
