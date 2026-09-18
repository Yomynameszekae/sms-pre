import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { LevelsService } from '../levels/levels.service';
import { ClassroomsService } from '../classrooms/classrooms.service';
import { StaffService } from '../staff/staff.service';
import { StudentsService } from '../students/students.service';
import { GuardiansService } from '../guardians/guardians.service';
import { StudentGuardiansService } from '../student-guardians/student-guardians.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

/**
 * Archive restoration across all five modules: fixed restore states,
 * not-archived guards, the classroom-under-archived-level guard, and the
 * set-primary swap that displaces an archived guardian's link.
 */
const mockPrisma: any = {
  level: { findFirst: jest.fn(), update: jest.fn() },
  classroom: { findFirst: jest.fn(), update: jest.fn() },
  staff: { findFirst: jest.fn(), update: jest.fn() },
  student: { findFirst: jest.fn(), update: jest.fn() },
  guardian: { findFirst: jest.fn(), update: jest.fn() },
  studentGuardian: { findFirst: jest.fn(), update: jest.fn() },
  $transaction: jest.fn((arg: any) =>
    typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)),
};
const mockAuditLogs = { create: jest.fn() };

async function make<T>(cls: new (...a: any[]) => T): Promise<T> {
  const module = await Test.createTestingModule({
    providers: [
      cls,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: AuditLogsService, useValue: mockAuditLogs },
    ],
  }).compile();
  return module.get(cls);
}

beforeEach(() => jest.clearAllMocks());

describe('restore — fixed target states', () => {
  it('level: isActive back to true', async () => {
    const svc = await make(LevelsService);
    mockPrisma.level.findFirst.mockResolvedValue({ id: 'l1', schoolId: 's', isActive: false });
    mockPrisma.level.update.mockResolvedValue({ id: 'l1', isActive: true });
    await svc.restore('l1', 'u', 's');
    expect(mockPrisma.level.update.mock.calls[0][0].data).toMatchObject({ isActive: true });
  });

  it('staff: status active, archivedAt cleared', async () => {
    const svc = await make(StaffService);
    mockPrisma.staff.findFirst.mockResolvedValue({ id: 'st1', schoolId: 's', status: 'terminated', archivedAt: new Date() });
    mockPrisma.staff.update.mockResolvedValue({ id: 'st1' });
    await svc.restore('st1', 'u', 's');
    expect(mockPrisma.staff.update.mock.calls[0][0].data).toMatchObject({ status: 'active', archivedAt: null });
  });

  it('student: status active, archivedAt cleared', async () => {
    const svc = await make(StudentsService);
    mockPrisma.student.findFirst.mockResolvedValue({ id: 'stu1', schoolId: 's', status: 'withdrawn', archivedAt: new Date() });
    mockPrisma.student.update.mockResolvedValue({ id: 'stu1' });
    await svc.restore('stu1', 'u', 's');
    expect(mockPrisma.student.update.mock.calls[0][0].data).toMatchObject({ status: 'active', archivedAt: null });
  });

  it('guardian: archivedAt cleared, links untouched', async () => {
    const svc = await make(GuardiansService);
    mockPrisma.guardian.findFirst.mockResolvedValue({ id: 'g1', schoolId: 's', archivedAt: new Date() });
    mockPrisma.guardian.update.mockResolvedValue({ id: 'g1' });
    await svc.restore('g1', 'u', 's');
    expect(mockPrisma.guardian.update.mock.calls[0][0].data).toMatchObject({ archivedAt: null });
    expect(mockPrisma.studentGuardian.update).not.toHaveBeenCalled();
  });
});

describe('restore — guards', () => {
  it('rejects a record that is not archived', async () => {
    const svc = await make(LevelsService);
    mockPrisma.level.findFirst.mockResolvedValue({ id: 'l1', schoolId: 's', isActive: true });
    await expect(svc.restore('l1', 'u', 's')).rejects.toThrow('Level is not archived');
  });

  it('classroom under an archived level → 409 naming the level', async () => {
    const svc = await make(ClassroomsService);
    mockPrisma.classroom.findFirst.mockResolvedValue({ id: 'c1', schoolId: 's', isActive: false, levelId: 'l1' });
    mockPrisma.level.findFirst.mockResolvedValue({ id: 'l1', isActive: false, name: 'Basic 3' });
    await expect(svc.restore('c1', 'u', 's')).rejects.toThrow("Restore the level 'Basic 3' first.");
  });

  it('classroom under an active level restores regardless of year state', async () => {
    const svc = await make(ClassroomsService);
    mockPrisma.classroom.findFirst.mockResolvedValue({ id: 'c1', schoolId: 's', isActive: false, levelId: 'l1' });
    mockPrisma.level.findFirst.mockResolvedValue({ id: 'l1', isActive: true, name: 'Basic 3' });
    mockPrisma.classroom.update.mockResolvedValue({ id: 'c1', isActive: true });
    await expect(svc.restore('c1', 'u', 's')).resolves.toBeDefined();
  });
});

describe('teacher assignment — staff must be active', () => {
  it('refuses assigning a terminated staff member, naming them', async () => {
    const svc = await make(ClassroomsService);
    mockPrisma.classroom.findFirst.mockResolvedValue({ id: 'c1', schoolId: 's' });
    mockPrisma.staff.findFirst.mockResolvedValue({
      id: 'st1', schoolId: 's', status: 'terminated', firstName: 'Daniel', lastName: 'Quaye',
    });
    await expect(svc.assignTeacher('c1', 'st1', 'u', 's')).rejects.toThrow(
      'Cannot assign Daniel Quaye: staff member is terminated',
    );
    expect(mockPrisma.classroom.update).not.toHaveBeenCalled();
  });

  it('assigns an active staff member normally', async () => {
    const svc = await make(ClassroomsService);
    mockPrisma.classroom.findFirst.mockResolvedValue({ id: 'c1', schoolId: 's' });
    mockPrisma.staff.findFirst.mockResolvedValue({ id: 'st1', schoolId: 's', status: 'active' });
    mockPrisma.classroom.update.mockResolvedValue({ id: 'c1', classTeacherId: 'st1' });
    await expect(svc.assignTeacher('c1', 'st1', 'u', 's')).resolves.toBeDefined();
  });
});

describe('set-primary — archived-guardian displacement', () => {
  it('silently demotes an ARCHIVED guardian holding the slot, in one transaction', async () => {
    const svc = await make(StudentGuardiansService);
    mockPrisma.studentGuardian.findFirst
      .mockResolvedValueOnce({ id: 'link2', schoolId: 's', studentId: 'stu1' }) // findStudentGuardian
      .mockResolvedValueOnce({
        id: 'link1', isPrimary: true,
        guardian: { archivedAt: new Date(), firstName: 'Kwame', lastName: 'Owusu' },
      }); // current primary inside tx
    mockPrisma.studentGuardian.update.mockResolvedValue({ id: 'link2', isPrimary: true });

    await svc.setPrimary('link2', 'u', 's');

    const calls = mockPrisma.studentGuardian.update.mock.calls;
    expect(calls[0][0]).toMatchObject({ where: { id: 'link1' }, data: { isPrimary: false } });
    expect(calls[1][0]).toMatchObject({ where: { id: 'link2' }, data: { isPrimary: true } });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('still refuses to displace an ACTIVE guardian (explicit 409, as before)', async () => {
    const svc = await make(StudentGuardiansService);
    mockPrisma.studentGuardian.findFirst
      .mockResolvedValueOnce({ id: 'link2', schoolId: 's', studentId: 'stu1' })
      .mockResolvedValueOnce({
        id: 'link1', isPrimary: true,
        guardian: { archivedAt: null, firstName: 'Ama', lastName: 'Mensah' },
      });
    await expect(svc.setPrimary('link2', 'u', 's')).rejects.toThrow(ConflictException);
    expect(mockPrisma.studentGuardian.update).not.toHaveBeenCalled();
  });

  it('promotes normally when no primary exists', async () => {
    const svc = await make(StudentGuardiansService);
    mockPrisma.studentGuardian.findFirst
      .mockResolvedValueOnce({ id: 'link2', schoolId: 's', studentId: 'stu1' })
      .mockResolvedValueOnce(null);
    mockPrisma.studentGuardian.update.mockResolvedValue({ id: 'link2', isPrimary: true });
    await expect(svc.setPrimary('link2', 'u', 's')).resolves.toBeDefined();
    expect(mockPrisma.studentGuardian.update).toHaveBeenCalledTimes(1);
  });
});
