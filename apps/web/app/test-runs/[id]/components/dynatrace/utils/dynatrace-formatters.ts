import { TestRun } from '@/types/test-runs';
import { DynatraceConfig, DynatraceEntity, RelatedTestRun } from '../types';
import { METRIC_TYPE_MAP } from './dynatrace-config';

/**
 * Create Dynatrace time filter from test run start/end times
 */
export function createTimeFilter(testRun: TestRun): string {
  if (!testRun.start_time || !testRun.end_time) {
    return 'gtf=-2h';
  }

  const startTime = new Date(testRun.start_time).getTime();
  const endTime = new Date(testRun.end_time).getTime();

  return `gtf=c_${startTime}_${endTime}`;
}

/**
 * Convert classic Dynatrace URL to modern platform URL
 */
export function createPlatformUrl(baseUrl: string): string {
  const hostname = baseUrl
    .replace('https://', '')
    .replace('.live.dynatrace.com', '')
    .replace('.dynatrace.com', '');
  return `https://${hostname}.apps.dynatrace.com`;
}

/**
 * Build service filter parameter for Dynatrace URLs
 */
export function buildServiceFilterParam(
  config: DynatraceConfig,
  testRunId: string,
  selectedMetric: string | null,
  minDuration: string,
  maxDuration: string,
  format: 'classic' | 'ui' = 'classic'
): string {
  if (!config.perfanaTestRunIdAttribute) {
    return '';
  }

  if (format === 'ui') {
    // Managed /ui/services/* routes (mda, purepaths) use the newer filter
    // encoding: bare 15%11<attr>%14<value> blocks joined by %10, values plain
    // URI-encoded (no %5C0 slash escaping, no trailing empty %14 fields),
    // request-name filter before test-run id.
    const blocks: string[] = [];
    if (selectedMetric && selectedMetric !== 'all' && config.perfanaRequestNameAttribute) {
      blocks.push(`15%11${config.perfanaRequestNameAttribute}%14${encodeURIComponent(selectedMetric)}`);
    }
    blocks.push(`15%11${config.perfanaTestRunIdAttribute}%14${encodeURIComponent(testRunId)}`);
    if (minDuration && maxDuration) {
      blocks.push(`0%11${minDuration}000%14${maxDuration}000`);
    } else if (minDuration) {
      blocks.push(`0%11${minDuration}000%144611686018427387`);
    } else if (maxDuration) {
      blocks.push(`0%110%14${maxDuration}000`);
    }
    return `0%1E${blocks.join('%10')}`;
  }

  const urlEncodedTestRunId = testRunId.replace(/\//g, '%5C0');
  let serviceFilterParam = `0%1E15%11${config.perfanaTestRunIdAttribute}%14${urlEncodedTestRunId}%140%14%14%14%14`;

  // Add request name filter if selectedMetric is specified
  if (selectedMetric && selectedMetric !== 'all' && config.perfanaRequestNameAttribute) {
    const encodedRequestName = selectedMetric.replace(/\//g, '%5C0').replace(/\|/g, '%7C');
    serviceFilterParam += `%1015%11${config.perfanaRequestNameAttribute}%14${encodedRequestName}%140%14%14%14%14`;
  }

  // Add duration filter
  if (minDuration && maxDuration) {
    serviceFilterParam += `%100%11${minDuration}000%14${maxDuration}000`;
  } else if (minDuration) {
    serviceFilterParam += `%100%11${minDuration}000%144611686018427387`;
  } else if (maxDuration) {
    serviceFilterParam += `%100%110%14${maxDuration}000`;
  }

  return serviceFilterParam;
}

/**
 * Build deep link URL for various analysis types
 */
export function buildDeepLinkUrl(
  linkType: string,
  entity: DynatraceEntity,
  config: DynatraceConfig,
  testRun: TestRun,
  serviceFilterParam: string
): string {
  const baseUrl = config.host.replace(/\/$/, '');
  const platformBaseUrl = createPlatformUrl(baseUrl);
  const entityId = entity.entityId;
  const isSaaS = config.dynatraceType === 'saas';
  const timeFilter = createTimeFilter(testRun);

  const startMs = testRun.start_time ? new Date(testRun.start_time).getTime() : '';
  const endMs = testRun.end_time ? new Date(testRun.end_time).getTime() : '';
  const filterParam = serviceFilterParam ? serviceFilterParam.substring(1) : '';

  switch (linkType) {
    case 'response-time-hotspots':
      return `${baseUrl}/#responsetimeanalysis;sci=${entityId};timeframe=custom${startMs}to${endMs};${filterParam};gf=all`;
    case 'pure-paths':
      return isSaaS
        ? `${platformBaseUrl}/ui/apps/dynatrace.classic.distributed.traces/ui/services/${entityId}/purepaths?${filterParam}&${timeFilter}&gf=all`
        : `${baseUrl}/ui/services/${entityId}/purepaths?${filterParam}&${timeFilter}&gf=all`;
    case 'outliers':
      return `${baseUrl}/#responsetimedistribution;sci=${entityId};timeframe=custom${startMs}to${endMs};${filterParam};gf=all`;
    case 'method-hotspots':
      return `${baseUrl}/#methodhotspots;entityId=${entityId};timeframe=custom${startMs}to${endMs};${filterParam};gf=all`;
    case 'top-web-requests':
      return isSaaS
        ? `${platformBaseUrl}/ui/apps/dynatrace.classic.mda/ui/services/${entityId}/mda?mdaId=topweb&${filterParam}&${timeFilter}&gf=all`
        : `${baseUrl}/ui/services/${entityId}/mda?mdaId=topweb&${filterParam}&${timeFilter}&gf=all&metric=REQUEST_COUNT&dimension=%7BRequest:Name%7D&mergeServices=false&aggregation=COUNT&percentile=80&chart=COLUMN`;
    case 'exception-analysis':
      return `${baseUrl}/#exceptionsoverview;entityId=${entityId};timeframe=custom${startMs}to${endMs};${filterParam};gf=all`;
    case 'service-flow':
      return isSaaS
        ? `${platformBaseUrl}/ui/apps/dynatrace.classic.services/#serviceflow;sci=${entityId};timeframe=custom${startMs}to${endMs};gf=all;mode=RESPONSE_TIME;${timeFilter};${filterParam}`
        : `${baseUrl}/#serviceflow;sci=${entityId};timeframe=custom${startMs}to${endMs};${filterParam};gf=all;mode=RESPONSE_TIME`;
    default:
      return '';
  }
}

/**
 * Build multidimensional analysis URL
 */
export function buildMDAUrl(
  analysisType: string,
  entity: DynatraceEntity,
  config: DynatraceConfig,
  testRun: TestRun,
  serviceFilterParam: string
): string {
  const metric = METRIC_TYPE_MAP[analysisType];
  if (!metric) return '';

  const baseUrl = config.host.replace(/\/$/, '');
  const platformBaseUrl = createPlatformUrl(baseUrl);
  const entityId = entity.entityId;
  const isSaaS = config.dynatraceType === 'saas';
  const timeFilter = createTimeFilter(testRun);

  // Managed clusters: scope MDA to the service via the /ui/services/<id>/mda
  // path (like Top Web Requests) — /ui/diagnostictools/mda has no service
  // context. Request-attribute filtering rides in servicefilter (same encoding
  // as the classic #hash links); the dimension must NOT reference the attribute
  // — config stores the attribute UUID, and {RequestAttribute:...} only accepts
  // the attribute name.
  return isSaaS
    ? `${platformBaseUrl}/ui/apps/dynatrace.classic.mda/ui/services/${entityId}/mda?metric=${metric}&mergeServices=false&aggregation=P95&percentile=95&chart=LINE${serviceFilterParam ? `&servicefilter=${serviceFilterParam}` : ''}&gf=all&${timeFilter}`
    : `${baseUrl}/ui/services/${entityId}/mda?gf=all&${timeFilter}&metric=${metric}&dimension=%7BRequest:Name%7D&mergeServices=false&aggregation=AVERAGE&percentile=80&chart=LINE${serviceFilterParam ? `&servicefilter=${serviceFilterParam}` : ''}`;
}

/**
 * Build comparison URL for two test runs
 */
export function buildComparisonUrl(
  entityId: string,
  config: DynatraceConfig,
  testRun: TestRun,
  comparisonTestRun: RelatedTestRun,
  selectedMetric: string | null,
  minDuration: string,
  maxDuration: string
): string {
  const baseUrl = config.host?.replace(/\/$/, '');
  if (!baseUrl || !testRun.start_time || !testRun.end_time) return '';

  const currentStartMs = new Date(testRun.start_time).getTime();
  const currentEndMs = new Date(testRun.end_time).getTime();

  const comparisonStartMs = comparisonTestRun.start_time
    ? new Date(comparisonTestRun.start_time).getTime()
    : new Date(comparisonTestRun.created_at).getTime();

  let serviceFilterParam = '';

  if (selectedMetric && selectedMetric !== 'all' && config.perfanaRequestNameAttribute) {
    const encodedRequestName = selectedMetric.replace(/\//g, '%5C0').replace(/\|/g, '%7C');
    serviceFilterParam = `0%1E15%11${config.perfanaRequestNameAttribute}%14${encodedRequestName}%140%14%14%14%14`;
  }

  if (minDuration && maxDuration) {
    serviceFilterParam += `%100%11${minDuration}000%14${maxDuration}000`;
  } else if (minDuration) {
    serviceFilterParam += `%100%11${minDuration}000%144611686018427387`;
  } else if (maxDuration) {
    serviceFilterParam += `%100%110%14${maxDuration}000`;
  }

  return [
    `${baseUrl}/#serviceComparison`,
    `serviceId=${entityId}`,
    `timeframe=custom${currentStartMs}to${currentEndMs}`,
    serviceFilterParam ? `servicefilter=${serviceFilterParam}` : '',
    `gf=all`,
    `tfshift=CustomTimeframe`,
    `ctfstart=${comparisonStartMs}`,
  ].filter(Boolean).join(';');
}

/**
 * Format test run display text
 */
export function getTestRunDisplayText(testRun: RelatedTestRun): string {
  const startTime = testRun.start_time || testRun.created_at;
  const formattedTime = new Date(startTime).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${testRun.test_run_id} - ${formattedTime}`;
}

/**
 * Format test run secondary info
 */
export function getTestRunSecondaryInfo(testRun: RelatedTestRun): string {
  const parts = [];

  if (testRun.application_release) {
    parts.push(`Version: ${testRun.application_release}`);
  }

  if (testRun.annotations && testRun.annotations.length > 0) {
    parts.push(`Annotations: ${testRun.annotations.join(', ')}`);
  }

  return parts.join(' \u2022 ');
}

/**
 * Derive filter options from metric names
 */
export function deriveFilterOptions(
  metricNames: string[],
  selectedScenario: string | null,
  selectedTransaction: string | null,
  selectedSampler: string | null
): {
  scenarios: string[];
  transactions: string[];
  samplers: string[];
  selectedMetric: string | null;
  isFullFilterSelected: boolean;
} {
  const scenarios = [...new Set(metricNames.map(name => name.split('|')[0]))].sort();

  const transactions = selectedScenario
    ? [...new Set(metricNames
        .filter(name => name.startsWith(`${selectedScenario}|`))
        .map(name => name.split('|')[1])
        .filter(Boolean)
      )].sort()
    : [];

  const samplers = selectedScenario && selectedTransaction
    ? [...new Set(metricNames
        .filter(name => name.startsWith(`${selectedScenario}|${selectedTransaction}|`))
        .map(name => name.split('|')[2])
        .filter(Boolean)
      )].sort()
    : [];

  const selectedMetric = selectedScenario && selectedTransaction && selectedSampler
    ? `${selectedScenario}|${selectedTransaction}|${selectedSampler}`
    : null;

  const isFullFilterSelected = !!(selectedScenario && selectedTransaction && selectedSampler);

  return { scenarios, transactions, samplers, selectedMetric, isFullFilterSelected };
}
