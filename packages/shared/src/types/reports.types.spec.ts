import {
  getSectionText,
  sectionSupportsText,
  SECTION_TYPES_WITH_TEXT,
  REPORT_SECTION_TYPES,
  REPORT_DEFAULTS,
} from './reports.types';

describe('getSectionText', () => {
  it('prefers text over the deprecated comment', () => {
    expect(getSectionText({ text: 'new', comment: 'old' })).toBe('new');
  });

  it('falls back to comment when text is absent', () => {
    expect(getSectionText({ comment: 'old' })).toBe('old');
  });

  it('returns undefined when neither is set', () => {
    expect(getSectionText({})).toBeUndefined();
  });

  it('honours an empty text rather than resurrecting a stale comment', () => {
    // Clearing the field in the UI writes '' — a `||` fallback would wrongly
    // bring back the pre-migration comment here.
    expect(getSectionText({ text: '', comment: 'old' })).toBe('');
  });
});

describe('sectionSupportsText', () => {
  it('accepts every section type except text_block', () => {
    expect(sectionSupportsText('header')).toBe(true);
    expect(sectionSupportsText('slo')).toBe(true);
    expect(sectionSupportsText('top_10_lists')).toBe(true);
    expect(sectionSupportsText('error_analysis')).toBe(true);
    expect(sectionSupportsText('text_block')).toBe(false);
  });

  it('covers every section type but text_block', () => {
    // Asserted against REPORT_SECTION_TYPES rather than a hard-coded count, so
    // adding a section type does not silently need this number edited too.
    expect(SECTION_TYPES_WITH_TEXT).toHaveLength(REPORT_SECTION_TYPES.length - 1);
    expect(SECTION_TYPES_WITH_TEXT).not.toContain('text_block');
  });
});

describe('REPORT_DEFAULTS', () => {
  it('caps section text at 5000 characters', () => {
    expect(REPORT_DEFAULTS.MAX_SECTION_TEXT_LENGTH).toBe(5000);
  });
});
