/**
 * The trend section's "start here" sentinel.
 *
 * Stored in a section config in place of a run id, meaning "start at the run where ADAPT
 * last recorded a change point" — the point past which older runs describe a system that
 * has since changed. Mirrored by the config form; keep the two spellings in step.
 */
export const CHANGE_POINT_WINDOW = 'changepoint';
