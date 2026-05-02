import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, AuditAction, OwnedResource } from '@perfana/shared/entities';
import { AuditService } from './audit.service';
import { REQ_CTX, RequestContextStore } from '../../common/context/request-context';
import { RequestContextModule } from '../../common/context/request-context.module';

class FakeEntity implements OwnedResource {
  static auditableFields = ['name', 'description', 'organization_id'] as const;
  id!: string;
  name!: string;
  description?: string;
  organization_id!: string;
  team_id?: string;
  created_by!: string;
  updated_by?: string;
}

const ctxStore: RequestContextStore = {
  userId: 'kc-1',
  userEmail: 'a@b.c',
  ipAddress: '10.0.0.1',
  userAgent: 'Mozilla',
  requestId: 'req-1',
  authType: 'keycloak',
};

describe('AuditService (Phase 5a)', () => {
  let service: AuditService;
  let repo: jest.Mocked<Repository<AuditLog>>;
  let cls: ClsService;

  beforeEach(async () => {
    repo = {
      insert: jest.fn().mockResolvedValue({ identifiers: [{ id: 'audit-1' }] }),
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    } as unknown as jest.Mocked<Repository<AuditLog>>;

    const moduleRef = await Test.createTestingModule({
      imports: [RequestContextModule],
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLog), useValue: repo },
      ],
    }).compile();

    service = moduleRef.get(AuditService);
    cls = moduleRef.get(ClsService);
  });

  describe('logUpdate', () => {
    it('writes a row with the diff over auditableFields', (done) => {
      const before: FakeEntity = Object.assign(new FakeEntity(), {
        id: 'r-1', name: 'old', description: 'd', organization_id: 'o-1', created_by: 'kc-1',
      });
      const after: FakeEntity = Object.assign(new FakeEntity(), { ...before, name: 'new' });

      cls.run(() => {
        cls.set(REQ_CTX, ctxStore);
        service.logUpdate(before, after);
        setImmediate(() => {
          expect(repo.insert).toHaveBeenCalledTimes(1);
          const row = repo.insert.mock.calls[0][0] as Partial<AuditLog>;
          expect(row.action).toBe(AuditAction.UPDATE);
          expect(row.userId).toBe('kc-1');
          expect(row.organizationId).toBe('o-1');
          expect(row.changes).toEqual({ before: { name: 'old' }, after: { name: 'new' }, fields: ['name'] });
          done();
        });
      });
    });

    it('skips insert when no auditableField changed', (done) => {
      const before = Object.assign(new FakeEntity(), {
        id: 'r-1', name: 'x', description: 'd', organization_id: 'o-1', created_by: 'kc-1',
      });
      const after = Object.assign(new FakeEntity(), { ...before });
      cls.run(() => {
        cls.set(REQ_CTX, ctxStore);
        service.logUpdate(before, after);
        setImmediate(() => { expect(repo.insert).not.toHaveBeenCalled(); done(); });
      });
    });

    it('warns once when entity has no auditableFields and writes changes:null', (done) => {
      class Naked implements OwnedResource {
        id!: string; organization_id!: string; created_by!: string;
      }
      const e = Object.assign(new Naked(), { id: 'r-1', organization_id: 'o-1', created_by: 'kc-1' });
      cls.run(() => {
        cls.set(REQ_CTX, ctxStore);
        service.logUpdate(e, e);
        setImmediate(() => {
          expect(repo.insert).toHaveBeenCalled();
          const row = repo.insert.mock.calls[0][0] as Partial<AuditLog>;
          expect(row.changes).toBeFalsy();
          done();
        });
      });
    });

    it('skips insert when CLS context is missing', (done) => {
      const e = Object.assign(new FakeEntity(), {
        id: 'r-1', name: 'x', organization_id: 'o-1', created_by: 'kc-1',
      });
      cls.run(() => {
        // intentionally NOT setting REQ_CTX
        service.logUpdate(e, { ...e, name: 'y' } as FakeEntity);
        setImmediate(() => { expect(repo.insert).not.toHaveBeenCalled(); done(); });
      });
    });

    it('never throws when repo.insert rejects', (done) => {
      repo.insert.mockRejectedValueOnce(new Error('db down'));
      const before = Object.assign(new FakeEntity(), {
        id: 'r-1', name: 'a', organization_id: 'o-1', created_by: 'kc-1',
      });
      cls.run(() => {
        cls.set(REQ_CTX, ctxStore);
        expect(() => service.logUpdate(before, { ...before, name: 'b' } as FakeEntity)).not.toThrow();
        setImmediate(() => done());
      });
    });
  });

  describe('logCreate', () => {
    it('writes after-only diff', (done) => {
      const e = Object.assign(new FakeEntity(), {
        id: 'r-1', name: 'x', organization_id: 'o-1', created_by: 'kc-1',
      });
      cls.run(() => {
        cls.set(REQ_CTX, ctxStore);
        service.logCreate(e);
        setImmediate(() => {
          const row = repo.insert.mock.calls[0][0] as Partial<AuditLog>;
          expect(row.action).toBe(AuditAction.CREATE);
          expect(row.changes).toEqual({ before: {}, after: { name: 'x', organization_id: 'o-1' }, fields: ['name', 'organization_id'] });
          done();
        });
      });
    });
  });

  describe('logDelete', () => {
    it('writes before-only diff', (done) => {
      const e = Object.assign(new FakeEntity(), {
        id: 'r-1', name: 'x', organization_id: 'o-1', created_by: 'kc-1',
      });
      cls.run(() => {
        cls.set(REQ_CTX, ctxStore);
        service.logDelete(e);
        setImmediate(() => {
          const row = repo.insert.mock.calls[0][0] as Partial<AuditLog>;
          expect(row.action).toBe(AuditAction.DELETE);
          expect(row.changes).toEqual({ before: { name: 'x', organization_id: 'o-1' }, after: {}, fields: ['name', 'organization_id'] });
          done();
        });
      });
    });
  });

  describe('actorOverride', () => {
    it('overrides CLS values with the explicit override', (done) => {
      const e = Object.assign(new FakeEntity(), {
        id: 'r-1', name: 'x', organization_id: 'o-1', created_by: 'system',
      });
      cls.run(() => {
        cls.set(REQ_CTX, ctxStore);
        service.logCreate(e, { actorOverride: { userId: 'system:grafana-sync', userEmail: null, ipAddress: null } });
        setImmediate(() => {
          const row = repo.insert.mock.calls[0][0] as Partial<AuditLog>;
          expect(row.userId).toBe('system:grafana-sync');
          expect(row.userEmail).toBeFalsy();
          expect(row.ipAddress).toBeFalsy();
          done();
        });
      });
    });
  });
});
