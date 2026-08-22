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
  sectionText,
  emptyState,
  statCard,
  markerChip,
  chip,
  bandFilterChip,
  BAND_FOR_RANK,
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

  describe('section text (rule 07)', () => {
    it('renders the text as bare prose', () => {
      const html = sectionText('Investigated with team, see PERF-42');
      expect(html).toContain('section-text');
      expect(html).toContain('PERF-42');
    });

    it('carries no callout chrome — no icon, tint, or accent border', () => {
      // Accompanying text is narrative belonging to the section, not an
      // annotation about it. Any of these would reintroduce the old bubble.
      const html = sectionText('Some prose');
      expect(html).not.toContain('<svg');
      expect(html).not.toContain('#f5f9ff');
      expect(html).not.toContain('border-left');
      expect(html).not.toContain('section-comment');
    });

    it('omits entirely when empty or whitespace', () => {
      expect(sectionText(undefined)).toBe('');
      expect(sectionText('')).toBe('');
      expect(sectionText('   ')).toBe('');
    });

    it('escapes text content', () => {
      expect(sectionText('<img onerror=x>')).toContain('&lt;img');
    });

    it('renders markdown, matching the toolbar the editor offers', () => {
      const html = sectionText('The **p95** rose\n\n- checkout\n- search');

      expect(html).toContain('<strong>p95</strong>');
      expect(html).toContain('<ul');
      expect(html).toContain('<li>checkout</li>');
      expect(html).not.toContain('**p95**');
    });

    it('still escapes author HTML once markdown rendering is in play', () => {
      const html = sectionText('<script>alert(1)</script> and [x](javascript:alert(1))');

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<a href="javascript');
    });

    it('keeps a heading from inheriting the report section chrome', () => {
      // The text sits inside <section>, so an unreset h2 would pick up the
      // brand colour and underline meant for real section titles.
      const html = sectionText('## Note');

      expect(html).toContain('color:inherit');
    });
  });
});

describe('status pills in a table cell', () => {
  // .data-table td sets overflow-wrap: anywhere so a long unbreakable value cannot push the
  // trailing columns off the page. Pills inherit it, and "EXCELLENT" came out as "EXCELLEN T"
  // stacked over two lines wherever the column was tight. A pill is a label, not prose: it
  // breaks on spaces or not at all.
  it.each([
    ['statusPill', statusPill('regression')],
    ['chip', chip('24 regressions', 'bad')],
    ['markerChip', markerChip('current', 'info')],
    ['deltaChip', deltaChip(12.5, 'higher-is-worse')],
  ])('%s opts out of break-anywhere', (_name, markup) => {
    expect(markup).toContain('overflow-wrap:normal');
  });
});

describe('bandFilterChip', () => {
  it('renders the same chip as chip(), plus an inert data attribute', () => {
    // The attribute is what the report's interactivity script binds to. It must
    // change nothing about how the chip looks or prints — a script-blocked
    // viewer and the PDF both keep the plain count chip.
    const plain = chip('4 warnings', 'warn');
    const filterable = bandFilterChip('4 warnings', 'warn', 'warning');

    expect(filterable).toContain('data-band-filter="warning"');
    expect(filterable.replace(' data-band-filter="warning"', '')).toBe(plain);
  });

  it('carries the band it filters for', () => {
    expect(bandFilterChip('3 regressions', 'bad', 'regression')).toContain('data-band-filter="regression"');
    expect(bandFilterChip('9 within range', 'good', 'ok')).toContain('data-band-filter="ok"');
  });

  it('escapes the label like every other chip', () => {
    expect(bandFilterChip('<script>', 'bad', 'regression')).toContain('&lt;script&gt;');
    expect(bandFilterChip('<script>', 'bad', 'regression')).not.toContain('<script>');
  });
});

describe('BAND_FOR_RANK', () => {
  it('maps the comparisons renderer\'s 0/1/2 rank onto the band names', () => {
    expect(BAND_FOR_RANK[0]).toBe('ok');
    expect(BAND_FOR_RANK[1]).toBe('warning');
    expect(BAND_FOR_RANK[2]).toBe('regression');
  });
});
