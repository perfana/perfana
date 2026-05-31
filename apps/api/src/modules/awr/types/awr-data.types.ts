/**
 * AWR Data Types
 *
 * TypeScript type definitions for parsed AWR report data structures.
 * These types represent the structured data extracted from Oracle AWR HTML reports.
 */

// ==================== Header & Metadata Types ====================

/**
 * Database information extracted from AWR report header
 */
export interface DatabaseInfo {
  /** Database name (DB Name) */
  dbName: string;
  /** Database ID (DBID) */
  dbId: string;
  /** Instance name */
  instanceName?: string;
  /** Instance number for RAC environments */
  instanceNumber?: number;
  /** Database edition (Enterprise, Standard, etc.) */
  dbEdition?: string;
  /** Database release/version string */
  dbRelease?: string;
  /** Whether this is a RAC database */
  isRac?: boolean;
  /** Whether this is a Container Database */
  isCdb?: boolean;
  /** Pluggable database name if CDB */
  pdbName?: string;
}

/**
 * Host/platform information from AWR report
 */
export interface HostInfo {
  /** Host name */
  hostName: string;
  /** Operating system platform */
  platform?: string;
  /** Number of CPUs */
  cpus?: number;
  /** Number of cores */
  cores?: number;
  /** Number of CPU sockets */
  sockets?: number;
  /** Total memory in GB */
  memoryGb?: number;
}

/**
 * Snapshot information for the AWR report time range
 */
export interface SnapshotInfo {
  /** Beginning snapshot ID */
  snapIdBegin: number;
  /** Ending snapshot ID */
  snapIdEnd: number;
  /** Beginning snapshot timestamp */
  beginTime: Date;
  /** Ending snapshot timestamp */
  endTime: Date;
  /** Elapsed time in minutes */
  elapsedMinutes: number;
  /** Total DB time in minutes */
  dbTimeMinutes?: number;
  /** Average active sessions */
  averageActiveSessions?: number;
  /** Sessions at begin snapshot */
  sessionsBegin?: number;
  /** Sessions at end snapshot */
  sessionsEnd?: number;
  /** Session count change */
  sessionsDelta?: number;
}

/**
 * Complete AWR report header containing all metadata
 */
export interface AwrReportHeader {
  /** Database information */
  database: DatabaseInfo;
  /** Host information */
  host: HostInfo;
  /** Snapshot range information */
  snapshot: SnapshotInfo;
  /** Report generation timestamp */
  reportGeneratedAt?: Date;
}

// ==================== Load Profile Types ====================

/**
 * Single load profile metric with per-second and per-transaction values
 */
export interface LoadProfileMetric {
  /** Metric name */
  name: string;
  /** Value per second */
  perSecond: number;
  /** Value per transaction */
  perTransaction: number;
  /** Unit of measurement */
  unit?: string;
}

/**
 * Complete load profile section from AWR report
 */
export interface LoadProfile {
  /** DB Time per second */
  dbTimePerSecond?: number;
  /** DB CPU per second */
  dbCpuPerSecond?: number;
  /** Background CPU per second */
  backgroundCpuPerSecond?: number;
  /** Redo size per second (bytes) */
  redoSizePerSecond?: number;
  /** Logical reads per second */
  logicalReadsPerSecond?: number;
  /** Block changes per second */
  blockChangesPerSecond?: number;
  /** Physical reads per second */
  physicalReadsPerSecond?: number;
  /** Physical writes per second */
  physicalWritesPerSecond?: number;
  /** User calls per second */
  userCallsPerSecond?: number;
  /** Parses per second */
  parsesPerSecond?: number;
  /** Hard parses per second */
  hardParsesPerSecond?: number;
  /** W/A MB processed per second */
  waMbProcessedPerSecond?: number;
  /** Logons per second */
  logonsPerSecond?: number;
  /** Executes per second */
  executesPerSecond?: number;
  /** Rollbacks per second */
  rollbacksPerSecond?: number;
  /** Transactions per second */
  transactionsPerSecond?: number;
  /** All metrics as array for iteration */
  metrics?: LoadProfileMetric[];
}

// ==================== Time Model Types ====================

/**
 * Single time model statistic
 */
/** @public */
export interface TimeModelStat {
  /** Statistic name */
  name: string;
  /** Time in seconds */
  timeSeconds: number;
  /** Percentage of DB time */
  percentDbTime?: number;
  /** Percentage of elapsed time */
  percentElapsed?: number;
}

/**
 * Time model breakdown from AWR report
 */
/** @public */
export interface TimeModel {
  /** Total DB time in seconds */
  dbTime: number;
  /** DB CPU time in seconds */
  dbCpu?: number;
  /** SQL execute elapsed time */
  sqlExecuteElapsedTime?: number;
  /** Parse time elapsed */
  parseTimeElapsed?: number;
  /** Hard parse elapsed time */
  hardParseElapsedTime?: number;
  /** PL/SQL execution time */
  plsqlExecutionTime?: number;
  /** Java execution time */
  javaExecutionTime?: number;
  /** Connection management call elapsed time */
  connectionMgmtTime?: number;
  /** Sequence load elapsed time */
  sequenceLoadTime?: number;
  /** Background elapsed time */
  backgroundTime?: number;
  /** Background CPU time */
  backgroundCpuTime?: number;
  /** All statistics as array */
  statistics?: TimeModelStat[];
}

// ==================== SQL Statement Types ====================

/**
 * Individual SQL statement from Top SQL section
 */
export interface SqlStatement {
  /** SQL ID (unique identifier) */
  sqlId: string;
  /** SQL text (may be truncated) */
  sqlText?: string;
  /** Full SQL text if available */
  fullSqlText?: string;
  /** Plan hash value */
  planHashValue?: number;
  /** Module name (application) */
  module?: string;
  /** Parsing schema name */
  parsingSchemaName?: string;
  /** Execution statistics */
  executions?: number;
  /** Elapsed time in seconds */
  elapsedTime?: number;
  /** Elapsed time per execution */
  elapsedTimePerExec?: number;
  /** CPU time in seconds */
  cpuTime?: number;
  /** CPU time per execution */
  cpuTimePerExec?: number;
  /** Buffer gets (logical reads) */
  bufferGets?: number;
  /** Buffer gets per execution */
  bufferGetsPerExec?: number;
  /** Disk reads (physical reads) */
  diskReads?: number;
  /** Disk reads per execution */
  diskReadsPerExec?: number;
  /** I/O wait time in seconds */
  ioWaitTime?: number;
  /** Cluster wait time in seconds */
  clusterWaitTime?: number;
  /** Application wait time in seconds */
  applicationWaitTime?: number;
  /** Concurrency wait time in seconds */
  concurrencyWaitTime?: number;
  /** User I/O wait time */
  userIoWaitTime?: number;
  /** Rows processed */
  rowsProcessed?: number;
  /** Rows processed per execution */
  rowsProcessedPerExec?: number;
  /** Percentage of total DB time */
  percentDbTime?: number;
  /** Percentage of total CPU */
  percentCpu?: number;
  /** Percentage of total I/O */
  percentIo?: number;
  /** Sort ranking by elapsed time */
  rankByElapsedTime?: number;
  /** Sort ranking by CPU time */
  rankByCpuTime?: number;
  /** Sort ranking by buffer gets */
  rankByBufferGets?: number;
  /** Sort ranking by disk reads */
  rankByDiskReads?: number;
}

/**
 * Top SQL section containing sorted SQL statements
 */
export interface TopSql {
  /** SQL ordered by elapsed time */
  byElapsedTime?: SqlStatement[];
  /** SQL ordered by CPU time */
  byCpuTime?: SqlStatement[];
  /** SQL ordered by buffer gets */
  byBufferGets?: SqlStatement[];
  /** SQL ordered by disk reads */
  byDiskReads?: SqlStatement[];
  /** SQL ordered by executions */
  byExecutions?: SqlStatement[];
  /** SQL ordered by parse calls */
  byParseCalls?: SqlStatement[];
  /** SQL ordered by version count */
  byVersionCount?: SqlStatement[];
  /** SQL ordered by cluster wait */
  byClusterWait?: SqlStatement[];
  /** SQL text lookup map */
  sqlTextById?: Record<string, string>;
}

// ==================== Wait Events Types ====================

/**
 * Single wait event statistic
 */
export interface WaitEvent {
  /** Wait event name */
  event: string;
  /** Wait class (User I/O, System I/O, etc.) */
  waitClass?: string;
  /** Total number of waits */
  waits: number;
  /** Timeouts count */
  timeouts?: number;
  /** Total time waited in seconds */
  totalWaitTime: number;
  /** Average wait time in milliseconds */
  avgWaitMs?: number;
  /** Percentage of total wait time */
  percentWaitTime?: number;
  /** Percentage of DB time */
  percentDbTime?: number;
  /** Waits per second */
  waitsPerSecond?: number;
}

/**
 * Wait events section grouped by wait class
 */
export interface WaitEvents {
  /** Top foreground wait events */
  foreground?: WaitEvent[];
  /** Background wait events */
  background?: WaitEvent[];
  /** Wait events by class */
  byClass?: Record<string, WaitEvent[]>;
  /** Total wait time for all events */
  totalWaitTime?: number;
  /** Top wait events across all categories */
  topEvents?: WaitEvent[];
}

// ==================== Operating System Statistics ====================

/**
 * Operating system statistics from AWR report
 */
export interface OsStatistics {
  /** CPU user time percentage */
  cpuUserPercent?: number;
  /** CPU system time percentage */
  cpuSystemPercent?: number;
  /** CPU idle percentage */
  cpuIdlePercent?: number;
  /** CPU wait I/O percentage */
  cpuWaitIoPercent?: number;
  /** Memory free in MB */
  memoryFreeMb?: number;
  /** Memory used in MB */
  memoryUsedMb?: number;
  /** Swap free in MB */
  swapFreeMb?: number;
  /** Swap used in MB */
  swapUsedMb?: number;
  /** Load average 1 minute */
  loadAvg1Min?: number;
  /** Load average 5 minutes */
  loadAvg5Min?: number;
  /** Load average 15 minutes */
  loadAvg15Min?: number;
  /** Physical read bytes per second */
  physicalReadBytesPerSecond?: number;
  /** Physical write bytes per second */
  physicalWriteBytesPerSecond?: number;
}

// ==================== I/O Statistics Types ====================

/**
 * I/O statistics for a single tablespace or file
 */
/** @public */
export interface IoStatistic {
  /** Tablespace or file name */
  name: string;
  /** Object type (tablespace, datafile, tempfile) */
  type?: 'tablespace' | 'datafile' | 'tempfile';
  /** Number of reads */
  reads?: number;
  /** Average read time in ms */
  avgReadTimeMs?: number;
  /** Number of writes */
  writes?: number;
  /** Average write time in ms */
  avgWriteTimeMs?: number;
  /** Read MB per second */
  readMbPerSecond?: number;
  /** Write MB per second */
  writeMbPerSecond?: number;
  /** Read requests per second */
  readsPerSecond?: number;
  /** Write requests per second */
  writesPerSecond?: number;
  /** Buffer busy waits */
  bufferBusyWaits?: number;
}

/**
 * I/O statistics section from AWR report
 */
export interface IoStatistics {
  /** I/O by tablespace */
  byTablespace?: IoStatistic[];
  /** I/O by file */
  byFile?: IoStatistic[];
  /** Total physical reads */
  totalPhysicalReads?: number;
  /** Total physical writes */
  totalPhysicalWrites?: number;
  /** Total read MB per second */
  totalReadMbPerSecond?: number;
  /** Total write MB per second */
  totalWriteMbPerSecond?: number;
}

// ==================== Memory Statistics Types ====================

/**
 * SGA memory component
 */
/** @public */
export interface SgaComponent {
  /** Component name */
  name: string;
  /** Begin size in MB */
  beginSizeMb?: number;
  /** End size in MB */
  endSizeMb?: number;
  /** Size change in MB */
  changeMb?: number;
}

/**
 * PGA statistics
 */
/** @public */
export interface PgaStatistics {
  /** Aggregate PGA target in MB */
  aggregatePgaTargetMb?: number;
  /** Aggregate PGA auto target in MB */
  aggregatePgaAutoTargetMb?: number;
  /** Global memory bound in KB */
  globalMemoryBoundKb?: number;
  /** Total PGA allocated in MB */
  totalPgaAllocatedMb?: number;
  /** Total PGA used for auto workarea in MB */
  totalPgaUsedAutoWorkareaMb?: number;
  /** Maximum PGA allocated in MB */
  maximumPgaAllocatedMb?: number;
  /** Cache hit percentage */
  cacheHitPercent?: number;
}

/**
 * Memory statistics section from AWR report
 */
export interface MemoryStatistics {
  /** SGA components */
  sga?: SgaComponent[];
  /** Total SGA size in MB */
  totalSgaMb?: number;
  /** PGA statistics */
  pga?: PgaStatistics;
  /** Buffer cache hit ratio */
  bufferCacheHitRatio?: number;
  /** Library cache hit ratio */
  libraryCacheHitRatio?: number;
  /** Dictionary cache hit ratio */
  dictionaryCacheHitRatio?: number;
}

// ==================== Segment Statistics Types ====================

/**
 * Single segment statistic entry
 */
export interface SegmentStatistic {
  /** Schema/owner name */
  owner: string;
  /** Tablespace name */
  tablespaceName?: string;
  /** Object name (table, index, etc.) */
  objectName: string;
  /** Subobject name (partition name if applicable) */
  subobjectName?: string;
  /** Object type (TABLE, INDEX, etc.) */
  objectType: string;
  /** Object ID */
  objectId?: number;
  /** Data object ID */
  dataObjectId?: number;
  /** Pluggable database name */
  pdbName?: string;
  /** Statistic value (varies by section) */
  value: number;
  /** Percentage of total */
  percentTotal?: number;
}

/**
 * Segment statistics section from AWR report
 * Contains various segment-level performance metrics
 */
export interface SegmentStatistics {
  /** Segments ordered by logical reads */
  byLogicalReads?: SegmentStatistic[];
  /** Segments ordered by physical reads */
  byPhysicalReads?: SegmentStatistic[];
  /** Segments ordered by physical read requests */
  byPhysicalReadRequests?: SegmentStatistic[];
  /** Segments ordered by table scans (FTS) */
  byTableScans?: SegmentStatistic[];
  /** Segments ordered by row lock waits */
  byRowLockWaits?: SegmentStatistic[];
  /** Segments ordered by buffer busy waits */
  byBufferBusyWaits?: SegmentStatistic[];
  /** Total logical reads across all segments */
  totalLogicalReads?: number;
  /** Total physical reads across all segments */
  totalPhysicalReads?: number;
  /** Total table scans */
  totalTableScans?: number;
}

// ==================== Instance Configuration Types ====================

/**
 * Database instance configuration parameter
 */
/** @public */
export interface ConfigParameter {
  /** Parameter name */
  name: string;
  /** Begin value */
  beginValue?: string;
  /** End value */
  endValue?: string;
  /** Whether parameter was changed */
  changed?: boolean;
  /** Whether parameter is modifiable at system level */
  isSystemModifiable?: boolean;
}

/**
 * Instance configuration section
 */
/** @public */
export interface InstanceConfig {
  /** Configuration parameters */
  parameters?: ConfigParameter[];
  /** SGA parameters */
  sgaParameters?: ConfigParameter[];
  /** PGA parameters */
  pgaParameters?: ConfigParameter[];
}

// ==================== Complete Parsed AWR Data ====================

/**
 * Complete parsed AWR data structure
 * Contains all sections extracted from an AWR report
 */
export interface ParsedAwrData {
  /** Report header with metadata */
  header?: AwrReportHeader;
  /** Load profile metrics */
  loadProfile?: LoadProfile;
  /** Time model breakdown */
  timeModel?: TimeModel;
  /** Top SQL statements */
  topSql?: TopSql;
  /** Wait events */
  waitEvents?: WaitEvents;
  /** Segment statistics */
  segmentStatistics?: SegmentStatistics;
  /** Operating system statistics */
  osStatistics?: OsStatistics;
  /** I/O statistics */
  ioStatistics?: IoStatistics;
  /** Memory statistics */
  memoryStatistics?: MemoryStatistics;
  /** Instance configuration */
  instanceConfig?: InstanceConfig;
  /** ASH SQL analysis (Top SQL with Events and Row Sources) */
  ashSql?: import('../parsers/sections/ash-sql-parser').ParsedAshSqlData;
  /** Map of SQL ID to full SQL text from "Complete List of SQL Text" section */
  sqlTextMap?: import('../parsers/sections/sql-text-parser').SqlTextMap;
  /** Parser version used */
  parserVersion?: string;
  /** Sections that failed to parse */
  parseErrors?: ParseError[];
  /** Raw section HTML for debugging (excluded in production) */
  rawSections?: Record<string, string>;
}

/**
 * Parse error for a specific section
 */
export interface ParseError {
  /** Section name that failed */
  section: string;
  /** Error message */
  message: string;
  /** Whether parsing should continue */
  recoverable: boolean;
}

// ==================== Parser Result Types ====================

/**
 * Result from parsing an AWR report
 */
export interface AwrParseResult {
  /** Whether parsing was successful (may have partial success) */
  success: boolean;
  /** Parsed data */
  data?: ParsedAwrData;
  /** Errors encountered during parsing */
  errors?: ParseError[];
  /** Parse duration in milliseconds */
  parseTimeMs?: number;
  /** Sections successfully parsed */
  sectionsCompleted?: string[];
  /** Sections that failed to parse */
  sectionsFailed?: string[];
}
