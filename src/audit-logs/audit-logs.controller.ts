import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { successResponse, paginatedResponse } from '../common/utils/response.util';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @RequirePermissions('audit_logs.read')
  async findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryAuditLogsDto) {
    const result = await this.auditLogsService.findAll(user.schoolId, query);
    return paginatedResponse(result.items, result.pagination.total, result.pagination.page, result.pagination.limit);
  }

  @Get(':id')
  @RequirePermissions('audit_logs.read')
  async findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const log = await this.auditLogsService.findOne(id, user.schoolId);
    return successResponse(log);
  }
}
