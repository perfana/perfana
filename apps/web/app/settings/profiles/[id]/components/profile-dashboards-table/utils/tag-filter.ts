/**
 * Filters out system tags that should not be displayed to users
 * Excludes tags containing 'perfana' or 'ig' (case-insensitive)
 */
export function filterSystemTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return tags.filter(tag => {
    const lowerTag = tag.toLowerCase();
    return !lowerTag.includes('perfana') && !lowerTag.includes('ig');
  });
}

/**
 * Truncates a display label if it exceeds the maximum length
 * @param label - The label to truncate
 * @param maxLength - Maximum length before truncation (default: 30)
 * @returns The original label or truncated version with ellipsis
 */
export function truncateLabel(label: string, maxLength = 30): string {
  if (label.length <= maxLength) return label;
  return `${label.substring(0, maxLength - 3)}...`;
}
