// Mock for jose library to handle ESM module issues in tests

export const createRemoteJWKSet = jest.fn(() => {
  return jest.fn();
});

export const jwtVerify = jest.fn().mockResolvedValue({
  payload: {
    sub: 'test-user-id',
    preferred_username: 'testuser',
    email: 'test@example.com',
    realm_access: {
      roles: ['user']
    },
    resource_access: {
      'perfana-api': {
        roles: []
      }
    }
  },
  protectedHeader: {}
});

export const errors = {
  JWSSignatureVerificationFailed: class JWSSignatureVerificationFailed extends Error {},
  JWTExpired: class JWTExpired extends Error {},
  JOSEError: class JOSEError extends Error {}
};

export type JWTPayload = any;
export type JWTVerifyGetKey = any;