import { ClsServiceManager } from 'nestjs-cls';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { getRequestEm, REQ_EM, withRequestEm, withRequestQuery } from './request-em';

describe('withRequestEm', () => {
  beforeEach(() => {
    // Reset CLS between tests
    try {
      ClsServiceManager.getClsService().exit();
    } catch {
      /* not initialized — fine */
    }
  });

  describe('outside CLS (no request)', () => {
    it('getRequestEm returns null', () => {
      expect(getRequestEm()).toBeNull();
    });

    it('withRequestEm returns the input repo unchanged', () => {
      const fakeRepo = { target: class {}, find: jest.fn() } as unknown as Repository<object>;
      expect(withRequestEm(fakeRepo)).toBe(fakeRepo);
    });
  });

  describe('inside CLS with REQ_EM populated', () => {
    it('getRequestEm returns the stored EntityManager', async () => {
      const fakeEm = { getRepository: jest.fn() } as unknown as EntityManager;
      await ClsServiceManager.getClsService().run(async () => {
        ClsServiceManager.getClsService().set(REQ_EM, fakeEm);
        expect(getRequestEm()).toBe(fakeEm);
      });
    });

    it('withRequestEm uses the stored EntityManager to derive a fresh repo', async () => {
      const target = class {};
      const fakeRepo = { target, find: jest.fn() } as unknown as Repository<object>;
      const fakeEmRepo = { target, find: jest.fn() } as unknown as Repository<object>;
      const fakeEm = {
        getRepository: jest.fn().mockReturnValue(fakeEmRepo),
      } as unknown as EntityManager;

      await ClsServiceManager.getClsService().run(async () => {
        ClsServiceManager.getClsService().set(REQ_EM, fakeEm);
        const result = withRequestEm(fakeRepo);
        expect(result).toBe(fakeEmRepo);
        expect(fakeEm.getRepository).toHaveBeenCalledWith(target);
      });
    });
  });

  describe('inside CLS without REQ_EM (e.g., flag off)', () => {
    it('withRequestEm falls back to input repo', async () => {
      const fakeRepo = { target: class {}, find: jest.fn() } as unknown as Repository<object>;
      await ClsServiceManager.getClsService().run(async () => {
        // REQ_EM intentionally not set
        expect(withRequestEm(fakeRepo)).toBe(fakeRepo);
      });
    });
  });
});

describe('withRequestQuery', () => {
  beforeEach(() => {
    try {
      ClsServiceManager.getClsService().exit();
    } catch {
      /* not initialized — fine */
    }
  });

  const fakeManager = { query: jest.fn() } as unknown as EntityManager;
  const fakeDataSource = { manager: fakeManager } as unknown as DataSource;

  describe('outside CLS (no request)', () => {
    it("returns the DataSource's default manager", () => {
      expect(withRequestQuery(fakeDataSource)).toBe(fakeManager);
    });
  });

  describe('inside CLS with REQ_EM populated', () => {
    it('returns the stored request EntityManager (not the pooled manager)', async () => {
      const fakeEm = { query: jest.fn() } as unknown as EntityManager;
      await ClsServiceManager.getClsService().run(async () => {
        ClsServiceManager.getClsService().set(REQ_EM, fakeEm);
        expect(withRequestQuery(fakeDataSource)).toBe(fakeEm);
        expect(withRequestQuery(fakeDataSource)).not.toBe(fakeManager);
      });
    });
  });

  describe('inside CLS without REQ_EM (e.g., flag off)', () => {
    it("falls back to the DataSource's default manager", async () => {
      await ClsServiceManager.getClsService().run(async () => {
        // REQ_EM intentionally not set
        expect(withRequestQuery(fakeDataSource)).toBe(fakeManager);
      });
    });
  });
});
