import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { AdmissionsService } from './admissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

/**
 * Full transition matrix — every endpoint × every from-state, legal and
 * illegal, plus the revert-enrollment guard branches.
 */
const mockPrisma = {
  admissionApplication: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  enrollment: { findFirst: jest.fn() },
  user: { findUnique: jest.fn() },
  documentSequence: { update: jest.fn() },
  $transaction: jest.fn((arg) =>
    typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)),
};
const mockAuditLogs = { create: jest.fn() };

const STATES = ['enquiry', 'application', 'offered', 'rejected', 'enrolled', 'withdrawn'] as const;

function admissionIn(status: string, extra: Record<string, unknown> = {}) {
  mockPrisma.admissionApplication.findFirst.mockResolvedValue({
    id: 'adm1', schoolId: 'school-a', status,
    studentId: 'stu1', offeredAt: new Date(), approvedBy: 'user-0',
    enrolledAt: new Date(), ...extra,
  });
  mockPrisma.admissionApplication.update.mockImplementation(async ({ data }) => ({
    id: 'adm1', schoolId: 'school-a', studentId: 'stu1', ...data,
  }));
}

describe('Admission state machine — transition matrix', () => {
  let service: AdmissionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdmissionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogsService, useValue: mockAuditLogs },
      ],
    }).compile();
    service = module.get(AdmissionsService);
    jest.clearAllMocks();
    // the acting user is staff-linked by default
    mockPrisma.user.findUnique.mockResolvedValue({ linkedEntityType: 'staff', linkedEntityId: 'staff-1' });
  });

  const call = {
    apply: () => service.apply('adm1', 'user-1', 'school-a'),
    offer: () => service.offer('adm1', {}, 'user-1', 'school-a'),
    revertOffer: () => service.revertOffer('adm1', 'user-1', 'school-a'),
    reject: () => service.reject('adm1', {}, 'user-1', 'school-a'),
    withdraw: () => service.withdraw('adm1', {}, 'user-1', 'school-a'),
    revertEnrollment: () => service.revertEnrollment('adm1', 'user-1', 'school-a'),
  };

  const LEGAL: Record<keyof typeof call, readonly string[]> = {
    apply: ['enquiry'],
    offer: ['enquiry', 'application'],
    revertOffer: ['offered'],
    reject: ['enquiry', 'application', 'offered'],
    withdraw: ['enquiry', 'application', 'offered'],
    revertEnrollment: ['enrolled'],
  };

  for (const [endpoint, legalStates] of Object.entries(LEGAL) as Array<[keyof typeof call, readonly string[]]>) {
    for (const state of STATES) {
      const legal = legalStates.includes(state);
      it(`${endpoint} from '${state}' → ${legal ? 'succeeds' : 'ConflictException'}`, async () => {
        admissionIn(state);
        // revert-enrollment's enrollment guard must not block the legal cell
        mockPrisma.enrollment.findFirst.mockResolvedValue(null);
        if (legal) {
          await expect(call[endpoint]()).resolves.toBeDefined();
          expect(mockAuditLogs.create).toHaveBeenCalledTimes(1);
        } else {
          await expect(call[endpoint]()).rejects.toThrow(ConflictException);
          expect(mockAuditLogs.create).not.toHaveBeenCalled();
        }
      });
    }
  }

  describe('field cleanup and retention', () => {
    it('offer records approvedBy and approvedAt', async () => {
      admissionIn('application');
      await call.offer();
      const { data } = mockPrisma.admissionApplication.update.mock.calls[0][0];
      expect(data.approvedBy).toBe('staff-1'); // resolved staff id, not the user id
      expect(data.approvedAt).toBeInstanceOf(Date);
    });

    it('revert-offer clears exactly what offer set, and does not touch studentId', async () => {
      admissionIn('offered');
      await call.revertOffer();
      const { data } = mockPrisma.admissionApplication.update.mock.calls[0][0];
      expect(data).toMatchObject({
        status: 'application', offeredAt: null, approvedBy: null, approvedAt: null,
      });
      expect('studentId' in data).toBe(false);
    });

    it('revert-enrollment clears enrolledAt and retains studentId', async () => {
      admissionIn('enrolled');
      mockPrisma.enrollment.findFirst.mockResolvedValue(null);
      await call.revertEnrollment();
      const { data } = mockPrisma.admissionApplication.update.mock.calls[0][0];
      expect(data).toMatchObject({ status: 'offered', enrolledAt: null });
      expect('studentId' in data).toBe(false);
    });
  });

  describe('revert-enrollment guard', () => {
    it('blocks with "Withdraw the enrollment first." while an active enrollment exists', async () => {
      admissionIn('enrolled');
      mockPrisma.enrollment.findFirst.mockResolvedValue({ id: 'enr1', status: 'active' });
      await expect(call.revertEnrollment()).rejects.toThrow('Withdraw the enrollment first.');
    });

    for (const outcome of ['completed', 'graduated', 'transferred']) {
      it(`refuses outright when the enrollment is '${outcome}' — a real outcome`, async () => {
        admissionIn('enrolled');
        mockPrisma.enrollment.findFirst.mockResolvedValue({ id: 'enr1', status: outcome });
        await expect(call.revertEnrollment()).rejects.toThrow(
          new RegExp(`enrollment is ${outcome}.*records a real outcome`),
        );
      });
    }

    it('succeeds once every enrollment for the student is withdrawn', async () => {
      admissionIn('enrolled');
      mockPrisma.enrollment.findFirst.mockResolvedValue(null); // none non-withdrawn
      await expect(call.revertEnrollment()).resolves.toMatchObject({ status: 'offered' });
      const where = mockPrisma.enrollment.findFirst.mock.calls[0][0].where;
      expect(where).toMatchObject({ studentId: 'stu1', status: { not: 'withdrawn' } });
    });

    it('skips the enrollment check when the admission has no linked student', async () => {
      admissionIn('enrolled', { studentId: null });
      await expect(call.revertEnrollment()).resolves.toBeDefined();
      expect(mockPrisma.enrollment.findFirst).not.toHaveBeenCalled();
    });
  });
});
