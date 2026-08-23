import {
  formatStartedAt,
  summariseAnnotations,
} from '@/app/test-runs/[id]/components/compare/components/CompareSelectionPanel';

/**
 * The baseline summary went from a five-line panel to one caption line built by
 * `[...].filter(Boolean).join(' · ')`. Both helpers exist because that join has two ways to
 * produce garbage: `new Date('nonsense').toLocaleString()` returns the non-empty string
 * "Invalid Date", which survives filter(Boolean), and an unbounded annotation list wraps a
 * one-line caption into the row above it.
 */
describe('baseline caption helpers', () => {
  describe('formatStartedAt', () => {
    it('formats a real timestamp', () => {
      expect(formatStartedAt('2026-08-23T12:20:45Z')).toContain('2026');
    });

    it('drops an unparseable timestamp instead of rendering "Invalid Date"', () => {
      expect(formatStartedAt('not-a-date')).toBeNull();
    });

    it.each([null, undefined, ''])('drops %o', value => {
      expect(formatStartedAt(value)).toBeNull();
    });
  });

  describe('summariseAnnotations', () => {
    it('returns the only annotation as-is', () => {
      expect(summariseAnnotations(['Proxy Dev: matrix calc'])).toBe('Proxy Dev: matrix calc');
    });

    it('keeps the caption to one line when there are many', () => {
      expect(summariseAnnotations(['a', 'b', 'c'])).toBe('a (+2 more)');
    });

    it.each([[[]], [null], [undefined]])('drops %o', value => {
      expect(summariseAnnotations(value as string[] | null | undefined)).toBeNull();
    });
  });
});
