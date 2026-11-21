import { Injectable, Logger } from '@nestjs/common';
import { TestRun, ReportSectionConfig, getSectionText } from '@perfana/shared';
import {
  COMMENT_CARD_KEYS,
  COMMENT_CARD_LABELS,
  describeConfigCommentView,
  commentsSectionLayout,
  COMMENT_TAG_LABELS,
  type CommentCardKey,
  type ConfigCommentView,
} from '@perfana/shared/constants/comment-cards';
import {
  ReportDataFetcherService,
  ReportCommentRow,
  ReportStory,
  ReportStoryStep,
  MetricsTimeSeriesPanel,
  selectorsFromPresetSeries,
} from '../services/report-data-fetcher.service';
import { ChartSvgService } from './chart-svg.service';
import { GraphsRenderer } from './graphs-renderer';
import {
  REPORT_COLORS,
  chip,
  emptyState,
  escapeHtml,
  formatInt,
  groupHeader,
  sectionHeader,
  sectionText,
} from './report-style';

/** A marker chart's size: the Custom Graphs section's `standard` quality. */
const CHART_WIDTH = 1000;
const CHART_HEIGHT = 320;
const MARKER_CHART_INDEX_OFFSET = 1000;
/**
 * The `stories` layout's charts, offset again so a report holding a by-card and a stories
 * Comments section never derives one clipPath id for the same marker in both.
 */
const STORY_CHART_INDEX_OFFSET = 500;

/** One root and its replies, oldest first. */
interface Thread {
  root: ReportCommentRow;
  replies: ReportCommentRow[];
}

/** ① .. ⑳ for the numbers the run page draws as pins; past twenty, "#21". */
export function markerGlyph(seq: number): string {
  return seq >= 1 && seq <= 20 ? String.fromCodePoint(0x2460 + seq - 1) : `#${seq}`;
}

/** Unambiguous whatever the reader's zone: a stored report is read anywhere, long after. */
function formatTimestamp(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** The card keys a section config asks for; anything unknown is dropped, and none means all. */
export function selectedCards(config: Record<string, unknown> | undefined): CommentCardKey[] | null {
  const raw = config?.cards;
  if (!Array.isArray(raw)) return null;
  const known = new Set<string>(COMMENT_CARD_KEYS);
  const cards = raw.filter((c): c is CommentCardKey => typeof c === 'string' && known.has(c));
  return cards.length > 0 ? cards : null;
}

/**
 * Renderer for the Comments section (design: docs/designs/test-run-comments.md, R8).
 *
 * Lists the run's comment threads grouped by card, roots in created order with their replies
 * under them. A Graphs marker thread is headed by its recorded view, drawn by the same SVG
 * chart and the same preset fetch path as the Custom Graphs section, with a numbered callout
 * at the marker. Trends and Compare views are not drawn: their charts are run-over-run and
 * per-metric respectively, and no report builder takes their recorded shape yet.
 *
 * Every piece of comment text is author content and reaches a page served unauthenticated by
 * share links, so all of it goes through `escapeHtml`; the body is never parsed as markdown.
 */
@Injectable()
export class CommentsRenderer {
  private readonly logger = new Logger(CommentsRenderer.name);

  constructor(
    private readonly dataFetcher: ReportDataFetcherService,
    private readonly chartSvg: ChartSvgService,
    private readonly graphsRenderer: GraphsRenderer,
  ) {}

  async renderCommentsSection(
    section: ReportSectionConfig,
    testRun: TestRun | null,
    userId: string = '',
    roles: string[] = [],
  ): Promise<string> {
    // A stories-layout section reads as "Investigations", the name the app uses (PR7).
    const title = section.title || (commentsSectionLayout(section.config) === 'stories' ? 'Investigations' : 'Comments');
    const text = getSectionText(section);
    const cards = selectedCards(section.config);

    if (!testRun) return this.wrap(title, text, emptyState('No test run data available for comments.'));
    if (commentsSectionLayout(section.config) === 'stories') {
      return this.renderStories(title, text, testRun, userId, roles);
    }

    const rows = await this.dataFetcher.getTestRunComments(testRun, cards, userId, roles);
    const threads = this.buildThreads(rows);
    if (threads.length === 0) {
      return this.wrap(title, text, emptyState(cards
        ? 'No comments on the selected cards of this test run.'
        : 'No comments on this test run.'));
    }

    const byCard = new Map<string, Thread[]>();
    for (const t of threads) {
      const list = byCard.get(t.root.cardKey) ?? [];
      list.push(t);
      byCard.set(t.root.cardKey, list);
    }
    // Page order of the cards, then any key this build does not know (kept, not dropped).
    const order = [...COMMENT_CARD_KEYS, ...[...byCard.keys()].filter((k) => !(COMMENT_CARD_KEYS as readonly string[]).includes(k))];

    let chartIdx = 0;
    const groups: string[] = [];
    for (const card of order) {
      const list = byCard.get(card);
      if (!list) continue;
      const rendered: string[] = [];
      for (const thread of list) {
        rendered.push(await this.renderThread(thread, testRun, chartIdx, userId, roles));
        if (this.isGraphsMarker(thread.root)) chartIdx++;
      }
      const label = (COMMENT_CARD_LABELS as Record<string, string>)[card] ?? card;
      groups.push(`
        <div class="comments-card" style="margin: 24px 0;">
          ${groupHeader(label, [chip(`${formatInt(list.length)} thread${list.length !== 1 ? 's' : ''}`, 'neutral')])}
          ${rendered.join('\n')}
        </div>
      `);
    }

    const count = threads.length;
    return `
      <section class="comments-section">
        ${sectionHeader(title, { kicker: `${formatInt(count)} thread${count !== 1 ? 's' : ''}` })}
        ${sectionText(text)}
        ${groups.join('\n')}
      </section>
    `;
  }

  /** Roots in created order, each with its replies; a reply whose root is not here is dropped. */
  private buildThreads(rows: ReportCommentRow[]): Thread[] {
    const threads: Thread[] = [];
    const byId = new Map<string, Thread>();
    for (const r of rows) {
      if (r.parentId) continue;
      const t = { root: r, replies: [] };
      threads.push(t);
      byId.set(r.id, t);
    }
    for (const r of rows) {
      if (r.parentId) byId.get(r.parentId)?.replies.push(r);
    }
    return threads;
  }

  private isGraphsMarker(root: ReportCommentRow): boolean {
    // `kind` is stamped by the comments service; a view recorded before it was stamped has
    // none, and on the Graphs card it can only be a Graphs view.
    const kind = root.chartContext?.kind;
    return root.markerSeq !== null && root.cardKey === 'graphs' && root.deletedAt === null
      && (kind === undefined || kind === 'graphs') && Array.isArray(root.chartContext?.series);
  }

  private async renderThread(
    thread: Thread,
    testRun: TestRun,
    chartIdx: number,
    userId: string,
    roles: string[],
  ): Promise<string> {
    const chart = this.isGraphsMarker(thread.root)
      ? await this.renderMarkerChart(thread.root, testRun, chartIdx, userId, roles)
      : '';
    const replies = thread.replies.length
      ? `<div style="margin-left:24px; padding-left:14px; border-left:2px solid ${REPORT_COLORS.cardBorder};">
          ${thread.replies.map((r) => this.renderComment(r)).join('')}
        </div>`
      : '';
    return `
      <div class="comment-thread" style="margin:0 0 18px; padding:14px 16px; background:${REPORT_COLORS.cardBg}; border:1px solid ${REPORT_COLORS.cardBorder}; border-radius:6px; break-inside:avoid-page;">
        ${chart}
        ${this.renderComment(thread.root)}
        ${this.renderConfigView(thread.root)}
        ${replies}
      </div>
    `;
  }

  private renderComment(c: ReportCommentRow): string {
    const meta: string[] = [];
    // A root's tag leads (kept on a deleted root); a key this build does not know prints as stored.
    if (c.tag && !c.parentId) meta.push(chip((COMMENT_TAG_LABELS as Record<string, string>)[c.tag] ?? c.tag, 'neutral'));
    if (c.markerSeq !== null) {
      meta.push(`<span style="font-weight:700; color:${REPORT_COLORS.ink};">Marker ${escapeHtml(markerGlyph(c.markerSeq))}</span>`);
    }
    meta.push(`<strong style="color:${REPORT_COLORS.ink};">${escapeHtml(c.authorName || 'Unknown')}</strong>`);
    // A reader must never mistake an agent's claim for a colleague's (design: "Marking agent content").
    if (c.authorKind === 'agent') meta.push(chip('AI', 'info'));
    meta.push(`<span>${escapeHtml(formatTimestamp(c.createdAt))}</span>`);
    if (c.editedAt && c.deletedAt === null) meta.push('<span>(edited)</span>');
    if (c.itemLabel) meta.push(`<span style="color:${REPORT_COLORS.secondaryInk};">on ${escapeHtml(c.itemLabel)}</span>`);

    // A deleted root keeps its place in the thread; its body was wiped by the delete and is
    // never printed even if a row still carries one.
    const body = c.deletedAt !== null
      ? `<div style="font-style:italic; color:${REPORT_COLORS.mutedInk};">Comment deleted</div>`
      : `<div class="comment-body" style="white-space:pre-wrap; overflow-wrap:anywhere; color:${REPORT_COLORS.ink};">${escapeHtml(c.body)}</div>`;

    return `
      <div class="comment" style="padding:6px 0;">
        <div style="display:flex; flex-wrap:wrap; gap:4px 10px; font-size:9.5pt; color:${REPORT_COLORS.mutedInk}; margin-bottom:4px;">${meta.join('')}</div>
        ${body}
      </div>
    `;
  }

  /**
   * The Graphs view a marker was placed on: its recorded series over its recorded x range,
   * re-read for this run, with the numbered callout at `marker_time`. Series that no longer
   * resolve (a deleted dashboard, a renamed series) are left out and counted in a note.
   */
  private async renderMarkerChart(
    root: ReportCommentRow,
    testRun: TestRun,
    chartIdx: number,
    userId: string,
    roles: string[],
  ): Promise<string> {
    const ctx = root.chartContext!;
    const stored = (ctx.series as unknown[]).filter(
      (s): s is { dashboardLabel?: string; panelTitle?: string; metricName?: string; panelId?: number } =>
        !!s && typeof s === 'object',
    );
    const selectors = selectorsFromPresetSeries(stored);
    const title = typeof ctx.title === 'string' && ctx.title.trim() ? ctx.title : `Graphs view, marker ${markerGlyph(root.markerSeq!)}`;

    let series: MetricsTimeSeriesPanel[] = [];
    try {
      series = selectors.length
        ? await this.graphsRenderer.fetchPresetSeries(selectors, testRun.testRunId, false, userId, roles)
        : [];
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Unknown error';
      this.logger.warn(`Comments section: marker ${root.id} series fetch failed: ${msg}`);
      series = [];
    }

    // The author's zoom: only the points inside the recorded window are drawn.
    const range = Array.isArray(ctx.xRange) ? (ctx.xRange as unknown[]).map((t) => Date.parse(String(t))) : [];
    const [from, to] = range.length === 2 && range.every(Number.isFinite) ? range as [number, number] : [null, null];
    const drawn = series
      .map((s) => (from === null || to === null
        ? s
        : { ...s, dataPoints: s.dataPoints.filter((dp) => dp.time.getTime() >= from && dp.time.getTime() <= to) }))
      .filter((s) => s.dataPoints.some((dp) => dp.value !== null));

    if (drawn.length === 0) {
      return this.note('The chart this marker was placed on cannot be drawn: its series no longer resolve for this run.');
    }
    const missing = Math.max(0, selectors.length - drawn.length);
    const chart = this.chartSvg.renderTimeSeriesChart(
      title,
      drawn,
      // Offset past any Custom Graphs index: ChartSvgService derives the clipPath id from this
      // index and the title, and a marker view often carries its preset's title.
      MARKER_CHART_INDEX_OFFSET + chartIdx,
      CHART_WIDTH,
      CHART_HEIGHT,
      this.graphsRenderer.analysisWindow(testRun),
      true,
      { callouts: root.markerTime ? [{ time: root.markerTime.getTime(), label: String(root.markerSeq) }] : [] },
    );
    return chart + (missing > 0
      ? this.note(`${formatInt(missing)} of ${formatInt(selectors.length)} series recorded with this marker no longer resolve and are not drawn.`)
      : '');
  }

  /**
   * The comparison a Configuration item comment was written against, so it stays readable once
   * the card compares with another run. Escaped like everything else: the values are config
   * values from the run, which anyone uploading configs controls.
   */
  private renderConfigView(root: ReportCommentRow): string {
    const ctx = root.chartContext;
    if (root.deletedAt !== null || root.cardKey !== 'config' || ctx?.kind !== 'config' || typeof ctx.status !== 'string') return '';
    const line = describeConfigCommentView(ctx as unknown as ConfigCommentView);
    return `<div class="comment-config-view" style="font-size:9.5pt; color:${REPORT_COLORS.secondaryInk}; overflow-wrap:anywhere; white-space:pre-wrap; margin:0 0 4px;">${escapeHtml(line)}</div>`;
  }

  // ==================== `stories` layout (analysis stories, PR5) ====================

  /**
   * Every PUBLISHED story of the run, ordered by `published_at`: title, author, conclusion, then
   * each step with its number, tag, card · item, the comment, the step note, and the same Graphs
   * marker chart / config snapshot the by-card layout draws. Comments in no story are omitted, and
   * the section's card filter does not apply (a story's steps are its author's choice).
   */
  private async renderStories(
    title: string,
    text: string | undefined,
    testRun: TestRun,
    userId: string,
    roles: string[],
  ): Promise<string> {
    const stories = await this.dataFetcher.getPublishedStories(testRun, userId, roles);
    if (stories.length === 0) {
      return this.wrap(title, text, emptyState('No published investigations for this run.'));
    }

    let chartIdx = 0;
    const rendered: string[] = [];
    for (const story of stories) {
      const steps: string[] = [];
      for (const step of story.steps) {
        steps.push(await this.renderStoryStep(step, testRun, chartIdx, userId, roles));
        if (step.comment && this.isGraphsMarker(step.comment)) chartIdx++;
      }
      rendered.push(this.renderStory(story, steps));
    }

    const count = stories.length;
    return `
      <section class="comments-section comments-stories">
        ${sectionHeader(title, { kicker: `${formatInt(count)} investigation${count !== 1 ? 's' : ''}` })}
        ${sectionText(text)}
        ${rendered.join('\n')}
      </section>
    `;
  }

  private renderStory(story: ReportStory, steps: string[]): string {
    const n = story.steps.length;
    const meta = [`by <strong style="color:${REPORT_COLORS.ink};">${escapeHtml(story.authorName || 'Unknown')}</strong>`];
    if (story.publishedAt) meta.push(`published ${escapeHtml(formatTimestamp(story.publishedAt))}`);
    const summary = story.summary && story.summary.trim()
      ? `<div class="story-summary" style="white-space:pre-wrap; overflow-wrap:anywhere; color:${REPORT_COLORS.ink}; margin:0 0 14px; padding:10px 14px; border-left:3px solid ${REPORT_COLORS.cardBorder};">${escapeHtml(story.summary)}</div>`
      : '';
    return `
      <div class="comment-story" style="margin: 24px 0;">
        ${groupHeader(story.title, [chip(`${formatInt(n)} step${n !== 1 ? 's' : ''}`, 'neutral')])}
        <div style="font-size:9.5pt; color:${REPORT_COLORS.mutedInk}; margin:-6px 0 10px;">${meta.join(' · ')}</div>
        ${summary}
        ${steps.join('\n')}
      </div>
    `;
  }

  private async renderStoryStep(
    step: ReportStoryStep,
    testRun: TestRun,
    chartIdx: number,
    userId: string,
    roles: string[],
  ): Promise<string> {
    const c = step.comment;
    const head: string[] = [`<span style="font-weight:700; color:${REPORT_COLORS.ink};">Step ${formatInt(step.position)}</span>`];
    if (c?.tag) head.push(chip((COMMENT_TAG_LABELS as Record<string, string>)[c.tag] ?? c.tag, 'neutral'));
    if (c) {
      const card = (COMMENT_CARD_LABELS as Record<string, string>)[c.cardKey] ?? c.cardKey;
      head.push(`<span style="color:${REPORT_COLORS.secondaryInk};">${escapeHtml(c.itemLabel ? `${card} · ${c.itemLabel}` : card)}</span>`);
      if (c.markerSeq !== null) {
        head.push(`<span style="font-weight:700; color:${REPORT_COLORS.ink};">Marker ${escapeHtml(markerGlyph(c.markerSeq))}</span>`);
      }
    }

    let body: string;
    if (!c || c.deletedAt !== null) {
      // The step keeps its place (and its tag and note); a deleted root's body is never printed.
      body = `<div style="font-style:italic; color:${REPORT_COLORS.mutedInk};">${c ? 'Comment deleted' : 'Comment not available'}</div>`;
    } else {
      const meta = [`<strong style="color:${REPORT_COLORS.ink};">${escapeHtml(c.authorName || 'Unknown')}</strong>`, `<span>${escapeHtml(formatTimestamp(c.createdAt))}</span>`];
      if (c.editedAt) meta.push('<span>(edited)</span>');
      const chart = this.isGraphsMarker(c)
        ? await this.renderMarkerChart(c, testRun, STORY_CHART_INDEX_OFFSET + chartIdx, userId, roles)
        : '';
      body = `
        ${chart}
        <div style="display:flex; flex-wrap:wrap; gap:4px 10px; font-size:9.5pt; color:${REPORT_COLORS.mutedInk}; margin-bottom:4px;">${meta.join('')}</div>
        <div class="comment-body" style="white-space:pre-wrap; overflow-wrap:anywhere; color:${REPORT_COLORS.ink};">${escapeHtml(c.body)}</div>
        ${this.renderConfigView(c)}
      `;
    }
    const note = step.note && step.note.trim()
      ? `<div class="story-step-note" style="white-space:pre-wrap; overflow-wrap:anywhere; font-style:italic; color:${REPORT_COLORS.secondaryInk}; margin-top:6px;">${escapeHtml(step.note)}</div>`
      : '';
    return `
      <div class="story-step" style="margin:0 0 18px; padding:14px 16px; background:${REPORT_COLORS.cardBg}; border:1px solid ${REPORT_COLORS.cardBorder}; border-radius:6px; break-inside:avoid-page;">
        <div style="display:flex; flex-wrap:wrap; align-items:center; gap:4px 10px; font-size:9.5pt; margin-bottom:6px;">${head.join('')}</div>
        ${body}
        ${note}
      </div>
    `;
  }

  private note(message: string): string {
    return `<div style="font-size:9.5pt; font-style:italic; color:${REPORT_COLORS.mutedInk}; margin:0 0 8px;">${escapeHtml(message)}</div>`;
  }

  private wrap(title: string, text: string | undefined, body: string): string {
    return `
      <section class="comments-section">
        ${sectionHeader(title)}
        ${sectionText(text)}
        ${body}
      </section>
    `;
  }
}
