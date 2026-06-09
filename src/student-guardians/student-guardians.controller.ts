import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { StudentGuardiansService } from './student-guardians.service';
import { CreateStudentGuardianDto } from './dto/create-student-guardian.dto';
import { UpdateStudentGuardianDto } from './dto/update-student-guardian.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/utils/response.util';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('student-guardians')
export class StudentGuardiansController {
  constructor(private readonly studentGuardiansService: StudentGuardiansService) {}

  @Post()
  @RequirePermissions('student_guardians.manage')
  async link(
    @Body() dto: CreateStudentGuardianDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
  ) {
    const record = await this.studentGuardiansService.link(
      dto,
      user.sub,
      user.schoolId,
      req.requestId,
    );
    return successResponse(record, 'Student-guardian link created successfully');
  }

  @Patch(':id')
  @RequirePermissions('student_guardians.manage')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStudentGuardianDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
  ) {
    const record = await this.studentGuardiansService.update(
      id,
      dto,
      user.sub,
      user.schoolId,
      req.requestId,
    );
    return successResponse(record, 'Student-guardian link updated successfully');
  }

  @Delete(':id')
  @RequirePermissions('student_guardians.manage')
  async unlink(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
  ) {
    const result = await this.studentGuardiansService.unlink(
      id,
      user.sub,
      user.schoolId,
      req.requestId,
    );
    return successResponse(result, 'Student-guardian link removed successfully');
  }

  @Post(':id/set-primary')
  @RequirePermissions('student_guardians.manage')
  async setPrimary(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Req() req: any,
  ) {
    const record = await this.studentGuardiansService.setPrimary(
      id,
      user.sub,
      user.schoolId,
      req.requestId,
    );
    return successResponse(record, 'Primary guardian set successfully');
  }
}
