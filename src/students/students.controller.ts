import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { QueryStudentsDto } from './dto/query-students.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse, paginatedResponse } from '../common/utils/response.util';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  @Post()
  @RequirePermissions('students.create')
  async create(
    @Body() dto: CreateStudentDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
  ) {
    const student = await this.studentsService.create(
      dto,
      user.sub,
      user.schoolId,
      req.requestId,
    );
    return successResponse(student, 'Student created successfully');
  }

  @Get()
  @RequirePermissions('students.read')
  async findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryStudentsDto,
  ) {
    const result = await this.studentsService.findAll(user.schoolId, query);
    return paginatedResponse(
      result.items,
      result.pagination.total,
      result.pagination.page,
      result.pagination.limit,
      'Students retrieved successfully',
    );
  }

  @Get(':id')
  @RequirePermissions('students.read')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const student = await this.studentsService.findOne(id, user.schoolId);
    return successResponse(student, 'Student retrieved successfully');
  }

  @Patch(':id')
  @RequirePermissions('students.update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
  ) {
    const student = await this.studentsService.update(
      id,
      dto,
      user.sub,
      user.schoolId,
      req.requestId,
    );
    return successResponse(student, 'Student updated successfully');
  }

  @Post(':id/archive')
  @RequirePermissions('students.archive')
  async archive(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
  ) {
    const student = await this.studentsService.archive(
      id,
      user.sub,
      user.schoolId,
      req.requestId,
    );
    return successResponse(student, 'Student archived successfully');
  }

  @Get(':id/guardians')
  @RequirePermissions('students.read')
  async getGuardians(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const guardians = await this.studentsService.getGuardians(id, user.schoolId);
    return successResponse(guardians, 'Student guardians retrieved successfully');
  }

  @Get(':id/enrollments')
  @RequirePermissions('students.read')
  async getEnrollments(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const enrollments = await this.studentsService.getEnrollments(id, user.schoolId);
    return successResponse(enrollments, 'Student enrollments retrieved successfully');
  }
}
