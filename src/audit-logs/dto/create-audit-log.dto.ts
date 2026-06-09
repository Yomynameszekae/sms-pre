export interface CreateAuditLogDto {
  schoolId?: string;
  userId?: string;
  requestId?: string;
  actorType?: string;
  action: string;
  module?: string;
  entityType?: string;
  entityId?: string;
  changes?: Record<string, any>;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}
