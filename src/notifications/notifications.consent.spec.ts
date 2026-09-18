import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { GuardiansService } from '../guardians/guardians.service';
import { StudentGuardiansService } from '../student-guardians/student-guardians.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

/**
 * Consent is a RECORD — who obtained it, when, and on what basis — and
 * withdrawal has to bite immediately, not eventually.
 */
const mockPrisma: any = {
  guardian: { findFirst: jest.fn(), update: jest.fn() },
  studentGuardian: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  notificationMessage: { updateMany: jest.fn() },
  student: { findFirst: jest.fn() },
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

const GUARDIAN = {
  id: 'g1', schoolId: 's1', firstName: 'Akua', lastName: 'Mensah',
  smsConsentGiven: false, smsConsentMethod: null, smsConsentGivenAt: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.guardian.update.mockResolvedValue({ id: 'g1' });
  mockPrisma.studentGuardian.updateMany.mockResolvedValue({ count: 2 });
  mockPrisma.notificationMessage.updateMany.mockResolvedValue({ count: 3 });
});

describe('granting consent', () => {
  it('records the method, the moment and the member of staff', async () => {
    const svc = await make(GuardiansService);
    mockPrisma.guardian.findFirst.mockResolvedValue(GUARDIAN);

    await svc.grantSmsConsent('g1', 'written_form', 'staff-1', 's1');

    const data = mockPrisma.guardian.update.mock.calls[0][0].data;
    expect(data.smsConsentGiven).toBe(true);
    expect(data.smsConsentMethod).toBe('written_form');
    expect(data.smsConsentGivenBy).toBe('staff-1');
    expect(data.smsConsentGivenAt).toBeInstanceOf(Date);
  });

  it('writes guardian.sms_consent_granted naming who vouched for it', async () => {
    const svc = await make(GuardiansService);
    mockPrisma.guardian.findFirst.mockResolvedValue(GUARDIAN);

    await svc.grantSmsConsent('g1', 'verbal_at_enrollment', 'staff-1', 's1', 'req-1');

    const entry = mockAuditLogs.create.mock.calls[0][0];
    expect(entry.action).toBe('guardian.sms_consent_granted');
    expect(entry.entityType).toBe('guardian');
    expect(entry.entityId).toBe('g1');
    expect(entry.metadata.method).toBe('verbal_at_enrollment');
    expect(entry.metadata.recordedBy).toBe('staff-1');
  });
});

describe('withdrawing consent', () => {
  beforeEach(() => {
    mockPrisma.guardian.findFirst.mockResolvedValue({
      ...GUARDIAN, smsConsentGiven: true, smsConsentMethod: 'written_form',
    });
  });

  it('clears the flag AND the detail columns', async () => {
    const svc = await make(GuardiansService);
    await svc.revokeSmsConsent('g1', 'Parent asked to stop', 'staff-1', 's1');

    expect(mockPrisma.guardian.update.mock.calls[0][0].data).toMatchObject({
      smsConsentGiven: false,
      smsConsentGivenAt: null,
      smsConsentGivenBy: null,
      smsConsentMethod: null,
    });
  });

  it('turns off every per-child link — a link cannot outlive its consent', async () => {
    const svc = await make(GuardiansService);
    await svc.revokeSmsConsent('g1', 'Parent asked to stop', 'staff-1', 's1');

    expect(mockPrisma.studentGuardian.updateMany.mock.calls[0][0]).toMatchObject({
      where: { guardianId: 'g1', canReceiveSms: true },
      data: { canReceiveSms: false },
    });
  });

  it('CANCELS messages already queued — "it was already in the queue" is no defence', async () => {
    const svc = await make(GuardiansService);
    const result = await svc.revokeSmsConsent('g1', 'Parent asked to stop', 'staff-1', 's1');

    expect(mockPrisma.notificationMessage.updateMany.mock.calls[0][0]).toMatchObject({
      where: { guardianId: 'g1', status: { in: ['queued', 'sending'] } },
      data: { status: 'cancelled' },
    });
    expect(result.queuedMessagesCancelled).toBe(3);
  });

  it('does all of it in ONE transaction', async () => {
    const svc = await make(GuardiansService);
    await svc.revokeSmsConsent('g1', 'Parent asked to stop', 'staff-1', 's1');
    // A half-applied withdrawal that cleared the flag but left the queue is
    // precisely the failure withdrawal exists to prevent.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('audits the withdrawal with the reason and what it stopped', async () => {
    const svc = await make(GuardiansService);
    await svc.revokeSmsConsent('g1', 'Parent asked to stop', 'staff-1', 's1');

    const entry = mockAuditLogs.create.mock.calls[0][0];
    expect(entry.action).toBe('guardian.sms_consent_revoked');
    expect(entry.metadata.reason).toBe('Parent asked to stop');
    expect(entry.metadata.queuedMessagesCancelled).toBe(3);
  });

  it('refuses to withdraw consent that was never given', async () => {
    const svc = await make(GuardiansService);
    mockPrisma.guardian.findFirst.mockResolvedValue(GUARDIAN);

    await expect(
      svc.revokeSmsConsent('g1', 'Parent asked to stop', 'staff-1', 's1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('canReceiveSms cannot be set without consent', () => {
  it('refuses to create a messageable link for an unconsented guardian', async () => {
    const svc = await make(StudentGuardiansService);
    mockPrisma.student.findFirst.mockResolvedValue({ id: 'stu1', schoolId: 's1' });
    mockPrisma.guardian.findFirst.mockResolvedValue(GUARDIAN);

    await expect(
      svc.link(
        { studentId: 'stu1', guardianId: 'g1', canReceiveSms: true } as any,
        'u1', 's1',
      ),
    ).rejects.toThrow(/has not given SMS consent/);
  });

  it('a new link defaults to NOT messageable', async () => {
    const svc = await make(StudentGuardiansService);
    mockPrisma.student.findFirst.mockResolvedValue({ id: 'stu1', schoolId: 's1' });
    mockPrisma.guardian.findFirst.mockResolvedValue(GUARDIAN);
    mockPrisma.studentGuardian.create = jest.fn().mockResolvedValue({ id: 'l1' });

    await svc.link({ studentId: 'stu1', guardianId: 'g1' } as any, 'u1', 's1');

    // A link cannot be born messageable: consent has not been recorded at the
    // moment a link is created.
    expect(mockPrisma.studentGuardian.create.mock.calls[0][0].data.canReceiveSms).toBe(false);
  });

  it('allows it once consent is on record', async () => {
    const svc = await make(StudentGuardiansService);
    mockPrisma.student.findFirst.mockResolvedValue({ id: 'stu1', schoolId: 's1' });
    mockPrisma.guardian.findFirst.mockResolvedValue({ ...GUARDIAN, smsConsentGiven: true });
    mockPrisma.studentGuardian.create = jest.fn().mockResolvedValue({ id: 'l1' });

    await expect(
      svc.link(
        { studentId: 'stu1', guardianId: 'g1', canReceiveSms: true } as any,
        'u1', 's1',
      ),
    ).resolves.toBeDefined();
  });
});
