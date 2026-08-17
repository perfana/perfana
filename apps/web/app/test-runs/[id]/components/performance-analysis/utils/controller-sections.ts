import {
  ControllerRef,
  ParallelGroupStats,
  SamplerStat,
} from '../types/performance-analysis.types';

/**
 * What a controller does to the requests beneath it — which decides what its band can honestly
 * report. A parallel band answers "how long did the concurrent pass take"; a loop band answers
 * "why does this request have several times the count of its neighbour"; a conditional band
 * answers "why is this count lower and ragged". Giving a loop an elapsed time would be inventing
 * a number nothing measures.
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
 * just gets the neutral one — better than dropping a level of the tree we do not have a label
 * for.
 */
export function controllerKind(controllerClass: string): ControllerKind {
  return KIND_BY_CLASS[controllerClass.split('.').pop() ?? ''] ?? 'other';
}

export interface SamplerGroupSection {
  kind: 'group';
  name: string;
  controller: ControllerKind;
  /**
   * How long the group itself took. Only ever set for a `parallel` band — it is the one kind
   * whose duration is measured (by the rollup pipeline). Null for every other kind, for a run
   * not yet analysed, and permanently for any run whose chain came from the plan-path metadata,
   * which records no per-execution identity to measure a pass with.
   */
  stats: ParallelGroupStats | null;
  children: SamplerSection[];
}

export interface SamplerSingleSection {
  kind: 'single';
  sample: SamplerStat;
}

export type SamplerSection = SamplerGroupSection | SamplerSingleSection;

/** Every sampler at or below a section, in render order. */
export function sectionSamples(section: SamplerSection): SamplerStat[] {
  return section.kind === 'single'
    ? [section.sample]
    : section.children.flatMap(sectionSamples);
}

/**
 * Drops the chain entries that carry no information *inside this transaction's table*: the
 * Thread Group, which is the same for every row in the run, and the Transaction Controller the
 * table is already headed by. What survives is the structure that actually differs between the
 * requests on screen.
 *
 * Deliberately not "strip the longest common prefix": that rule erases the parallel band from a
 * transaction whose requests ALL ran in one group, which is exactly the case the band exists for.
 */
function meaningfulChain(chain: ControllerRef[], transactionName: string): ControllerRef[] {
  return chain.filter((c) => !c.class.endsWith('ThreadGroup') && c.name !== transactionName);
}

/**
 * The chain to render a sampler under.
 *
 * The API has already dropped the trailing sampler entry that plan-path metadata carries, so
 * both metadata shapes arrive here ending at the innermost controller.
 *
 * Falls back to synthesising a one-entry chain from `parallel_group` so a web build that is
 * ahead of the API still draws the parallel bands it used to, rather than flattening the table.
 */
function chainFor(sample: SamplerStat, transactionName: string): ControllerRef[] {
  if (sample.parent_controllers && sample.parent_controllers.length > 0) {
    return meaningfulChain(sample.parent_controllers, transactionName);
  }
  return sample.parallel_group
    ? [{ name: sample.parallel_group, class: 'org.apache.jmeter.control.ParallelController' }]
    : [];
}

/**
 * Turns the flat request list into the slice of the test plan that produced it.
 *
 * The incoming order (total_count DESC) is preserved, and a band is anchored at the position of
 * its first member, so nesting never reshuffles the table more than clustering requires.
 *
 * A run without controller data — an older run, or a load test tool that does not report it —
 * yields one `single` section per request, i.e. exactly the previous flat table.
 */
export function buildSamplerSections(
  samples: SamplerStat[],
  transactionName: string = '',
): SamplerSection[] {
  const root: SamplerSection[] = [];
  // Ordered by where each request first fired, which puts the controllers in the order the test
  // plan declares them: within one pass a thread walks the plan top to bottom. Runs with no
  // controller data keep the order they arrived in (total_count DESC), so nothing moves for
  // them.
  const ordered = samples.some((s) => s.first_seen !== undefined)
    ? [...samples].sort((a, b) => (a.first_seen ?? Infinity) - (b.first_seen ?? Infinity))
    : samples;
  // Keyed by the full path so two different loops can share a controller name, and so a name
  // reused at two depths does not collapse into one band.
  const bandByPath = new Map<string, SamplerGroupSection>();

  for (const sample of ordered) {
    let siblings = root;
    let path = '';

    for (const controller of chainFor(sample, transactionName)) {
      // Length-prefixed so ("ab","c") and ("a","bc") cannot produce the same path, and keyed on
      // occurrence as well as name so two identically-named sibling controllers stay two bands
      // instead of collapsing into one. That is what occurrence was added for.
      path += `${controller.name.length}:${controller.name}@${controller.occurrence ?? 0}`;
      let band = bandByPath.get(path);
      if (!band) {
        band = {
          kind: 'group',
          name: controller.name,
          controller: controllerKind(controller.class),
          stats: null,
          children: [],
        };
        bandByPath.set(path, band);
        siblings.push(band);
      }
      if (band.controller === 'parallel') {
        band.stats = band.stats ?? sample.parallel_group_stats ?? null;
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
 * "this only sometimes runs", which is still true — and still worth saying — of one request.
 */
function prune(sections: SamplerSection[]): SamplerSection[] {
  return sections.flatMap((section) => {
    if (section.kind === 'single') return [section];

    const children = prune(section.children);
    const collapse =
      children.length === 1 &&
      (section.controller === 'parallel' || section.controller === 'transaction');

    return collapse ? children : [{ ...section, children }];
  });
}
