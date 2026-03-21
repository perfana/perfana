/**
 * AWR Analysis Configuration
 *
 * Configuration and thresholds for AWR report analysis.
 * All thresholds are adjustable to tune analysis sensitivity.
 *
 * Key configuration categories:
 * - SQL Performance: thresholds for identifying problematic queries
 * - Wait Events: thresholds for wait event analysis
 * - Resource Utilization: thresholds for CPU, memory, I/O
 * - Comparison: thresholds for regression/improvement detection
 * - General: limits and processing options
 */

// ==================== Configuration Types ====================

/**
 * SQL Performance Analysis Thresholds
 */
export interface SqlThresholds {
  /** Minimum percentage of DB time to flag a query (default: 5%) */
  minDbTimePercent: number;
  /** Minimum percentage of DB time for critical severity (default: 20%) */
  criticalDbTimePercent: number;
  /** Minimum percentage of CPU time to consider CPU-bound (default: 70%) */
  cpuBoundPercent: number;
  /** Minimum disk reads per execution for I/O concerns (default: 100) */
  highDiskReadsPerExec: number;
  /** Minimum buffer gets per execution for excessive reads (default: 10000) */
  highBufferGetsPerExec: number;
  /** Minimum buffer gets per row for inefficiency detection (default: 500) */
  highBufferGetsPerRow: number;
  /** Maximum rows per execution before flagging (default: 10) */
  lowRowsPerExecThreshold: number;
  /** Minimum elapsed time per execution in seconds (default: 1) */
  highElapsedTimePerExec: number;
  /** Minimum parse calls to flag excessive parsing (default: 1000) */
  highParseCalls: number;
  /** Minimum version count to flag cursor issues (default: 50) */
  highVersionCount: number;
  /** Maximum number of SQL statements to analyze per category */
  maxStatementsToAnalyze: number;
}

/**
 * Wait Events Analysis Thresholds
 */
export interface WaitEventThresholds {
  /** Minimum percentage of DB time to flag wait event (default: 5%) */
  minDbTimePercent: number;
  /** Minimum percentage of DB time for critical severity (default: 15%) */
  criticalDbTimePercent: number;
  /** Minimum average wait time in ms to flag (default: 50) */
  highAvgWaitTimeMs: number;
  /** Minimum wait percentage for I/O waits (default: 10%) */
  ioWaitThresholdPercent: number;
  /** Minimum wait percentage for lock waits (default: 5%) */
  lockWaitThresholdPercent: number;
  /** Minimum wait percentage for commit waits (default: 10%) */
  commitWaitThresholdPercent: number;
  /** Minimum timeout percentage to flag (default: 10%) */
  timeoutThresholdPercent: number;
  /** Maximum number of wait events to analyze */
  maxEventsToAnalyze: number;
}

/**
 * Resource Utilization Analysis Thresholds
 */
export interface ResourceThresholds {
  /** CPU usage percentage for warning (default: 70%) */
  cpuWarningPercent: number;
  /** CPU usage percentage for critical (default: 90%) */
  cpuCriticalPercent: number;
  /** Memory usage percentage for warning (default: 80%) */
  memoryWarningPercent: number;
  /** Memory usage percentage for critical (default: 95%) */
  memoryCriticalPercent: number;
  /** I/O wait percentage for warning (default: 20%) */
  ioWaitWarningPercent: number;
  /** I/O wait percentage for critical (default: 50%) */
  ioWaitCriticalPercent: number;
  /** Buffer cache hit ratio threshold for warning (default: 90%) */
  bufferCacheWarningPercent: number;
  /** Library cache hit ratio threshold for warning (default: 95%) */
  libraryCacheWarningPercent: number;
  /** Parse ratio threshold for excessive parsing (default: 30%) */
  hardParseRatioWarningPercent: number;
  /** Minimum physical reads per second for I/O concerns */
  highPhysicalReadsPerSecond: number;
  /** Minimum logical reads per second for memory concerns */
  highLogicalReadsPerSecond: number;
}

/**
 * Comparison Analysis Thresholds
 */
export interface ComparisonThresholds {
  /** Minimum percentage change to flag as regression (default: 20%) */
  significantRegressionPercent: number;
  /** Minimum percentage change for critical regression (default: 50%) */
  criticalRegressionPercent: number;
  /** Minimum percentage improvement to flag (default: 20%) */
  significantImprovementPercent: number;
  /** Minimum percentage improvement for notable (default: 50%) */
  notableImprovementPercent: number;
  /** Minimum elapsed time increase in seconds to flag */
  minElapsedTimeIncreaseSeconds: number;
  /** Minimum wait time increase in seconds to flag */
  minWaitTimeIncreaseSeconds: number;
  /** Minimum buffer gets increase to flag */
  minBufferGetsIncrease: number;
  /** Minimum DB time percentage for comparing SQL */
  minSqlDbTimePercentForComparison: number;
}

/**
 * Severity Determination Thresholds
 */
export interface SeverityThresholds {
  /** DB time percentage for critical severity (default: 20%) */
  criticalDbTimePercent: number;
  /** DB time percentage for warning severity (default: 5%) */
  warningDbTimePercent: number;
  /** Impact score for critical severity (default: 50) */
  criticalImpactScore: number;
  /** Impact score for warning severity (default: 20) */
  warningImpactScore: number;
}

/**
 * General Analysis Settings
 */
export interface GeneralSettings {
  /** Maximum total insights to return (default: 100) */
  maxTotalInsights: number;
  /** Include info-level insights by default */
  includeInfoInsights: boolean;
  /** Analysis timeout in milliseconds (default: 30000) */
  analysisTimeoutMs: number;
  /** Enable detailed debug logging */
  debugMode: boolean;
  /** Analysis algorithm version */
  analysisVersion: string;
}

/**
 * Complete AWR Analysis Configuration
 */
export interface AwrAnalysisConfig {
  /** All threshold configurations */
  thresholds: {
    sql: SqlThresholds;
    waitEvents: WaitEventThresholds;
    resources: ResourceThresholds;
    comparison: ComparisonThresholds;
    severity: SeverityThresholds;
  };
  /** General settings */
  settings: GeneralSettings;
}

// ==================== Default Configuration ====================

/**
 * Default SQL performance thresholds
 */
export const DEFAULT_SQL_THRESHOLDS: SqlThresholds = {
  minDbTimePercent: 5,
  criticalDbTimePercent: 20,
  cpuBoundPercent: 70,
  highDiskReadsPerExec: 100,
  highBufferGetsPerExec: 10000,
  highBufferGetsPerRow: 500,
  lowRowsPerExecThreshold: 10,
  highElapsedTimePerExec: 1,
  highParseCalls: 1000,
  highVersionCount: 50,
  maxStatementsToAnalyze: 50,
};

/**
 * Default wait event thresholds
 */
export const DEFAULT_WAIT_EVENT_THRESHOLDS: WaitEventThresholds = {
  minDbTimePercent: 5,
  criticalDbTimePercent: 15,
  highAvgWaitTimeMs: 50,
  ioWaitThresholdPercent: 10,
  lockWaitThresholdPercent: 5,
  commitWaitThresholdPercent: 10,
  timeoutThresholdPercent: 10,
  maxEventsToAnalyze: 30,
};

/**
 * Default resource utilization thresholds
 */
export const DEFAULT_RESOURCE_THRESHOLDS: ResourceThresholds = {
  cpuWarningPercent: 70,
  cpuCriticalPercent: 90,
  memoryWarningPercent: 80,
  memoryCriticalPercent: 95,
  ioWaitWarningPercent: 20,
  ioWaitCriticalPercent: 50,
  bufferCacheWarningPercent: 90,
  libraryCacheWarningPercent: 95,
  hardParseRatioWarningPercent: 30,
  highPhysicalReadsPerSecond: 1000,
  highLogicalReadsPerSecond: 100000,
};

/**
 * Default comparison thresholds
 */
export const DEFAULT_COMPARISON_THRESHOLDS: ComparisonThresholds = {
  significantRegressionPercent: 20,
  criticalRegressionPercent: 50,
  significantImprovementPercent: 20,
  notableImprovementPercent: 50,
  minElapsedTimeIncreaseSeconds: 10,
  minWaitTimeIncreaseSeconds: 5,
  minBufferGetsIncrease: 50000,
  minSqlDbTimePercentForComparison: 1,
};

/**
 * Default severity thresholds
 */
export const DEFAULT_SEVERITY_THRESHOLDS: SeverityThresholds = {
  criticalDbTimePercent: 20,
  warningDbTimePercent: 5,
  criticalImpactScore: 50,
  warningImpactScore: 20,
};

/**
 * Default general settings
 */
export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  maxTotalInsights: 100,
  includeInfoInsights: true,
  analysisTimeoutMs: 30000,
  debugMode: false,
  analysisVersion: '1.0.0',
};

/**
 * Complete default configuration
 */
export const DEFAULT_AWR_ANALYSIS_CONFIG: AwrAnalysisConfig = {
  thresholds: {
    sql: DEFAULT_SQL_THRESHOLDS,
    waitEvents: DEFAULT_WAIT_EVENT_THRESHOLDS,
    resources: DEFAULT_RESOURCE_THRESHOLDS,
    comparison: DEFAULT_COMPARISON_THRESHOLDS,
    severity: DEFAULT_SEVERITY_THRESHOLDS,
  },
  settings: DEFAULT_GENERAL_SETTINGS,
};

// ==================== Configuration Factory ====================

/**
 * Create a custom AWR analysis configuration
 *
 * Merges provided overrides with default configuration.
 *
 * @param overrides - Partial configuration to override defaults
 * @returns Complete configuration with defaults filled in
 *
 * @example
 * const config = createAwrAnalysisConfig({
 *   thresholds: {
 *     sql: { minDbTimePercent: 10 }
 *   }
 * });
 */
export function createAwrAnalysisConfig(
  overrides?: DeepPartial<AwrAnalysisConfig>
): AwrAnalysisConfig {
  if (!overrides) {
    return { ...DEFAULT_AWR_ANALYSIS_CONFIG };
  }

  return {
    thresholds: {
      sql: {
        ...DEFAULT_SQL_THRESHOLDS,
        ...overrides.thresholds?.sql,
      },
      waitEvents: {
        ...DEFAULT_WAIT_EVENT_THRESHOLDS,
        ...overrides.thresholds?.waitEvents,
      },
      resources: {
        ...DEFAULT_RESOURCE_THRESHOLDS,
        ...overrides.thresholds?.resources,
      },
      comparison: {
        ...DEFAULT_COMPARISON_THRESHOLDS,
        ...overrides.thresholds?.comparison,
      },
      severity: {
        ...DEFAULT_SEVERITY_THRESHOLDS,
        ...overrides.thresholds?.severity,
      },
    },
    settings: {
      ...DEFAULT_GENERAL_SETTINGS,
      ...overrides.settings,
    },
  };
}

/**
 * Create a strict configuration for detecting more issues
 *
 * Lowers thresholds to catch more potential problems.
 * Useful for thorough performance audits.
 *
 * @returns Strict analysis configuration
 */
export function createStrictConfig(): AwrAnalysisConfig {
  return createAwrAnalysisConfig({
    thresholds: {
      sql: {
        minDbTimePercent: 2,
        criticalDbTimePercent: 10,
        highDiskReadsPerExec: 50,
        highBufferGetsPerExec: 5000,
        highElapsedTimePerExec: 0.5,
      },
      waitEvents: {
        minDbTimePercent: 2,
        criticalDbTimePercent: 10,
        highAvgWaitTimeMs: 20,
      },
      comparison: {
        significantRegressionPercent: 10,
        criticalRegressionPercent: 30,
      },
    },
  });
}

/**
 * Create a relaxed configuration for fewer alerts
 *
 * Raises thresholds to only catch significant issues.
 * Useful for high-volume production systems.
 *
 * @returns Relaxed analysis configuration
 */
export function createRelaxedConfig(): AwrAnalysisConfig {
  return createAwrAnalysisConfig({
    thresholds: {
      sql: {
        minDbTimePercent: 10,
        criticalDbTimePercent: 30,
        highDiskReadsPerExec: 200,
        highBufferGetsPerExec: 20000,
        highElapsedTimePerExec: 2,
      },
      waitEvents: {
        minDbTimePercent: 10,
        criticalDbTimePercent: 25,
        highAvgWaitTimeMs: 100,
      },
      comparison: {
        significantRegressionPercent: 30,
        criticalRegressionPercent: 75,
      },
    },
    settings: {
      includeInfoInsights: false,
    },
  });
}

// ==================== Wait Class Configuration ====================

/**
 * Wait class categories for grouping wait events
 */
export const WAIT_CLASS_CATEGORIES = {
  IO: ['User I/O', 'System I/O'],
  LOCK: ['Concurrency', 'Application', 'Cluster'],
  COMMIT: ['Commit'],
  NETWORK: ['Network'],
  CPU: ['CPU'],
  IDLE: ['Idle'],
  OTHER: ['Other', 'Configuration', 'Scheduler', 'Administrative'],
} as const;

/**
 * Wait events known to indicate specific issues
 */
export const KNOWN_PROBLEMATIC_WAIT_EVENTS = {
  /** I/O related wait events */
  io: [
    'db file sequential read',
    'db file scattered read',
    'direct path read',
    'direct path write',
    'log file sync',
    'log file parallel write',
    'db file parallel read',
  ],
  /** Lock/contention related wait events */
  lock: [
    'enq: TX - row lock contention',
    'enq: TM - contention',
    'enq: HW - contention',
    'library cache lock',
    'library cache pin',
    'row cache lock',
    'latch: shared pool',
    'latch: library cache',
    'latch: cache buffers chains',
    'buffer busy waits',
  ],
  /** Commit related wait events */
  commit: [
    'log file sync',
    'log file parallel write',
    'log buffer space',
  ],
  /** Network related wait events */
  network: [
    'SQL*Net message from client',
    'SQL*Net message to client',
    'SQL*Net more data from client',
    'SQL*Net more data to client',
  ],
  /** Memory related wait events */
  memory: [
    'latch: shared pool',
    'latch: library cache',
    'latch: cache buffers chains',
    'free buffer waits',
    'write complete waits',
  ],
} as const;

// ==================== Utility Types ====================

/**
 * Deep partial type for nested optional properties
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Configuration preset names
 */
export type ConfigPreset = 'default' | 'strict' | 'relaxed';

/**
 * Get configuration by preset name
 *
 * @param preset - Configuration preset name
 * @returns Corresponding configuration
 */
export function getConfigByPreset(preset: ConfigPreset): AwrAnalysisConfig {
  switch (preset) {
    case 'strict':
      return createStrictConfig();
    case 'relaxed':
      return createRelaxedConfig();
    case 'default':
    default:
      return createAwrAnalysisConfig();
  }
}
