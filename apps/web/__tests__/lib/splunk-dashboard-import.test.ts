import * as fs from 'fs';
import * as path from 'path';
import { convertSearch, convertSplunkDashboard, parseSplunkDashboardJson } from '@/lib/splunk-dashboard-import';
import { validateSplFilter } from '@perfana/shared/services/splunk/client';

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'splunk-studio-dashboard.json'), 'utf8');

describe('parseSplunkDashboardJson on an exported Dashboard Studio dashboard', () => {
  const result = parseSplunkDashboardJson(fixture);
  const byTitle = (t: string) => result.panels.find((p) => p.panelTitle === t);

  it('takes the dashboard title, for the Perfana dashboard label', () => {
    expect(result.title).toBe('BTE performancetest');
  });

  it('turns a single-value count into a count panel with $entities in place of the index', () => {
    const p = byTitle('Aantal meetpunt="in-bcm-bte-vkb"')!;
    expect(p.spl).toBe('$entities ApplicatieNaam="bcm-bte-vkb" MeetpuntLabel="in-bcm-bte-vkb"');
    expect(p.aggregation).toBe('count');
    expect(p.splitBy).toBeNull();
    expect(p.indexes).toEqual(['ecm-sts-appl']);
    expect(p.notes.join(' ')).toMatch(/fields.*display only/);
  });

  it('keeps eval before a timechart and turns "count by" into the split-by field', () => {
    const p = byTitle('VKB per minuut')!;
    expect(p.spl).toBe('$entities ApplicatieNaam="bcm-bte-vkb" | eval richting=if(like(MeetpuntLabel,"in-%"),"in","uit")');
    expect(p.aggregation).toBe('count');
    expect(p.splitBy).toBe('richting');
    expect(p.notes.join(' ')).toMatch(/span=1m/);
  });

  it('skips the per-id duration search, which has no single-aggregation equivalent, and says why', () => {
    const s = result.skipped.find((x) => x.panelTitle === 'Duur (ms) per MeetpuntmatchID')!;
    expect(s.reason).toMatch(/stats is followed by \| eval/);
  });

  it('imports a search shared by several visualizations once', () => {
    const titles = result.panels.map((p) => p.panelTitle);
    expect(titles.filter((t) => t === 'Aantal meetpunt="uit-bcm-bte-ovb"')).toHaveLength(1);
    expect(titles.filter((t) => t === 'AVO per minuut')).toHaveLength(1);
    expect(result.skipped.filter((s) => /^Same search as/.test(s.reason)).length).toBeGreaterThanOrEqual(3);
    // Decoration (the rectangle) is neither a panel nor a skip.
    expect([...result.panels, ...result.skipped].some((x) => x.key === 'viz_tLl77t0F')).toBe(false);
  });

  it('produces only filters the API accepts', () => {
    expect(result.panels.length).toBeGreaterThan(10);
    for (const p of result.panels) {
      expect(validateSplFilter(p.spl, { timeModifiers: true })).toBeNull();
      expect(p.spl).toMatch(/^\$entities\b/);
    }
  });
});

describe('convertSearch', () => {
  it.each([
    ['index=web status>=500 | timechart span=1m p95(duration) by host limit=5', { aggregation: 'p95(duration)', splitBy: 'host', maxSeries: 5 }],
    ['index=web | timechart dc(user) as users', { aggregation: 'dc(user)', splitBy: null }],
    ['index=web | timechart distinct_count(user)', { aggregation: 'dc(user)', splitBy: null }],
    ['index=web | stats count by status', { aggregation: 'count', splitBy: 'status' }],
    ['index=web | top limit=5 uri', { aggregation: 'count', splitBy: 'uri', maxSeries: 5 }],
    ['index=web | chart avg(rt) over _time by host', { aggregation: 'avg(rt)', splitBy: 'host' }],
    ['index=web level=ERROR', { aggregation: 'count', splitBy: null }],
  ])('%s', (query, expected) => {
    const r = convertSearch(query);
    expect('error' in r).toBe(false);
    expect(r).toMatchObject(expected);
  });

  it('drops dashboard tokens and time modifiers from the search terms, with a note', () => {
    const r = convertSearch('index=web host=$host$ earliest=-1h level=ERROR | timechart $span$ count');
    if ('error' in r) throw new Error(r.error);
    expect(r.spl).toBe('$entities level=ERROR');
    expect(r.notes.join(' ')).toMatch(/\$host\$.*tokens/);
    expect(r.notes.join(' ')).toMatch(/earliest=-1h/);
  });

  it.each([
    ['| tstats count where index=web', /generating command/],
    ['index=web [search index=other | fields id]', /Subsearches/],
    ['index=web `my_macro`', /macros/],
    ['index=web | transaction session | timechart count', /transaction has no Perfana equivalent/],
    ['index=web | chart count by host', /over _time/],
    ['index=web | timechart count by host, status', /more than one field/],
    ['index=web | timechart stdev(rt)', /not supported/],
  ])('refuses %s', (query, reason) => {
    const r = convertSearch(query);
    expect('error' in r && r.error).toMatch(reason);
  });

  it('reports a filter the API would refuse instead of offering it', () => {
    const r = convertSearch('index=web foo\\bar | timechart count');
    expect('error' in r && r.error).toMatch(/would be refused: A backslash/);
  });

  it('keeps a pipe inside a quoted string', () => {
    const r = convertSearch('index=web msg="a|b" | timechart count');
    if ('error' in r) throw new Error(r.error);
    expect(r.spl).toBe('$entities msg="a|b"');
  });
});

describe('convertSplunkDashboard input shapes', () => {
  const def = {
    title: 'D',
    visualizations: {
      v1: { type: 'splunk.line', title: 'Errors', dataSources: { primary: 'chain' } },
      v2: { type: 'splunk.table', title: 'Saved', dataSources: { primary: 'saved' } },
    },
    dataSources: {
      base: { type: 'ds.search', options: { query: 'index=app level=ERROR' } },
      chain: { type: 'ds.chain', options: { extend: 'base', query: '| timechart count by host' } },
      saved: { type: 'ds.savedSearch', options: { ref: 'My report' } },
    },
  };

  it('follows a chained search to its base', () => {
    const r = convertSplunkDashboard(def);
    expect(r.panels[0]).toMatchObject({ panelTitle: 'Errors', spl: '$entities level=ERROR', splitBy: 'host' });
    expect(r.skipped[0]!.reason).toMatch(/saved search/);
  });

  it('accepts the REST API wrapper with a stringified definition', () => {
    expect(convertSplunkDashboard({ definition: JSON.stringify(def) }).panels).toHaveLength(1);
  });

  it('refuses Classic XML and non-JSON with a readable message', () => {
    expect(() => parseSplunkDashboardJson('<dashboard/>')).toThrow(/not valid JSON/);
    expect(() => convertSplunkDashboard({ title: 'x' })).toThrow(/Dashboard Studio/);
  });

  it('suffixes a title shared by two different searches', () => {
    const r = convertSplunkDashboard({
      visualizations: {
        a: { title: 'Count', dataSources: { primary: 'x' } },
        b: { title: 'Count', dataSources: { primary: 'y' } },
      },
      dataSources: {
        x: { type: 'ds.search', options: { query: 'index=a foo=1' } },
        y: { type: 'ds.search', options: { query: 'index=a foo=2' } },
      },
    });
    expect(r.panels.map((p) => p.panelTitle)).toEqual(['Count', 'Count (2)']);
  });
});
