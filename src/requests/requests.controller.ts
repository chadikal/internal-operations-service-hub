import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { AssignOwnerDto } from './dto/assign-owner.dto';
import { CreateRequestDto } from './dto/create-request.dto';
import { TransitionRequestDto } from './dto/transition-request.dto';
import { parseActorId } from './parse-actor-id';
import { RequestsService } from './requests.service';

@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  create(
    @Headers('x-actor-id') actorHeader: string | undefined,
    @Body() dto: CreateRequestDto,
  ) {
    return this.requestsService.create(parseActorId(actorHeader), dto);
  }

  @Get(':id/history')
  getHistory(
    @Headers('x-actor-id') actorHeader: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.requestsService.getHistory(parseActorId(actorHeader), id);
  }

  @Get(':id')
  findOne(
    @Headers('x-actor-id') actorHeader: string | undefined,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.requestsService.findOne(parseActorId(actorHeader), id);
  }

  @Patch(':id/owner')
  assignOwner(
    @Headers('x-actor-id') actorHeader: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignOwnerDto,
  ) {
    return this.requestsService.assignOwner(parseActorId(actorHeader), id, dto);
  }

  @Patch(':id/transition')
  transition(
    @Headers('x-actor-id') actorHeader: string | undefined,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransitionRequestDto,
  ) {
    return this.requestsService.transition(parseActorId(actorHeader), id, dto);
  }
}
