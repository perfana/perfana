import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { DeleteSystemUnderTestHandler } from './delete-system-under-test.handler';
import { AuditService } from '../../audit/audit.service';
import { ResourceNotFoundException } from '../../../common/exceptions/business.exception';

describe('DeleteSystemUnderTestHandler', () => {
  let handler: DeleteSystemUnderTestHandler;
  let auditService: jest.Mocked<AuditService>;
  let dataSource: { query: jest.Mock; transaction: jest.Mock };

  beforeEach(async () => {
    dataSource = {
      query: jest.fn(),
      transaction: jest.fn().mockImplementation(async (fn) => {
        const mockManager = { query: jest.fn().mockResolvedValue([[], 0]) };
        await fn(mockManager);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeleteSystemUnderTestHandler,
        { provide: DataSource, useValue: dataSource },
        {
          provide: AuditService,
          useValue: {
            logCreate: jest.fn(),
            logUpdate: jest.fn(),
            logDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    handler = module.get(DeleteSystemUnderTestHandler);
    auditService = module.get(AuditService);
  });

  describe('execute', () => {
    it('throws ResourceNotFoundException when SUT does not exist', async () => {
      dataSource.query.mockResolvedValue([]);

      await expect(handler.execute('missing-sut')).rejects.toThrow(ResourceNotFoundException);
      expect(auditService.logDelete).not.toHaveBeenCalled();
    });

    it('logs DELETE before the cascade transaction begins', async () => {
      dataSource.query.mockResolvedValue([
        { id: 'sut-1', name: 'payment-service', organization_id: 'org-1', team_id: null },
      ]);

      await handler.execute('sut-1');

      expect(auditService.logDelete).toHaveBeenCalledTimes(1);
      const [ref] = (auditService.logDelete as jest.Mock).mock.calls[0];
      expect(ref).toMatchObject({
        id: 'sut-1',
        name: 'payment-service',
        organization_id: 'org-1',
      });

      // log-before-mutation ordering: audit dispatched before the transaction starts
      expect(
        (auditService.logDelete as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan((dataSource.transaction as jest.Mock).mock.invocationCallOrder[0]);
    });
  });
});
