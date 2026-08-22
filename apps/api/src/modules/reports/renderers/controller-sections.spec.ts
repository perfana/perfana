import { buildSampleSections, controllerKind } from './controller-sections';

const TG = 'org.apache.jmeter.threads.ThreadGroup';
const TC = 'org.apache.jmeter.control.TransactionController';
const PC = 'org.apache.jmeter.control.ParallelController';
const LC = 'org.apache.jmeter.control.LoopController';
const IF = 'org.apache.jmeter.control.IfController';

const sample = (name: string, firstSeen: number, chain: Array<{ name: string; class: string; occurrence?: number }>) =>
  ({ name, firstSeen, parentControllers: chain });

/** Leader names in render order, bands flattened out. */
const flatten = (sections: ReturnType<typeof buildSampleSections>): string[] =>
  sections.flatMap((s) =>
    s.kind === 'single' ? [(s.sample as { name: string }).name] : [`[${s.name}]`, ...flatten(s.children)],
  );

describe('controllerKind', () => {
  it('classifies by the class, never by the controller name', () => {
    // Names are free text a test plan can reuse; the class is the only reliable
    // discriminator.
    expect(controllerKind(PC)).toBe('parallel');
    expect(controllerKind(LC)).toBe('loop');
    expect(controllerKind(IF)).toBe('conditional');
    expect(controllerKind('org.apache.jmeter.control.InterleaveControl')).toBe('alternating');
    expect(controllerKind(TC)).toBe('transaction');
  });

  it('gives an unrecognised controller the neutral band rather than dropping it', () => {
    expect(controllerKind('com.example.MyCustomController')).toBe('other');
    expect(controllerKind('')).toBe('other');
  });
});

describe('buildSampleSections', () => {
  it('bands the requests that share a controller', () => {
    const sections = buildSampleSections([
      sample('a', 1, [{ name: 'Group', class: PC }]),
      sample('b', 2, [{ name: 'Group', class: PC }]),
    ], 'T01');

    expect(flatten(sections)).toEqual(['[Group]', 'a', 'b']);
  });

  it('drops the thread group and the transaction the table is already headed by', () => {
    const sections = buildSampleSections([
      sample('a', 1, [{ name: 'Users', class: TG }, { name: 'T01', class: TC }, { name: 'Group', class: PC }]),
      sample('b', 2, [{ name: 'Users', class: TG }, { name: 'T01', class: TC }, { name: 'Group', class: PC }]),
    ], 'T01');

    expect(flatten(sections)).toEqual(['[Group]', 'a', 'b']);
  });

  it('orders by first appearance, which is plan order — not by arrival', () => {
    const sections = buildSampleSections([
      sample('late', 9, []),
      sample('early', 1, []),
    ], 'T01');

    expect(flatten(sections)).toEqual(['early', 'late']);
  });

  it('drops a parallel band wrapping a single request but keeps a loop band', () => {
    // "These ran together" is false of one row; "this repeats" is still true.
    expect(flatten(buildSampleSections([sample('solo', 1, [{ name: 'P', class: PC }])], 'T01')))
      .toEqual(['solo']);
    expect(flatten(buildSampleSections([sample('solo', 1, [{ name: 'Retry', class: LC }])], 'T01')))
      .toEqual(['[Retry]', 'solo']);
  });

  it('keeps two identically-named sibling controllers apart by occurrence', () => {
    const sections = buildSampleSections([
      sample('a', 1, [{ name: 'Loop', class: LC, occurrence: 0 }]),
      sample('b', 2, [{ name: 'Loop', class: LC, occurrence: 1 }]),
    ], 'T01');

    expect(flatten(sections)).toEqual(['[Loop]', 'a', '[Loop]', 'b']);
  });

  it('nests a band inside a band', () => {
    const sections = buildSampleSections([
      sample('a', 1, [{ name: 'Outer', class: LC }, { name: 'Inner', class: PC }]),
      sample('b', 2, [{ name: 'Outer', class: LC }, { name: 'Inner', class: PC }]),
    ], 'T01');

    expect(flatten(sections)).toEqual(['[Outer]', '[Inner]', 'a', 'b']);
  });

  it('yields a flat list when the run records no controllers', () => {
    const sections = buildSampleSections([
      { name: 'a' } as never,
      { name: 'b' } as never,
    ], 'T01');

    expect(flatten(sections)).toEqual(['a', 'b']);
  });
});
