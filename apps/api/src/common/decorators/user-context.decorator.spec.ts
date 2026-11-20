import { resolveDisplayName } from './user-context.decorator';
import type { AuthenticatedRequest } from '../../guards/keycloak-enhanced-auth.guard';

const jwt = (user: Record<string, unknown>) =>
  ({ authType: 'keycloak-jwt', user }) as unknown as AuthenticatedRequest;

describe('resolveDisplayName', () => {
  it('prefers the JWT name claim', () => {
    expect(resolveDisplayName(jwt({ name: 'Ada L', preferred_username: 'ada', email: 'ada@example.com' }))).toBe('Ada L');
  });

  it('builds the name from given_name and family_name when the realm sends no name claim', () => {
    expect(resolveDisplayName(jwt({ given_name: 'QA', family_name: 'Reviewer', preferred_username: 'qa' }))).toBe('QA Reviewer');
    expect(resolveDisplayName(jwt({ given_name: 'QA', preferred_username: 'qa' }))).toBe('QA');
  });

  it('falls back to preferred_username, then email, skipping blanks', () => {
    expect(resolveDisplayName(jwt({ name: '  ', preferred_username: 'ada', email: 'ada@example.com' }))).toBe('ada');
    expect(resolveDisplayName(jwt({ email: 'ada@example.com' }))).toBe('ada@example.com');
  });

  it('is undefined for API-key callers and tokens with nothing usable', () => {
    expect(resolveDisplayName({ authType: 'api-key', apiKey: { id: 'k' } } as unknown as AuthenticatedRequest)).toBeUndefined();
    expect(resolveDisplayName(jwt({}))).toBeUndefined();
  });
});
