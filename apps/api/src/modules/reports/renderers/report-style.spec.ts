import {
  statusFor,
  statusPill,
  deltaArrow,
  deltaChip,
  formatInt,
  formatNum,
  formatDiff,
  formatPercent,
  sectionHeader,
  groupHeader,
  splitHostLabel,
  commentBlock,
  chip,
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

    it('respects direction for lower-is-worse metrics (throughput)', () => {
      expect(statusFor(-80, undefined, false)).toBe('regression');
      expect(statusFor(30, undefined, false)).toBe('improvement');
    });

    it('respects custom thresholds', () => {
      expect(statusFor(15, { good: 20, warning: 60 })).toBe('ok');
      expect(statusFor(30, { good: 20, warning: 60 })).toBe('warning');
      expect(statusFor(70, { good: 20, warning: 60 })).toBe('regression');
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
  });

  describe('delta arrows (rule 02)', () => {
    it('binds the glyph to the value direction', () => {
      expect(deltaArrow(12)).toBe('▲');
      expect(deltaArrow(-3)).toBe('▼');
      expect(deltaArrow(0)).toBe('–');
      expect(deltaArrow(null)).toBe('');
    });

    it('colors the chip by meaning, not raw direction', () => {
      expect(deltaChip(80)).toContain('▲');
      expect(deltaChip(80)).toContain('#fbe6e4'); // regression fill
      expect(deltaChip(-30)).toContain('▼');
      expect(deltaChip(-30)).toContain('#eaf1fb'); // improvement fill
      expect(deltaChip(-80, undefined, false)).toContain('#fbe6e4'); // lower-is-worse regression
      expect(deltaChip(null)).toContain('—');
    });
  });

  describe('number formatting (rule 03)', () => {
    it('groups thousands', () => {
      expect(formatInt(4937045)).toBe('4,937,045');
      expect(formatNum(4937045.129)).toBe('4,937,045.13');
    });

    it('caps decimals at two', () => {
      expect(formatNum(-0.2661)).toBe('-0.27');
    });

    it('renders a true zero diff as em-dash', () => {
      expect(formatDiff(0)).toBe('—');
      expect(formatDiff(1.5)).toBe('1.5');
    });

    it('formats percentages with one decimal', () => {
      expect(formatPercent(3.8)).toBe('3.8%');
      expect(formatPercent(12)).toBe('12.0%');
      expect(formatPercent(null)).toBe('—');
    });
  });

  describe('section header (rule 04)', () => {
    it('renders the accent rule, title, and right-aligned chips, no emoji', () => {
      const html = sectionHeader('SLO Results', {
        chipsHtml: [chip('10 regressions', 'bad')],
        kicker: 'Service Level Objectives',
      });
      expect(html).toContain('border-left:4px solid #1976d2');
      expect(html).toContain('SLO Results');
      expect(html).toContain('10 regressions');
      expect(html).toContain('SERVICE LEVEL OBJECTIVES'.length ? 'Service Level Objectives' : '');
      expect(html).not.toMatch(/[✓⭐❓↔➖]/u);
    });

    it('escapes the title', () => {
      expect(sectionHeader('<script>')).toContain('&lt;script&gt;');
    });
  });

  describe('group header + host stripping (rule 05)', () => {
    it('renders label with chips', () => {
      const html = groupHeader('Dynatrace', [chip('afterburner-be', 'info'), chip('4 metrics', 'neutral')]);
      expect(html).toContain('Dynatrace');
      expect(html).toContain('afterburner-be');
      expect(html).toContain('4 metrics');
    });

    it('strips host-id prefixes from metric names', () => {
      expect(splitHostLabel('HOST-123_afterburner-be_CPU Usage')).toEqual({
        host: 'afterburner-be',
        metric: 'CPU Usage',
      });
      expect(splitHostLabel('plain label')).toEqual({ host: '', metric: 'plain label' });
    });
  });

  describe('comment block (rule 07)', () => {
    it('renders accent + icon for a comment', () => {
      const html = commentBlock('Investigated with team, see PERF-42');
      expect(html).toContain('section-comment');
      expect(html).toContain('#1976d2');
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
