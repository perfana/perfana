/**
 * The web keeps its own copy of the report section-type registry because
 * apps/web does not depend on @perfana/shared (that would pull TypeORM into the
 * browser bundle). This test is what keeps the copy honest: it imports the
 * canonical registry straight from the shared *source* — a test-only import, so
 * nothing reaches the bundle — and fails the moment either side gains a type the
 * other does not have.
 *
 * Adding `error_analysis` in v0.2.69.0 needed edits in six registries and the
 * ones that only drifted silently were the array copies. This is the guard for
 * the one copy that cannot be derived away.
 */
import {
  REPORT_SECTION_TYPES,
  SECTION_TYPES_WITH_TEXT,
  getSectionTypeLabel,
} from '@/lib/api/reports';
import {
  REPORT_SECTION_TYPES as SHARED_SECTION_TYPES,
  SECTION_TYPES_WITH_TEXT as SHARED_TYPES_WITH_TEXT,
  SECTION_TYPE_LABELS as SHARED_LABELS,
} from '../../../../packages/shared/src/types/reports.types';

describe('report section types stay in sync with @perfana/shared', () => {
  it('lists exactly the same section types', () => {
    expect([...REPORT_SECTION_TYPES].sort()).toEqual([...SHARED_SECTION_TYPES].sort());
  });

  it('agrees on which types support accompanying text', () => {
    expect([...SECTION_TYPES_WITH_TEXT].sort()).toEqual([...SHARED_TYPES_WITH_TEXT].sort());
  });

  it('labels every type the same way', () => {
    for (const type of REPORT_SECTION_TYPES) {
      expect(getSectionTypeLabel(type)).toBe(SHARED_LABELS[type]);
    }
  });

  it('labels every type — no silent fall-through to the raw identifier', () => {
    for (const type of REPORT_SECTION_TYPES) {
      expect(getSectionTypeLabel(type)).not.toBe(type);
    }
  });
});
