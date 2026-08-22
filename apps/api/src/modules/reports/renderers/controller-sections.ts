// ponytail: pure port of the Performance Analysis card's
// apps/web/app/test-runs/[id]/components/performance-analysis/utils/controller-sections.ts,
// minus the parallel-group timings the report does not render. Keep in sync if the card's
// banding rules change. Same convention as comparison-bands.ts.

/** A controller in a request's chain, outermost first. */
export interface ControllerRef {
  name: string;
  /** Fully-qualified class, e.g. `org.apache.jmeter.control.ParallelController`. */
  class: string;
  /** Which of several identically-named siblings this is, 0-based. */
  occurrence?: number;
}

/**
 * What a controller does to the requests beneath it. A parallel band answers "how long did the
 * concurrent pass take"; a loop band answers "why does this request have several times the count
 * of its neighbour"; a conditional band answers "why is this count lower and ragged".
 */
export type ControllerKind =
  | 'parallel'
  | 'loop'
  | 'conditional'
  | 'alternating'
  | 'transaction'
  | 'other';

const KIND_BY_CLASS: Record<string, ControllerKind> = {
  ParallelController: 'parallel',

  LoopController: 'loop',
  ForeachController: 'loop',
  WhileController: 'loop',

  IfController: 'conditional',
  ThroughputController: 'conditional',
  RunTime: 'conditional',

  // One child per pass rather than all of them, which is why a band's count is split across
  // its members instead of repeated on each: 29 + 21 = 50, not 50 + 50.
  InterleaveControl: 'alternating',
  InterleaveController: 'alternating',
  RandomController: 'alternating',
  RandomOrderController: 'alternating',
  SwitchController: 'alternating',

  TransactionController: 'transaction',
};

/**
 * Classified by the last segment of the fully-qualified class, never by the controller's name:
 * names are free text a test plan can reuse. An unrecognised controller still gets a band, it
 * just gets the neutral one.
 */
export function controllerKind(controllerClass: string): ControllerKind {
  return KIND_BY_CLASS[controllerClass.split('.').pop() ?? ''] ?? 'other';
}

/** The minimum a sample needs to be banded. */
export interface BandableSample {
  parentControllers?: ControllerRef[] | null;
  firstSeen?: number;
}

export interface SampleGroupSection<T> {
  kind: 'group';
  name: string;
  controller: ControllerKind;
  children: SampleSection<T>[];
}

export interface SampleSingleSection<T> {
  kind: 'single';
  sample: T;
}

export type SampleSection<T> = SampleGroupSection<T> | SampleSingleSection<T>;

/**
 * Drops the chain entries that carry no information inside this transaction's table: the Thread
 * Group, which is the same for every row in the run, and the Transaction Controller the table is
 * already headed by.
 *
 * Deliberately not "strip the longest common prefix": that rule erases the parallel band from a
 * transaction whose requests ALL ran in one group, which is exactly the case the band exists for.
 */
function meaningfulChain(chain: ControllerRef[], transactionName: string): ControllerRef[] {
  return chain.filter((c) => !c.class.endsWith('ThreadGroup') && c.name !== transactionName);
}

/**
 * Turns the flat request list into the slice of the test plan that produced it.
 *
 * A band is anchored at the position of its first member, so nesting never reshuffles the table
 * more than clustering requires. A run without controller data yields one `single` section per
 * request — exactly the previous flat table.
 */
export function buildSampleSections<T extends BandableSample>(
  samples: T[],
  transactionName: string = '',
): SampleSection<T>[] {
  const root: SampleSection<T>[] = [];
  // Ordered by where each request first fired, which puts the controllers in the order the test
  // plan declares them: within one pass a thread walks the plan top to bottom. Runs with no
  // controller data keep the order they arrived in.
  const ordered = samples.some((s) => s.firstSeen !== undefined)
    ? [...samples].sort((a, b) => (a.firstSeen ?? Infinity) - (b.firstSeen ?? Infinity))
    : samples;
  // Keyed by the full path so two different loops can share a controller name, and so a name
  // reused at two depths does not collapse into one band.
  const bandByPath = new Map<string, SampleGroupSection<T>>();

  for (const sample of ordered) {
    let siblings = root;
    let path = '';

    const chain = sample.parentControllers && sample.parentControllers.length > 0
      ? meaningfulChain(sample.parentControllers, transactionName)
      : [];

    for (const controller of chain) {
      // Length-prefixed so ("ab","c") and ("a","bc") cannot produce the same path, and keyed on
      // occurrence as well as name so two identically-named sibling controllers stay two bands.
      path += `${controller.name.length}:${controller.name}@${controller.occurrence ?? 0}`;
      let band = bandByPath.get(path);
      if (!band) {
        band = {
          kind: 'group',
          name: controller.name,
          controller: controllerKind(controller.class),
          children: [],
        };
        bandByPath.set(path, band);
        siblings.push(band);
      }
      siblings = band.children;
    }

    siblings.push({ kind: 'single', sample });
  }

  return prune(root);
}

/**
 * A parallel band around a single request claims "these ran together" about a row with nothing
 * to run together with, so it is dropped. A loop or conditional band claims "this repeats" /
 * "this only sometimes runs", which is still true of one request.
 */
function prune<T>(sections: SampleSection<T>[]): SampleSection<T>[] {
  return sections.flatMap((section) => {
    if (section.kind === 'single') return [section];

    const children = prune(section.children);
    const collapse =
      children.length === 1 &&
      (section.controller === 'parallel' || section.controller === 'transaction');

    return collapse ? children : [{ ...section, children }];
  });
}
