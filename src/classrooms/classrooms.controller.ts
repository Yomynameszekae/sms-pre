import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ClassroomsService } from './classrooms.service';
import { CreateClassroomDto } from './dto/create-classroom.dto';
import { UpdateClassroomDto } from './dto/update-classroom.dto';
import { AssignTeacherDto } from './dto/assign-teacher.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/utils/response.util';

@Controller('classrooms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClassroomsController {
  constructor(private readonly classroomsService: ClassroomsService) {}

  @Post()
  @RequirePermissions('classrooms.create')
  async create(
    @Body() dto: CreateClassroomDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.classroomsService.create(
      dto,
      user.sub,
      user.schoolId,
      requestId,
    );
    return successResponse(data, 'Classroom created successfully');
  }

  @Get()
  @RequirePermissions('classrooms.read')
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query('levelId') levelId?: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    const data = await this.classroomsService.findAll(
      user.schoolId,
      levelId,
      academicYearId,
    );
    return successResponse(data, 'Classrooms retrieved successfully');
  }

  @Get(':id')
  @RequirePermissions('classrooms.read')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const data = await this.classroomsService.findOne(id, user.schoolId);
    return successResponse(data, 'Classroom retrieved successfully');
  }

  @Patch(':id')
  @RequirePermissions('classrooms.update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateClassroomDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.classroomsService.update(
      id,
      dto,
      user.sub,
      user.schoolId,
      requestId,
    );
    return successResponse(data, 'Classroom updated successfully');
  }

  @Post(':id/assign-class-teacher')
  @RequirePermissions('classrooms.assign_teacher')
  async assignTeacher(
    @Param('id') id: string,
    @Body() dto: AssignTeacherDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.classroomsService.assignTeacher(
      id,
      dto.staffId,
      user.sub,
      user.schoolId,
      requestId,
    );
    return successResponse(data, 'Class teacher assigned successfully');
  }

  @Post(':id/archive')
  @RequirePermissions('classrooms.archive')
  async archive(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    const data = await this.classroomsService.archive(
      id,
      user.sub,
      user.schoolId,
      requestId,
    );
    return successResponse(data, 'Classroom archived successfully');
  }
}
