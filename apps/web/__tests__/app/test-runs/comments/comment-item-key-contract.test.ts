/**
 * Contract, web half: each row the API can anchor an agent comment to renders its item key with
 * the shared builder the API's anchor resolver uses (design: test-run-analysis-stories.md, "The
 * builders are shared"). The API half, apps/api/src/modules/comments/comment-anchor.resolver.spec.ts,
 * pins the stored format; this one pins that the web rows still go through those builders, so a
 * private copy reappearing here fails rather than silently stranding agent comments.
 */
import {
  configCommentAnchor as sharedConfigAnchor,
  dashboardCommentItemKey,
  sloCommentItemKey,
  sloCommentItemLabel,
  transactionCommentItemKey,
  transactionCommentItemLabel,
  transactionScenarioGroup,
} from '@perfana/shared/constants/comment-cards';
import { transactionItemKey, parseTransactionItemKey } from '@/app/test-runs/[id]/components/performance-analysis/utils/scenario-filter';
import { NO_SCENARIO_LABEL } from '@/app/test-runs/[id]/components/performance-analysis/components/ScenarioFilter';
import { getCheckResultKey } from '@/app/test-runs/[id]/components/service-level-objectives/utils/slo-formatters';
import { configCommentAnchor } from '@/app/test-runs/[id]/components/configuration-comparison/hooks/useConfigComments';
import { dashboardCommentAnchor } from '@/app/test-runs/[id]/components/dashboards/components/DashboardCard';
import { unreadCommentsLabel } from '@/lib/test-run-comments';
import type { CheckResult } from '@/lib/types';

describe('comment item keys: the web rows use the shared builders', () => {
  it('transaction row', () => {
    expect(transactionItemKey('checkout', 'T01')).toBe(transactionCommentItemKey('checkout', 'T01'));
    expect(transactionItemKey('checkout', 'T01')).toBe('["checkout","T01"]');
    expect(parseTransactionItemKey('["checkout","T01"]')).toEqual({ scenario: 'checkout', transaction: 'T01' });
    expect(transactionCommentItemLabel('checkout', 'T01')).toBe('checkout · T01');
    // The card groups an empty scenario under the label the server resolves to.
    expect(NO_SCENARIO_LABEL).toBe(transactionScenarioGroup(''));
  });

  it('SLO row', () => {
    const r = {
      panel_type: 'graph', evaluate_type: 'avg', benchmark_id: 'b-1', panel_title: 'RT',
      application_dashboard_id: 'ad-1', panel_id: 4, metric_name: 'p95', dashboard_label: 'Perf',
    } as unknown as CheckResult;
    expect(getCheckResultKey(r)).toBe(sloCommentItemKey(r));
    expect(getCheckResultKey(r)).toBe('ad-1_4_p95_b-1');
    expect(sloCommentItemLabel(r)).toBe('Perf · RT · p95');
  });

  it('Configuration row', () => {
    expect(configCommentAnchor('heap.max')).toEqual(sharedConfigAnchor('heap.max'));
    expect(configCommentAnchor('heap.max')).toEqual({ itemKey: 'config:heap.max', itemLabel: 'heap.max' });
  });

  it('Dashboards tile', () => {
    const d = { id: 'ad-9', dashboard_label: 'JVM', dashboard_name: 'jvm' } as never;
    expect(dashboardCommentAnchor(d)).toEqual({ itemKey: dashboardCommentItemKey('ad-9'), itemLabel: 'JVM' });
  });
});

describe('unreadCommentsLabel', () => {
  it('names the AI share only when there is one', () => {
    expect(unreadCommentsLabel(5, 3)).toBe('5 unread (3 from AI)');
    expect(unreadCommentsLabel(5, 0)).toBe('5 unread');
  });
});
