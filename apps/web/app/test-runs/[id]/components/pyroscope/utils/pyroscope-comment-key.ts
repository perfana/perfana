/** Comment anchors on the Pyroscope card: an application + profiler pair and the view (single / diff). */
import { parsePyroscopeItemKey, type PyroscopeCommentCombo } from '@perfana/shared/constants/comment-cards';

// The key builders live in shared so the API can build the same keys for an agent.
export {
  PYROSCOPE_VIEWS,
  parsePyroscopeItemKey,
  pyroscopeItemKey,
  pyroscopeItemLabel,
} from '@perfana/shared/constants/comment-cards';

export const isComboKey = (c: PyroscopeCommentCombo) => (key: string) => {
  const p = parsePyroscopeItemKey(key);
  return !!p && p.application === c.application && p.profiler === c.profiler;
};
