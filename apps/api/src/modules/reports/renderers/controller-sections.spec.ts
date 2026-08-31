import { buildSampleSections, controllerKind } from './controller-sections';

const TG = 'org.apache.jmeter.threads.ThreadGroup';
const TC = 'org.apache.jmeter.control.TransactionController';
const PC = 'org.apache.jmeter.control.ParallelController';
const LC = 'org.apache.jmeter.control.LoopController';
const IF = 'org.apache.jmeter.control.IfController';
// Plan structure: nests above every row and says nothing about how it executed.
const GC = 'org.apache.jmeter.control.GenericController';
const MC = 'org.apache.jmeter.control.ModuleController';
const TF = 'org.apache.jmeter.control.TestFragmentController';

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
    // Survives the `other` filter only because it is classified: a count of 1 against
    // neighbours showing N needs the band to explain it.
    expect(controllerKind('org.apache.jmeter.control.OnceOnlyController')).toBe('conditional');
    expect(controllerKind('org.apache.jmeter.control.InterleaveControl')).toBe('alternating');
    expect(controllerKind(TC)).toBe('transaction');
  });

  it('classifies an unrecognised controller as other, which is not banded', () => {
    expect(controllerKind('com.example.MyCustomController')).toBe('other');
    expect(controllerKind('')).toBe('other');
  });
});

describe('plan-structure controllers', () => {
  // Module / Test Fragment / Simple Controller nest three deep above every row of a real plan.
  it('drops them instead of banding, keeping the loop inside them', () => {
    const chain = [
      { name: 'Debug', class: TG },
      { name: 'Module Controller', class: MC },
      { name: 'Test Script', class: TF },
      { name: 'StartPagina', class: GC },
      { name: 'T01', class: TC },
    ];
    const sections = buildSampleSections(
      [
        sample('a', 1, chain),
        sample('b', 2, [...chain, { name: 'Loop Controller x 5', class: LC }]),
      ],
      'T01',
    );

    expect(flatten(sections)).toEqual(['a', '[Loop Controller x 5]', 'b']);
  });

  it('flattens a chain made only of plan structure', () => {
    const sections = buildSampleSections(
      [sample('a', 1, [{ name: 'Debug', class: TG }, { name: 'Klikpad', class: GC }])],
      'T01',
    );

    expect(flatten(sections)).toEqual(['a']);
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
