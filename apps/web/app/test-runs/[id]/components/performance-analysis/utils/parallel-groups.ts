import { SamplerStat } from '../types/performance-analysis.types';

export interface SamplerGroupSection {
  kind: 'group';
  name: string;
  samples: SamplerStat[];
}

export interface SamplerSingleSection {
  kind: 'single';
  sample: SamplerStat;
}

export type SamplerSection = SamplerGroupSection | SamplerSingleSection;

/**
 * Splits the request list into sequential rows and Parallel Controller groups.
 *
 * The incoming order (total_count DESC) is preserved for sequential rows, and a group is
 * anchored at the position of its first member so grouping never reshuffles the table more
 * than clustering requires.
 *
 * A run without parallel groups — an older run, or a load test tool that does not report them —
 * yields one `single` section per request, i.e. exactly the previous flat table.
 */
export function buildSamplerSections(samples: SamplerStat[]): SamplerSection[] {
  const sections: SamplerSection[] = [];
  const groupIndex = new Map<string, SamplerGroupSection>();

  for (const sample of samples) {
    const group = sample.parallel_group;
    if (!group) {
      sections.push({ kind: 'single', sample });
      continue;
    }
    const existing = groupIndex.get(group);
    if (existing) {
      existing.samples.push(sample);
    } else {
      const section: SamplerGroupSection = { kind: 'group', name: group, samples: [sample] };
      groupIndex.set(group, section);
      sections.push(section);
    }
  }

  // A "group" of one carries no information the row itself does not, and a band around a
  // single row is just noise.
  return sections.map((section) =>
    section.kind === 'group' && section.samples.length === 1
      ? { kind: 'single', sample: section.samples[0] }
      : section,
  );
}
