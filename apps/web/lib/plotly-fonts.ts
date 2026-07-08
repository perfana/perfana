/**
 * Font stack for Plotly `hoverlabel.font.family`.
 *
 * Deliberately a pure system-font stack with NO web font (the app's theme font is
 * "Inter", a web font). Plotly sizes the hover-label background box by measuring the
 * rendered text; if the web font loads async mid-hover, the box is measured against the
 * fallback glyphs and then the text reflows to Inter — box and text visibly separate.
 * This showed up as misaligned hover tooltips on Windows Chrome (where Inter is never a
 * system font). A system stack is available synchronously, so the box always matches.
 *
 * Only use this for `hoverlabel.font` — axis/title fonts render once after load and
 * should keep the theme font.
 */
export const PLOTLY_HOVER_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
