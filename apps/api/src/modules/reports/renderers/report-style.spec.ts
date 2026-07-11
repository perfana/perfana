import {
  statusFor,
  statusPill,
  deltaArrow,
  deltaChip,
  deltaText,
  formatInt,
  formatNum,
  formatDiff,
  formatPercent,
  formatMetricValue,
  sectionHeader,
  groupHeader,
  splitHostLabel,
  commentBlock,
  emptyState,
  statCard,
  markerChip,
  chip,
  TH_TEXT,
  TH_NUM,
} from './report-style';

describe('report-style', () => {
  describe('statusFor (rule 01)', () => {
    it('maps deltas onto the five-state scale with default thresholds', () => {
      expect(statusFor(null)).toBe('na');
      expect(statusFor(5)).toBe('ok');
      expect(statusFor(-8)).toBe('ok');
      expect(statusFor(25)).toBe('warning');
      expect(statusFor(80)).toBe('regression');
      expect(statusFor(-30)).toBe('improvement');
    });

    it('treats threshold boundaries as inclusive (≤ good = OK, ≤ warning = WARNING)', () => {
      expect(statusFor(10)).toBe('ok');
      expect(statusFor(50)).toBe('warning');
      expect(statusFor(50.01)).toBe('regression');
      expect(statusFor(20, { good: 20, warning: 60 })).toBe('ok');
      expect(statusFor(60, { good: 20, warning: 60 })).toBe('warning');
    });

    it('respects direction for lower-is-worse metrics (throughput)', () => {
      expect(statusFor(-80, undefined, false)).toBe('regression');
      expect(statusFor(30, undefined, false)).toBe('improvement');
    });

    it('coerces numeric strings and rejects garbage', () => {
      expect(statusFor('80')).toBe('regression');
      expect(statusFor(NaN)).toBe('na');
      expect(statusFor(Infinity)).toBe('na');
      expect(statusFor('garbage')).toBe('na');
    });
  });

  describe('pills and chips (rule 06)', () => {
    it('renders uppercase status pills with letter-spacing', () => {
      const html = statusPill('regression');
      expect(html).toContain('REGRESSION');
      expect(html).toContain('letter-spacing');
      expect(html).toContain('#fbe6e4');
    });

    it('escapes chip labels', () => {
      expect(chip('<b>x</b>', 'info')).toContain('&lt;b&gt;');
    });

    it('renders compact marker chips for table rows', () => {
      const html = markerChip('Current', 'info');
      expect(html).toContain('Current');
      expect(html).toContain('padding:2px 8px');
    });
  });

  describe('delta arrows (rule 02)', () => {
    it('binds the glyph to the value direction', () => {
      expect(deltaArrow(12)).toBe('▲');
      expect(deltaArrow(-3)).toBe('▼');
      expect(deltaArrow(0)).toBe('–');
      expect(deltaArrow(null)).toBe('');
      expect(deltaArrow(NaN)).toBe('');
    });

    it('deltaText renders arrow + signed pct, em-dash for zero/missing', () => {
      expect(deltaText(12.34)).toBe('▲ +12.3%');
      expect(deltaText(-3)).toBe('▼ -3.0%');
      expect(deltaText(0)).toBe('—');
      expect(deltaText(null)).toBe('—');
    });

    it('colors the chip by meaning, not raw direction', () => {
      expect(deltaChip(80)).toContain('▲');
      expect(deltaChip(80)).toContain('#fbe6e4'); // regression fill
      expect(deltaChip(-30)).toContain('▼');
      expect(deltaChip(-30)).toContain('#eaf1fb'); // improvement fill
      expect(deltaChip(-80, undefined, false)).toContain('#fbe6e4'); // lower-is-worse regression
    });

    it('renders a single neutral em-dash for zero and missing values', () => {
      const zero = deltaChip(0);
      expect(zero).toContain('—');
      expect(zero).not.toContain('–'); // no double dash
      expect(zero).not.toContain('▲');
      expect(zero).toContain('#f1f1f3'); // neutral fill, not green
      expect(deltaChip(null)).toContain('—');
      expect(deltaChip(NaN)).toContain('—');
    });
  });

  describe('number formatting (rule 03)', () => {
    it('groups thousands', () => {
      expect(formatInt(4937045)).toBe('4,937,045');
      expect(formatNum(4937045.129)).toBe('4,937,045.13');
    });

    it('caps decimals at two but keeps precision for small non-zero values', () => {
      expect(formatNum(-0.2661)).toBe('-0.27');
      expect(formatNum(0.0042)).toBe('0.0042');
      expect(formatNum(0)).toBe('0');
    });

    it('coerces pg NUMERIC strings and rejects garbage', () => {
      expect(formatNum('4937045.129')).toBe('4,937,045.13');
      expect(formatInt('42')).toBe('42');
      expect(formatPercent('3.75')).toBe('3.8%');
      expect(formatNum('not-a-number')).toBe('—');
      expect(formatInt(NaN)).toBe('—');
      expect(formatPercent(Infinity)).toBe('—');
    });

    it('renders a true zero diff as em-dash', () => {
      expect(formatDiff(0)).toBe('—');
      expect(formatDiff(1.5)).toBe('1.5');
      expect(formatDiff(null)).toBe('—');
    });

    it('formats percentages with one decimal', () => {
      expect(formatPercent(3.8)).toBe('3.8%');
      expect(formatPercent(12)).toBe('12.0%');
      expect(formatPercent(null)).toBe('—');
    });

    it('formats metric values through unit codes and byte scaling', () => {
      expect(formatMetricValue(200, 'ms')).toBe('200 ms');
      expect(formatMetricValue(0.9, 'percentunit')).toBe('90%');
      expect(formatMetricValue(1073741824, 'bytes')).toBe('1 GB');
      expect(formatMetricValue(1234.5)).toBe('1,234.5');
      expect(formatMetricValue(null, 'ms')).toBe('—');
    });
  });

  describe('section header (rule 04)', () => {
    it('renders the brandable accent rule, title, and right-aligned chips, no emoji', () => {
      const html = sectionHeader('SLO Results', {
        chipsHtml: [chip('10 regressions', 'bad')],
        kicker: 'Service Level Objectives',
      });
      expect(html).toContain('border-left:4px solid var(--primary-color, #1976d2)');
      expect(html).toContain('SLO Results');
      expect(html).toContain('10 regressions');
      expect(html).toContain('Service Level Objectives');
      expect(html).toContain('text-transform:uppercase');
      expect(html).not.toMatch(/[✓⭐❓↔➖]/u);
    });

    it('escapes the title', () => {
      expect(sectionHeader('<script>')).toContain('&lt;script&gt;');
    });
  });

  describe('group header + host stripping (rule 05)', () => {
    it('renders label with chips and brandable accent', () => {
      const html = groupHeader('Dynatrace', [chip('afterburner-be', 'info'), chip('4 metrics', 'neutral')]);
      expect(html).toContain('Dynatrace');
      expect(html).toContain('afterburner-be');
      expect(html).toContain('4 metrics');
      expect(html).toContain('var(--primary-color, #1976d2)');
    });

    it('strips host-id prefixes from metric names', () => {
      expect(splitHostLabel('HOST-123_afterburner-be_CPU Usage')).toEqual({
        host: 'afterburner-be',
        metric: 'CPU Usage',
      });
      expect(splitHostLabel('plain label')).toEqual({ host: '', metric: 'plain label' });
    });
  });

  describe('shared building blocks', () => {
    it('renders the single empty-state treatment, escaped', () => {
      const html = emptyState('No SLO check results <available>');
      expect(html).toContain('#f5f5f5');
      expect(html).toContain('&lt;available&gt;');
    });

    it('renders stat cards with escaped label and raw value html', () => {
      const html = statCard('Total Checks', '<span>42</span>', chip('ok', 'good'));
      expect(html).toContain('Total Checks');
      expect(html).toContain('<span>42</span>');
      expect(html).toContain('#f8f9fa');
    });

    it('exports one thead style pair', () => {
      expect(TH_TEXT).toContain('white-space:nowrap');
      expect(TH_NUM).toContain('text-align:right');
    });
  });

  describe('comment block (rule 07)', () => {
    it('renders accent + icon for a comment', () => {
      const html = commentBlock('Investigated with team, see PERF-42');
      expect(html).toContain('section-comment');
      expect(html).toContain('var(--primary-color, #1976d2)');
      expect(html).toContain('PERF-42');
      expect(html).toContain('<svg');
    });

    it('omits entirely when empty or whitespace', () => {
      expect(commentBlock(undefined)).toBe('');
      expect(commentBlock('')).toBe('');
      expect(commentBlock('   ')).toBe('');
    });

    it('escapes comment content', () => {
      expect(commentBlock('<img onerror=x>')).toContain('&lt;img');
    });
  });
});
