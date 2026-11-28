import { parseTransactionCommentItemKey } from '@perfana/shared/constants/comment-cards';
import {
  commentItemLabel,
  commentItemTab,
  errorGroupItemKey,
  top10ItemKey,
} from '@/app/test-runs/[id]/components/performance-analysis/utils/comment-item-keys';
import { transactionItemKey } from '@/app/test-runs/[id]/components/performance-analysis/utils/scenario-filter';

describe('Performance Analysis tab comment anchors', () => {
  it('maps each anchor to the tab that renders it', () => {
    expect(commentItemTab(top10ItemKey('transactions', 'Slowest P95', 'checkout', 'T01'))).toBe(1);
    expect(commentItemTab(top10ItemKey('requests', 'Impact', 'checkout', 'T01', 'GET /a', '/a'))).toBe(2);
    expect(commentItemTab(top10ItemKey('urls', 'Impact', '/a'))).toBe(3);
    expect(commentItemTab(errorGroupItemKey('T01', 'GET /a'))).toBe(4);
    // An Overview transaction row stays on Overview.
    expect(commentItemTab(transactionItemKey('checkout', 'T01'))).toBeNull();
  });

  it('never reads as an Overview transaction key', () => {
    expect(parseTransactionCommentItemKey(top10ItemKey('urls', 'x', 'y'))).toBeNull();
    expect(parseTransactionCommentItemKey(errorGroupItemKey('a', 'b'))).toBeNull();
  });

  it('keeps a label within the API limit', () => {
    expect(commentItemLabel('Impact', undefined, 'x'.repeat(400))).toHaveLength(255);
    expect(commentItemLabel('Impact', '', '/a')).toBe('Impact · /a');
  });
});
