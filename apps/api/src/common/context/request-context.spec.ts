import { isRequestContextStore, REQ_CTX } from './request-context';

describe('RequestContextStore', () => {
  it('REQ_CTX is a unique symbol', () => {
    expect(typeof REQ_CTX).toBe('symbol');
    expect(REQ_CTX.toString()).toBe('Symbol(request-context)');
  });

  it('isRequestContextStore validates a complete store', () => {
    expect(isRequestContextStore({
      userId: 'kc-123',
      userEmail: 'a@b.c',
      ipAddress: '10.0.0.1',
      userAgent: 'Mozilla',
      requestId: 'req-1',
      authType: 'keycloak',
    })).toBe(true);
  });

  it('isRequestContextStore rejects missing required fields', () => {
    expect(isRequestContextStore({ userId: 'kc-123' })).toBe(false);
    expect(isRequestContextStore(null)).toBe(false);
    expect(isRequestContextStore(undefined)).toBe(false);
  });

  it('isRequestContextStore accepts nullable optional fields', () => {
    expect(isRequestContextStore({
      userId: 'kc-123',
      userEmail: null,
      ipAddress: null,
      userAgent: null,
      requestId: 'req-1',
      authType: null,
    })).toBe(true);
  });
});
