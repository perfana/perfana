import { ClsServiceManager } from 'nestjs-cls';
import type { EntityManager, Repository } from 'typeorm';
import { getRequestEm, REQ_EM, withRequestEm } from './request-em';

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
