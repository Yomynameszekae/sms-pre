import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { validate } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AppConfigModule } from './config/config.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { SchoolModule } from './school/school.module';
import { SchoolSettingsModule } from './school-settings/school-settings.module';
import { DocumentSequencesModule } from './document-sequences/document-sequences.module';
import { AcademicYearsModule } from './academic-years/academic-years.module';
import { TermsModule } from './terms/terms.module';
import { LevelsModule } from './levels/levels.module';
import { ClassroomsModule } from './classrooms/classrooms.module';
import { StaffModule } from './staff/staff.module';
import { StudentsModule } from './students/students.module';
import { GuardiansModule } from './guardians/guardians.module';
import { StudentGuardiansModule } from './student-guardians/student-guardians.module';
import { AdmissionsModule } from './admissions/admissions.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { FilesModule } from './files/files.module';
import { LabelsModule } from './labels/labels.module';
import { AttendanceModule } from './attendance/attendance.module';
import { FeesModule } from './fees/fees.module';
import { InvoicesModule } from './invoices/invoices.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    AppConfigModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    RolesModule,
    SchoolModule,
    SchoolSettingsModule,
    DocumentSequencesModule,
    AcademicYearsModule,
    TermsModule,
    LevelsModule,
    ClassroomsModule,
    StaffModule,
    StudentsModule,
    GuardiansModule,
    StudentGuardiansModule,
    AdmissionsModule,
    EnrollmentsModule,
    FilesModule,
    LabelsModule,
    AttendanceModule,
    FeesModule,
    InvoicesModule,
    NotificationsModule,
    AuditLogsModule,
  ],
})
export class AppModule {}
