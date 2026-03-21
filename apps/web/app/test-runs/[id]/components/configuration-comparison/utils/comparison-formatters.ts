import { RelatedTestRun, ConfigItem, ConfigComparison, ExpectedConfigChange } from '../types';

/**
 * Format test run display text for autocomplete options
 */
export const getTestRunDisplayText = (testRun: RelatedTestRun): string => {
  const startTime = testRun.start_time || testRun.created_at;
  const formattedTime = new Date(startTime).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  return `${testRun.test_run_id} - ${formattedTime}`;
};

/**
 * Get secondary info for test run display (version and annotations)
 */
export const getTestRunSecondaryInfo = (testRun: RelatedTestRun): string => {
  const parts = [];

  if (testRun.application_release) {
    parts.push(`Version: ${testRun.application_release}`);
  }

  if (testRun.annotations && testRun.annotations.length > 0) {
    parts.push(`Annotations: ${testRun.annotations.join(', ')}`);
  }

  return parts.join(' \u2022 ');
};

/**
 * Create a composite key from key + sorted tags for unique identification
 * This ensures configs are only compared when both key AND tags match
 */
export const getCompositeKey = (key: string, tags: string[] | undefined): string => {
  const sortedTags = tags ? [...tags].sort().join(',') : '';
  return `${key}::${sortedTags}`;
};

/**
 * Get effective tags for a comparison (currentTags or fallback to previousTags)
 */
export const getEffectiveTags = (comparison: ConfigComparison): string[] => {
  return (comparison.currentTags && comparison.currentTags.length > 0)
    ? comparison.currentTags
    : (comparison.previousTags || []);
};

/**
 * Normalize tags from API response - handles both array and PostgreSQL array string format
 */
export const normalizeTags = (rawTags: unknown): string[] => {
  if (Array.isArray(rawTags)) {
    return rawTags;
  }
  if (typeof rawTags === 'string' && rawTags.startsWith('{')) {
    return rawTags
      .slice(1, -1)
      .split(',')
      .map((t: string) => t.replace(/^"|"$/g, '').trim())
      .filter(Boolean);
  }
  return [];
};

/**
 * Normalize config items from API response
 */
export const normalizeConfigs = (
  configs: Array<{ key: string; value: string; tags: string[] | string | null }>
): ConfigItem[] => {
  return configs.map((config) => ({
    key: config.key,
    value: config.value,
    tags: normalizeTags(config.tags),
  }));
};

/**
 * Extract unique tags from config items
 */
export const extractUniqueTags = (configs: ConfigItem[]): string[] => {
  const uniqueTags = new Set<string>();
  configs.forEach((config) => {
    if (config.tags && Array.isArray(config.tags)) {
      config.tags.forEach((tag: string) => uniqueTags.add(tag));
    }
  });
  return Array.from(uniqueTags).sort();
};

/**
 * Create comparison data structure from current and selected configs
 */
export const createConfigComparisons = (
  currentConfigs: ConfigItem[],
  selectedConfigs: ConfigItem[],
  expectedChanges: ExpectedConfigChange[]
): ConfigComparison[] => {
  if (selectedConfigs.length === 0) {
    return currentConfigs.map(config => ({
      key: config.key,
      currentValue: config.value,
      currentTags: config.tags,
      previousValue: null,
      previousTags: null,
      status: 'new' as const,
      isExpected: false
    }));
  }

  // Create maps for efficient lookup using composite key (key + sorted tags)
  const currentConfigMap = new Map(
    currentConfigs.map(config => [getCompositeKey(config.key, config.tags), config])
  );
  const selectedConfigMap = new Map(
    selectedConfigs.map(config => [getCompositeKey(config.key, config.tags), config])
  );
  const expectedChangesMap = new Map(
    expectedChanges.map(change => [change.config_key, change])
  );

  // Get all unique composite keys from both configurations
  const allCompositeKeys = new Set([
    ...Array.from(currentConfigMap.keys()),
    ...Array.from(selectedConfigMap.keys())
  ]);

  return Array.from(allCompositeKeys)
    .map(compositeKey => {
      const currentConfig = currentConfigMap.get(compositeKey);
      const selectedConfig = selectedConfigMap.get(compositeKey);
      // Use the actual key (not composite) for expected changes lookup
      const actualKey = currentConfig?.key || selectedConfig?.key || '';
      const isExpectedChange = expectedChangesMap.has(actualKey);

      if (currentConfig && selectedConfig) {
        // Both exist with same key AND tags - check if values are different
        let status: 'changed' | 'expected' | 'same';
        if (currentConfig.value !== selectedConfig.value) {
          status = isExpectedChange ? 'expected' : 'changed';
        } else {
          status = 'same';
        }

        return {
          key: currentConfig.key,
          currentValue: currentConfig.value,
          currentTags: currentConfig.tags,
          previousValue: selectedConfig.value,
          previousTags: selectedConfig.tags,
          status,
          isExpected: isExpectedChange
        };
      } else if (currentConfig && !selectedConfig) {
        // Only in current (new configuration with this key+tags combination)
        return {
          key: currentConfig.key,
          currentValue: currentConfig.value,
          currentTags: currentConfig.tags,
          previousValue: null,
          previousTags: null,
          status: 'new' as const,
          isExpected: isExpectedChange
        };
      } else {
        // Only in selected (removed configuration with this key+tags combination)
        return {
          key: selectedConfig!.key,
          currentValue: null,
          currentTags: null,
          previousValue: selectedConfig!.value,
          previousTags: selectedConfig!.tags,
          status: 'removed' as const,
          isExpected: isExpectedChange
        };
      }
    })
    .sort((a, b) => a.key.localeCompare(b.key));
};

/**
 * Filter comparisons by status, tags, and key
 */
export const filterComparisons = (
  comparisons: ConfigComparison[],
  statusFilters: string[],
  selectedTags: string[],
  keyFilter: string
): ConfigComparison[] => {
  return comparisons.filter(comparison => {
    // Status filter (OR logic - if any selected status matches)
    const matchesStatus = statusFilters.length === 0 || statusFilters.includes(comparison.status);

    // Tag filter (AND logic - must have ALL selected tags)
    const comparisonTags = getEffectiveTags(comparison);
    const matchesTags = selectedTags.length === 0 || selectedTags.every(selectedTag =>
      comparisonTags.includes(selectedTag)
    );

    // Key filter (case-insensitive fuzzy/contains match)
    const matchesKey = keyFilter.trim() === '' ||
      comparison.key.toLowerCase().includes(keyFilter.trim().toLowerCase());

    return matchesStatus && matchesTags && matchesKey;
  });
};

/**
 * Calculate accent color based on configuration changes
 */
export const getAccentColor = (comparisons: ConfigComparison[]): string => {
  // Check for unexpected changes (changed, new, or removed but not expected)
  const hasUnexpectedChanges = comparisons.some(c =>
    (c.status === 'changed' || c.status === 'new' || c.status === 'removed') && !c.isExpected
  );

  if (hasUnexpectedChanges) return '#ff9800'; // Orange for unexpected changes
  return '#4caf50'; // Green for no changes or only expected changes
};

/**
 * Count unexpected changes for KPI display
 */
export const countUnexpectedChanges = (comparisons: ConfigComparison[]): number => {
  return comparisons.filter(c =>
    (c.status === 'changed' || c.status === 'new' || c.status === 'removed') && !c.isExpected
  ).length;
};

/**
 * Check if there are any unexpected changes
 */
export const hasUnexpectedChanges = (comparisons: ConfigComparison[]): boolean => {
  return comparisons.some(c =>
    (c.status === 'changed' || c.status === 'new' || c.status === 'removed') && !c.isExpected
  );
};
