import { authenticatedFetch } from '@/lib/api';

/**
 * Suggested labels offered in the autocomplete. The field is free-solo — anything
 * a user types becomes a label and is offered back via `fetchHostLabels()` — so
 * this list is a starting point, not an allowed set.
 */
export const DEFAULT_HOST_LABELS = [
  'loadgenerator',
  'webserver',
  'appserver',
  'database',
  'loadbalancer',
  'proxy',
  'cache',
  'messagequeue',
  'apigateway',
  'searchengine',
  'storage',
  'batchserver',
  'monitoring',
  'kubernetesnode',
];

/** Every label already used on an entity mapping, plus the defaults, de-duplicated. */
export async function fetchHostLabelOptions(): Promise<string[]> {
  try {
    const response = await authenticatedFetch('/dynatrace/entities/labels');
    if (!response.ok) return DEFAULT_HOST_LABELS;
    const used: string[] = await response.json();
    return Array.from(new Set([...DEFAULT_HOST_LABELS, ...used])).sort();
  } catch {
    // Suggestions are a convenience — a failed fetch must not block labelling.
    return DEFAULT_HOST_LABELS;
  }
}

export async function updateHostLabels(mappingId: string, labels: string[]): Promise<string[]> {
  const response = await authenticatedFetch(`/dynatrace/entities/mappings/${mappingId}/labels`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels }),
  });
  if (!response.ok) {
    throw new Error('Failed to update labels');
  }
  const updated = await response.json();
  return updated.labels ?? [];
}
