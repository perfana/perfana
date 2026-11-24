import { BadRequestException } from '@nestjs/common';
import { normalizeConfluenceParentPages } from './systems-under-test.service';

const CFG = '22222222-2222-2222-2222-222222222222';

describe('normalizeConfluenceParentPages', () => {
  it('stores each path as "A / B", lowercases the connection id and drops an empty path', () => {
    expect(normalizeConfluenceParentPages({ [CFG.toUpperCase()]: ' Perf /MyApp/ ', '33333333-3333-3333-3333-333333333333': ' / ' }))
      .toEqual({ [CFG]: 'Perf / MyApp' });
  });

  it.each([
    [{ 'not-a-uuid': 'A' }],
    [{ [CFG]: 42 }],
    [{ [CFG]: Array.from({ length: 11 }, (_, i) => `L${i}`).join('/') }],
    [{ [CFG]: 'x'.repeat(256) }],
  ])('refuses %j', (raw) => {
    expect(() => normalizeConfluenceParentPages(raw as Record<string, unknown>)).toThrow(BadRequestException);
  });
});
