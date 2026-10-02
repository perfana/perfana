/**
 * The sentence under the report sections' metric picker.
 *
 * It is not decoration. "A level left empty means everything below it" is generous in the
 * direction that surprises people, and the bug it exists for is a config that picks two
 * dashboards and panels on only one of them: the renderer drops the other dashboard, the
 * picker still shows it ticked. These assertions are the contract between the two.
 */
import { metricSelectionScopeNote } from './MetricSelectionCascade';

const scope = (over: Partial<Parameters<typeof metricSelectionScopeNote>[0]> = {}) =>
  metricSelectionScopeNote({
    dashboards: ['JVM'],
    droppedDashboards: [],
    panelsPicked: 0,
    droppedPanels: [],
    seriesPicked: 0,
    ...over,
  });

it('says nothing is in scope before a dashboard is picked', () => {
  expect(scope({ dashboards: [] })).toBe('Nothing in scope yet — pick a dashboard.');
});

it('reads an empty panels level as every panel AND every series', () => {
  expect(scope()).toBe('Every panel and series of the picked dashboards is included.');
});

it('reads an empty series level as every series of the picked panels', () => {
  expect(scope({ panelsPicked: 2 })).toBe('Every series of the picked panels is included.');
});

it('says exactly the picked series once every level is explicit', () => {
  expect(scope({ panelsPicked: 2, seriesPicked: 3 }))
    .toBe('Exactly the picked series is included.');
});

it('names a dashboard that no picked panel belongs to', () => {
  expect(scope({ dashboards: ['JVM', 'Docker'], panelsPicked: 2, droppedDashboards: ['Docker'] }))
    .toBe('No panel picked on Docker, so it is left out. Every series of the picked panels is included.');
});

it('names a picked panel that no picked series belongs to', () => {
  expect(scope({ panelsPicked: 2, seriesPicked: 1, droppedPanels: ['GC Pause'] }))
    .toBe('No series picked on GC Pause, so it is left out. Exactly the picked series is included.');
});

it('agrees with itself on plurals, and joins names with "and"', () => {
  expect(scope({ panelsPicked: 1, droppedDashboards: ['Docker', 'k6'] }))
    .toContain('No panel picked on Docker and k6, so they are left out.');
  expect(scope({ panelsPicked: 1, droppedDashboards: ['a', 'b', 'c'] }))
    .toContain('No panel picked on a, b and c, so they are left out.');
});

it('reports both drops at once, because a partial selection can have both', () => {
  const note = scope({
    dashboards: ['JVM', 'Docker'],
    droppedDashboards: ['Docker'],
    panelsPicked: 2,
    droppedPanels: ['GC Pause'],
    seriesPicked: 1,
  });
  expect(note).toBe(
    'No panel picked on Docker, so it is left out.'
    + ' No series picked on GC Pause, so it is left out.'
    + ' Exactly the picked series is included.',
  );
});
