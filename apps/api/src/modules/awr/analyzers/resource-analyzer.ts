/**
 * Resource Utilization Analyzer for AWR Reports
 *
 * Analyzes resource usage patterns from AWR reports to identify issues:
 * - CPU utilization: High CPU usage, DB CPU vs background CPU
 * - Memory usage: Buffer cache efficiency, library cache efficiency, PGA usage
 * - I/O patterns: High physical reads/writes, tablespace I/O bottlenecks
 * - Parse ratios: Hard parse ratio, soft parse ratio
 * - System resource saturation: Load averages, memory pressure
 *
 * @example
 * const analyzer = new ResourceUtilizationAnalyzer(config);
 * const insights = analyzer.analyze(parsedAwrData);
 */

import type {
  ParsedAwrData,
  LoadProfile,
  MemoryStatistics,
  IoStatistics,
  OsStatistics,
} from '../types/awr-data.types';
import type { AwrInsight, InsightCategory, InsightSeverity } from '../types/insights.types';
import type { AwrAnalysisConfig, ResourceThresholds } from '../config/awr-analysis.config';
import { BaseAwrAnalyzer, type AnalyzerOptions } from './base-analyzer';

// ==================== Constants ====================

/** Category for resource utilization insights */
const RESOURCE_CATEGORY: InsightCategory = 'resource_utilization';

/** Tags for different resource issue types */
const RESOURCE_TAGS = {
  HIGH_CPU: 'high-cpu',
  HIGH_MEMORY: 'high-memory',
  HIGH_IO: 'high-io',
  BUFFER_CACHE: 'buffer-cache',
  LIBRARY_CACHE: 'library-cache',
  HARD_PARSE: 'hard-parse',
  PGA_MEMORY: 'pga-memory',
  LOAD_AVERAGE: 'load-average',
  IO_BOTTLENECK: 'io-bottleneck',
  MEMORY_PRESSURE: 'memory-pressure',
} as const;

// ==================== Resource Utilization Analyzer ====================

/**
 * Analyzer for resource utilization patterns from AWR reports
 *
 * Identifies resource-related issues by analyzing:
 * - CPU usage (DB CPU, background CPU, OS CPU)
 * - Memory efficiency (buffer cache, library cache, PGA)
 * - I/O throughput and latency
 * - Parse activity and ratios
 * - System load and saturation
 */
export class ResourceUtilizationAnalyzer extends BaseAwrAnalyzer {
  /**
   * Create a new Resource Utilization Analyzer
   *
   * @param config - Analysis configuration with resource thresholds
   * @param options - Optional analyzer behavior settings
   */
  constructor(config: AwrAnalysisConfig, options: AnalyzerOptions = {}) {
    super(config, options);
  }

  /**
   * Get the analyzer name
   *
   * @returns Analyzer name for logging and identification
   */
  getName(): string {
    return 'ResourceUtilizationAnalyzer';
  }

  /**
   * Get the primary insight category
   *
   * @returns Resource utilization category
   */
  getCategory(): InsightCategory {
    return RESOURCE_CATEGORY;
  }

  /**
   * Analyze AWR data for resource utilization issues
   *
   * @param data - Parsed AWR data containing resource metrics
   * @returns Array of resource utilization insights
   */
  analyze(data: ParsedAwrData): AwrInsight[] {
    const insights: AwrInsight[] = [];
    const thresholds = this.config.thresholds.resources;

    // Analyze CPU utilization
    insights.push(...this.analyzeCpuUtilization(data, thresholds));

    // Analyze memory efficiency
    insights.push(...this.analyzeMemoryEfficiency(data, thresholds));

    // Analyze I/O patterns
    insights.push(...this.analyzeIoPatterns(data, thresholds));

    // Analyze parse activity
    insights.push(...this.analyzeParseActivity(data, thresholds));

    // Analyze system load
    insights.push(...this.analyzeSystemLoad(data, thresholds));

    // Sort by impact score descending
    insights.sort((a, b) => (b.impactScore ?? 0) - (a.impactScore ?? 0));

    this.debug(`Generated ${insights.length} resource utilization insights`);
    return insights;
  }

  // ==================== CPU Analysis Methods ====================

  /**
   * Analyze CPU utilization patterns
   *
   * @param data - Parsed AWR data
   * @param thresholds - Resource thresholds
   * @returns CPU-related insights
   */
  private analyzeCpuUtilization(
    data: ParsedAwrData,
    thresholds: ResourceThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];

    // Analyze OS-level CPU from osStatistics
    if (data.osStatistics) {
      insights.push(...this.analyzeOsCpuUsage(data.osStatistics, thresholds));
    }

    // Analyze DB CPU from load profile
    if (data.loadProfile) {
      insights.push(...this.analyzeDbCpuUsage(data.loadProfile, data.header?.host?.cpus));
    }

    // Analyze CPU wait I/O
    if (data.osStatistics?.cpuWaitIoPercent !== undefined) {
      insights.push(...this.analyzeCpuIoWait(data.osStatistics.cpuWaitIoPercent, thresholds));
    }

    return insights;
  }

  /**
   * Analyze OS-level CPU usage
   *
   * @param osStats - Operating system statistics
   * @param thresholds - Resource thresholds
   * @returns OS CPU insights
   */
  private analyzeOsCpuUsage(
    osStats: OsStatistics,
    thresholds: ResourceThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];

    // Calculate total CPU usage (user + system)
    const userPercent = osStats.cpuUserPercent ?? 0;
    const systemPercent = osStats.cpuSystemPercent ?? 0;
    const totalCpuPercent = userPercent + systemPercent;

    if (totalCpuPercent >= thresholds.cpuCriticalPercent) {
      insights.push(this.createCpuInsight(totalCpuPercent, 'critical', userPercent, systemPercent));
    } else if (totalCpuPercent >= thresholds.cpuWarningPercent) {
      insights.push(this.createCpuInsight(totalCpuPercent, 'warning', userPercent, systemPercent));
    }

    return insights;
  }

  /**
   * Analyze database CPU usage from load profile
   *
   * @param loadProfile - Load profile metrics
   * @param cpuCount - Number of CPUs if available
   * @returns DB CPU insights
   */
  private analyzeDbCpuUsage(loadProfile: LoadProfile, cpuCount?: number): AwrInsight[] {
    const insights: AwrInsight[] = [];

    const dbCpuPerSecond = loadProfile.dbCpuPerSecond ?? 0;
    const dbTimePerSecond = loadProfile.dbTimePerSecond ?? 0;

    // If DB CPU is close to DB Time, database is CPU-constrained
    if (dbTimePerSecond > 0) {
      const cpuToDbTimeRatio = (dbCpuPerSecond / dbTimePerSecond) * 100;

      if (cpuToDbTimeRatio >= 80) {
        insights.push(this.createDbCpuConstrainedInsight(
          cpuToDbTimeRatio,
          dbCpuPerSecond,
          dbTimePerSecond,
          cpuCount
        ));
      }
    }

    return insights;
  }

  /**
   * Analyze CPU I/O wait percentage
   *
   * @param ioWaitPercent - CPU I/O wait percentage
   * @param thresholds - Resource thresholds
   * @returns I/O wait insights
   */
  private analyzeCpuIoWait(
    ioWaitPercent: number,
    thresholds: ResourceThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];

    if (ioWaitPercent >= thresholds.ioWaitCriticalPercent) {
      insights.push(this.createIoWaitInsight(ioWaitPercent, 'critical'));
    } else if (ioWaitPercent >= thresholds.ioWaitWarningPercent) {
      insights.push(this.createIoWaitInsight(ioWaitPercent, 'warning'));
    }

    return insights;
  }

  // ==================== Memory Analysis Methods ====================

  /**
   * Analyze memory efficiency patterns
   *
   * @param data - Parsed AWR data
   * @param thresholds - Resource thresholds
   * @returns Memory-related insights
   */
  private analyzeMemoryEfficiency(
    data: ParsedAwrData,
    thresholds: ResourceThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];

    if (data.memoryStatistics) {
      // Analyze buffer cache hit ratio
      insights.push(...this.analyzeBufferCacheHitRatio(data.memoryStatistics, thresholds));

      // Analyze library cache hit ratio
      insights.push(...this.analyzeLibraryCacheHitRatio(data.memoryStatistics, thresholds));

      // Analyze PGA memory usage
      insights.push(...this.analyzePgaMemory(data.memoryStatistics));
    }

    // Analyze OS memory if available
    if (data.osStatistics) {
      insights.push(...this.analyzeOsMemory(data.osStatistics, thresholds));
    }

    return insights;
  }

  /**
   * Analyze buffer cache hit ratio
   *
   * @param memStats - Memory statistics
   * @param thresholds - Resource thresholds
   * @returns Buffer cache insights
   */
  private analyzeBufferCacheHitRatio(
    memStats: MemoryStatistics,
    thresholds: ResourceThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];
    const hitRatio = memStats.bufferCacheHitRatio ?? 100;

    if (hitRatio < thresholds.bufferCacheWarningPercent) {
      const severity: InsightSeverity = hitRatio < 80 ? 'critical' : 'warning';
      insights.push(this.createBufferCacheInsight(hitRatio, severity, thresholds));
    }

    return insights;
  }

  /**
   * Analyze library cache hit ratio
   *
   * @param memStats - Memory statistics
   * @param thresholds - Resource thresholds
   * @returns Library cache insights
   */
  private analyzeLibraryCacheHitRatio(
    memStats: MemoryStatistics,
    thresholds: ResourceThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];
    const hitRatio = memStats.libraryCacheHitRatio ?? 100;

    if (hitRatio < thresholds.libraryCacheWarningPercent) {
      const severity: InsightSeverity = hitRatio < 90 ? 'critical' : 'warning';
      insights.push(this.createLibraryCacheInsight(hitRatio, severity, thresholds));
    }

    return insights;
  }

  /**
   * Analyze PGA memory usage
   *
   * @param memStats - Memory statistics
   * @returns PGA memory insights
   */
  private analyzePgaMemory(memStats: MemoryStatistics): AwrInsight[] {
    const insights: AwrInsight[] = [];
    const pga = memStats.pga;

    if (!pga) {
      return insights;
    }

    // Check if PGA is approaching limits
    if (pga.totalPgaAllocatedMb && pga.aggregatePgaTargetMb) {
      const pgaUsagePercent = (pga.totalPgaAllocatedMb / pga.aggregatePgaTargetMb) * 100;

      if (pgaUsagePercent >= 90) {
        insights.push(this.createPgaMemoryInsight(pgaUsagePercent, pga.totalPgaAllocatedMb, pga.aggregatePgaTargetMb));
      }
    }

    // Check PGA cache hit ratio
    if (pga.cacheHitPercent !== undefined && pga.cacheHitPercent < 90) {
      insights.push(this.createPgaCacheHitInsight(pga.cacheHitPercent));
    }

    return insights;
  }

  /**
   * Analyze OS-level memory usage
   *
   * @param osStats - Operating system statistics
   * @param thresholds - Resource thresholds
   * @returns OS memory insights
   */
  private analyzeOsMemory(
    osStats: OsStatistics,
    thresholds: ResourceThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];

    const memUsed = osStats.memoryUsedMb ?? 0;
    const memFree = osStats.memoryFreeMb ?? 0;
    const totalMem = memUsed + memFree;

    if (totalMem > 0) {
      const memUsagePercent = (memUsed / totalMem) * 100;

      if (memUsagePercent >= thresholds.memoryCriticalPercent) {
        insights.push(this.createOsMemoryInsight(memUsagePercent, 'critical', memUsed, memFree));
      } else if (memUsagePercent >= thresholds.memoryWarningPercent) {
        insights.push(this.createOsMemoryInsight(memUsagePercent, 'warning', memUsed, memFree));
      }
    }

    // Check swap usage
    const swapUsed = osStats.swapUsedMb ?? 0;
    const swapFree = osStats.swapFreeMb ?? 0;
    const totalSwap = swapUsed + swapFree;

    if (totalSwap > 0 && swapUsed > 0) {
      const swapUsagePercent = (swapUsed / totalSwap) * 100;
      if (swapUsagePercent > 10) {
        insights.push(this.createSwapUsageInsight(swapUsagePercent, swapUsed));
      }
    }

    return insights;
  }

  // ==================== I/O Analysis Methods ====================

  /**
   * Analyze I/O patterns
   *
   * @param data - Parsed AWR data
   * @param thresholds - Resource thresholds
   * @returns I/O-related insights
   */
  private analyzeIoPatterns(
    data: ParsedAwrData,
    thresholds: ResourceThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];

    // Analyze load profile I/O metrics
    if (data.loadProfile) {
      insights.push(...this.analyzeLoadProfileIo(data.loadProfile, thresholds));
    }

    // Analyze detailed I/O statistics
    if (data.ioStatistics) {
      insights.push(...this.analyzeIoStatistics(data.ioStatistics));
    }

    return insights;
  }

  /**
   * Analyze I/O metrics from load profile
   *
   * @param loadProfile - Load profile metrics
   * @param thresholds - Resource thresholds
   * @returns Load profile I/O insights
   */
  private analyzeLoadProfileIo(
    loadProfile: LoadProfile,
    thresholds: ResourceThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];

    // Check physical reads per second
    const physReadsPerSec = loadProfile.physicalReadsPerSecond ?? 0;
    if (physReadsPerSec >= thresholds.highPhysicalReadsPerSecond) {
      insights.push(this.createHighPhysicalReadsInsight(physReadsPerSec, thresholds));
    }

    // Check logical reads per second
    const logicalReadsPerSec = loadProfile.logicalReadsPerSecond ?? 0;
    if (logicalReadsPerSec >= thresholds.highLogicalReadsPerSecond) {
      insights.push(this.createHighLogicalReadsInsight(logicalReadsPerSec, thresholds));
    }

    // Analyze physical vs logical read ratio (cache efficiency)
    if (logicalReadsPerSec > 0 && physReadsPerSec > 0) {
      const physToLogicalRatio = (physReadsPerSec / logicalReadsPerSec) * 100;
      if (physToLogicalRatio > 10) {
        insights.push(this.createHighPhysicalToLogicalRatioInsight(physToLogicalRatio, physReadsPerSec, logicalReadsPerSec));
      }
    }

    return insights;
  }

  /**
   * Analyze detailed I/O statistics
   *
   * @param ioStats - I/O statistics
   * @returns Detailed I/O insights
   */
  private analyzeIoStatistics(ioStats: IoStatistics): AwrInsight[] {
    const insights: AwrInsight[] = [];

    // Find tablespaces with high I/O latency
    if (ioStats.byTablespace) {
      for (const ts of ioStats.byTablespace) {
        // Check for high average read time (> 10ms typically indicates issues)
        if (ts.avgReadTimeMs !== undefined && ts.avgReadTimeMs > 10) {
          insights.push(this.createTablespaceIoLatencyInsight(ts.name, ts.avgReadTimeMs, 'read'));
        }
        // Check for high average write time
        if (ts.avgWriteTimeMs !== undefined && ts.avgWriteTimeMs > 10) {
          insights.push(this.createTablespaceIoLatencyInsight(ts.name, ts.avgWriteTimeMs, 'write'));
        }
      }
    }

    return insights;
  }

  // ==================== Parse Analysis Methods ====================

  /**
   * Analyze parse activity patterns
   *
   * @param data - Parsed AWR data
   * @param thresholds - Resource thresholds
   * @returns Parse-related insights
   */
  private analyzeParseActivity(
    data: ParsedAwrData,
    thresholds: ResourceThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];

    if (!data.loadProfile) {
      return insights;
    }

    const parsesPerSec = data.loadProfile.parsesPerSecond ?? 0;
    const hardParsesPerSec = data.loadProfile.hardParsesPerSecond ?? 0;

    // Calculate hard parse ratio
    if (parsesPerSec > 0) {
      const hardParseRatio = (hardParsesPerSec / parsesPerSec) * 100;

      if (hardParseRatio >= thresholds.hardParseRatioWarningPercent) {
        insights.push(this.createHardParseRatioInsight(hardParseRatio, hardParsesPerSec, parsesPerSec, thresholds));
      }
    }

    // Check for very high parse activity
    if (hardParsesPerSec > 100) {
      insights.push(this.createHighHardParseInsight(hardParsesPerSec));
    }

    return insights;
  }

  // ==================== System Load Analysis ====================

  /**
   * Analyze system load patterns
   *
   * @param data - Parsed AWR data
   * @param _thresholds - Resource thresholds
   * @returns System load insights
   */
  private analyzeSystemLoad(
    data: ParsedAwrData,
    _thresholds: ResourceThresholds
  ): AwrInsight[] {
    const insights: AwrInsight[] = [];

    if (!data.osStatistics) {
      return insights;
    }

    const osStats = data.osStatistics;
    const cpuCount = data.header?.host?.cpus ?? 1;

    // Analyze load average relative to CPU count
    if (osStats.loadAvg1Min !== undefined) {
      const loadPerCpu = osStats.loadAvg1Min / cpuCount;

      if (loadPerCpu > 2) {
        insights.push(this.createHighLoadAverageInsight(osStats.loadAvg1Min, cpuCount, 'critical'));
      } else if (loadPerCpu > 1) {
        insights.push(this.createHighLoadAverageInsight(osStats.loadAvg1Min, cpuCount, 'warning'));
      }
    }

    return insights;
  }

  // ==================== Insight Creation Methods ====================

  /**
   * Create CPU usage insight
   */
  private createCpuInsight(
    totalCpuPercent: number,
    severity: InsightSeverity,
    userPercent: number,
    systemPercent: number
  ): AwrInsight {
    return this.createInsight({
      severity,
      category: RESOURCE_CATEGORY,
      title: 'High CPU Utilization',
      description: `System CPU usage is ${this.formatNumber(totalCpuPercent)}% ` +
        `(User: ${this.formatNumber(userPercent)}%, System: ${this.formatNumber(systemPercent)}%), ` +
        `indicating potential CPU saturation.`,
      recommendation: severity === 'critical'
        ? 'CRITICAL: Immediate attention required. Review top CPU-consuming queries, ' +
          'consider scaling CPU resources or optimizing workload distribution.'
        : 'Monitor CPU trends and review resource-intensive operations. ' +
          'Consider query optimization or hardware scaling if trend continues.',
      value: totalCpuPercent,
      unit: '%',
      threshold: this.config.thresholds.resources.cpuWarningPercent,
      impactScore: Math.min(100, Math.round(totalCpuPercent)),
      tags: [RESOURCE_TAGS.HIGH_CPU],
      metadata: {
        rawValues: {
          userPercent,
          systemPercent,
          totalCpuPercent,
        },
      },
    });
  }

  /**
   * Create DB CPU constrained insight
   */
  private createDbCpuConstrainedInsight(
    cpuToDbTimeRatio: number,
    dbCpuPerSecond: number,
    dbTimePerSecond: number,
    cpuCount?: number
  ): AwrInsight {
    return this.createInsight({
      severity: 'warning',
      category: RESOURCE_CATEGORY,
      title: 'Database is CPU Constrained',
      description: `DB CPU accounts for ${this.formatNumber(cpuToDbTimeRatio)}% of DB Time ` +
        `(${this.formatNumber(dbCpuPerSecond)}s CPU per second). ` +
        `Database workload is primarily CPU-bound.`,
      recommendation: 'Review CPU-intensive SQL statements. Consider optimizing calculations, ' +
        'reducing data volumes processed, or adding CPU resources. ' +
        (cpuCount ? `Current CPUs: ${cpuCount}.` : ''),
      value: cpuToDbTimeRatio,
      unit: '%',
      impactScore: Math.min(80, Math.round(cpuToDbTimeRatio * 0.8)),
      tags: [RESOURCE_TAGS.HIGH_CPU],
      metadata: {
        rawValues: {
          dbCpuPerSecond,
          dbTimePerSecond,
          ...(cpuCount !== undefined && { cpuCount }),
        },
      },
    });
  }

  /**
   * Create I/O wait insight
   */
  private createIoWaitInsight(ioWaitPercent: number, severity: InsightSeverity): AwrInsight {
    return this.createInsight({
      severity,
      category: RESOURCE_CATEGORY,
      title: 'High CPU I/O Wait',
      description: `CPU I/O wait is ${this.formatNumber(ioWaitPercent)}%, indicating ` +
        `the system is spending significant time waiting for I/O operations.`,
      recommendation: severity === 'critical'
        ? 'CRITICAL: Storage subsystem is a major bottleneck. Review storage performance, ' +
          'consider faster storage, or optimize I/O-heavy queries.'
        : 'Review I/O-intensive operations and consider storage optimization. ' +
          'Check for queries causing excessive physical reads.',
      value: ioWaitPercent,
      unit: '%',
      threshold: this.config.thresholds.resources.ioWaitWarningPercent,
      impactScore: Math.min(100, Math.round(ioWaitPercent * 2)),
      tags: [RESOURCE_TAGS.HIGH_IO],
      metadata: {
        rawValues: {
          ioWaitPercent,
        },
      },
    });
  }

  /**
   * Create buffer cache hit ratio insight
   */
  private createBufferCacheInsight(
    hitRatio: number,
    severity: InsightSeverity,
    thresholds: ResourceThresholds
  ): AwrInsight {
    return this.createInsight({
      severity,
      category: 'memory_efficiency',
      title: 'Low Buffer Cache Hit Ratio',
      description: `Buffer cache hit ratio is ${this.formatNumber(hitRatio)}% ` +
        `(threshold: ${thresholds.bufferCacheWarningPercent}%). ` +
        `This indicates excessive physical disk reads.`,
      recommendation: 'Consider increasing the buffer cache size (DB_CACHE_SIZE) or ' +
        'optimizing queries to reduce logical reads. Review full table scans and ' +
        'ensure appropriate indexes exist.',
      value: hitRatio,
      unit: '%',
      threshold: thresholds.bufferCacheWarningPercent,
      impactScore: Math.min(100, Math.round((100 - hitRatio) * 2)),
      tags: [RESOURCE_TAGS.BUFFER_CACHE],
      metadata: {
        rawValues: {
          hitRatio,
        },
      },
    });
  }

  /**
   * Create library cache hit ratio insight
   */
  private createLibraryCacheInsight(
    hitRatio: number,
    severity: InsightSeverity,
    thresholds: ResourceThresholds
  ): AwrInsight {
    return this.createInsight({
      severity,
      category: 'memory_efficiency',
      title: 'Low Library Cache Hit Ratio',
      description: `Library cache hit ratio is ${this.formatNumber(hitRatio)}% ` +
        `(threshold: ${thresholds.libraryCacheWarningPercent}%). ` +
        `This indicates excessive parsing and shared pool contention.`,
      recommendation: 'Consider increasing SHARED_POOL_SIZE. Ensure applications use bind ' +
        'variables to promote cursor sharing. Review cursor_sharing parameter.',
      value: hitRatio,
      unit: '%',
      threshold: thresholds.libraryCacheWarningPercent,
      impactScore: Math.min(80, Math.round((100 - hitRatio) * 1.5)),
      tags: [RESOURCE_TAGS.LIBRARY_CACHE],
      metadata: {
        rawValues: {
          hitRatio,
        },
      },
    });
  }

  /**
   * Create PGA memory insight
   */
  private createPgaMemoryInsight(
    usagePercent: number,
    allocatedMb: number,
    targetMb: number
  ): AwrInsight {
    return this.createInsight({
      severity: usagePercent >= 95 ? 'critical' : 'warning',
      category: 'memory_efficiency',
      title: 'High PGA Memory Usage',
      description: `PGA usage is ${this.formatNumber(usagePercent)}% of target ` +
        `(${this.formatNumber(allocatedMb, 0)}MB of ${this.formatNumber(targetMb, 0)}MB). ` +
        `Memory-intensive operations may spill to disk.`,
      recommendation: 'Consider increasing PGA_AGGREGATE_TARGET or PGA_AGGREGATE_LIMIT. ' +
        'Review sort and hash operations in queries. Check for sessions with excessive memory usage.',
      value: usagePercent,
      unit: '%',
      impactScore: Math.min(70, Math.round(usagePercent * 0.7)),
      tags: [RESOURCE_TAGS.PGA_MEMORY],
      metadata: {
        rawValues: {
          allocatedMb,
          targetMb,
        },
      },
    });
  }

  /**
   * Create PGA cache hit insight
   */
  private createPgaCacheHitInsight(cacheHitPercent: number): AwrInsight {
    return this.createInsight({
      severity: cacheHitPercent < 70 ? 'warning' : 'info',
      category: 'memory_efficiency',
      title: 'Low PGA Cache Hit Ratio',
      description: `PGA cache hit ratio is ${this.formatNumber(cacheHitPercent)}%. ` +
        `Memory-intensive operations are spilling to disk.`,
      recommendation: 'Review workload memory requirements. Consider increasing PGA target ' +
        'or optimizing queries with large sorts/hash joins.',
      value: cacheHitPercent,
      unit: '%',
      impactScore: Math.round((100 - cacheHitPercent) * 0.5),
      tags: [RESOURCE_TAGS.PGA_MEMORY],
      metadata: {
        rawValues: {
          cacheHitPercent,
        },
      },
    });
  }

  /**
   * Create OS memory insight
   */
  private createOsMemoryInsight(
    usagePercent: number,
    severity: InsightSeverity,
    usedMb: number,
    freeMb: number
  ): AwrInsight {
    return this.createInsight({
      severity,
      category: RESOURCE_CATEGORY,
      title: 'High System Memory Usage',
      description: `System memory usage is ${this.formatNumber(usagePercent)}% ` +
        `(${this.formatNumber(usedMb, 0)}MB used, ${this.formatNumber(freeMb, 0)}MB free).`,
      recommendation: severity === 'critical'
        ? 'CRITICAL: System is under memory pressure. Review memory allocation, ' +
          'consider reducing SGA/PGA or adding physical memory.'
        : 'Monitor memory trends. Consider right-sizing memory pools or adding resources.',
      value: usagePercent,
      unit: '%',
      threshold: this.config.thresholds.resources.memoryWarningPercent,
      impactScore: Math.min(100, Math.round(usagePercent)),
      tags: [RESOURCE_TAGS.HIGH_MEMORY],
      metadata: {
        rawValues: {
          usedMb,
          freeMb,
        },
      },
    });
  }

  /**
   * Create swap usage insight
   */
  private createSwapUsageInsight(swapUsagePercent: number, swapUsedMb: number): AwrInsight {
    return this.createInsight({
      severity: swapUsagePercent > 50 ? 'critical' : 'warning',
      category: RESOURCE_CATEGORY,
      title: 'System Using Swap Memory',
      description: `System is using ${this.formatNumber(swapUsagePercent)}% of swap space ` +
        `(${this.formatNumber(swapUsedMb, 0)}MB). This severely impacts performance.`,
      recommendation: 'Swap usage indicates memory pressure. Reduce memory usage ' +
        '(SGA, PGA, or other processes) or add physical memory. Never run Oracle with significant swap usage.',
      value: swapUsagePercent,
      unit: '%',
      impactScore: Math.min(100, Math.round(swapUsagePercent * 2)),
      tags: [RESOURCE_TAGS.MEMORY_PRESSURE],
      metadata: {
        rawValues: {
          swapUsedMb,
          swapUsagePercent,
        },
      },
    });
  }

  /**
   * Create high physical reads insight
   */
  private createHighPhysicalReadsInsight(
    readsPerSec: number,
    thresholds: ResourceThresholds
  ): AwrInsight {
    return this.createInsight({
      severity: readsPerSec >= thresholds.highPhysicalReadsPerSecond * 3 ? 'warning' : 'info',
      category: 'io_performance',
      title: 'High Physical Reads',
      description: `Physical reads are ${this.formatNumber(readsPerSec, 0)} per second ` +
        `(threshold: ${thresholds.highPhysicalReadsPerSecond}). ` +
        `High disk I/O may impact performance.`,
      recommendation: 'Review queries causing excessive physical reads. Check for missing indexes, ' +
        'full table scans, or undersized buffer cache.',
      value: readsPerSec,
      unit: 'reads/sec',
      threshold: thresholds.highPhysicalReadsPerSecond,
      impactScore: Math.min(60, Math.round(readsPerSec / thresholds.highPhysicalReadsPerSecond * 20)),
      tags: [RESOURCE_TAGS.HIGH_IO],
      metadata: {
        rawValues: {
          physicalReadsPerSecond: readsPerSec,
        },
      },
    });
  }

  /**
   * Create high logical reads insight
   */
  private createHighLogicalReadsInsight(
    readsPerSec: number,
    thresholds: ResourceThresholds
  ): AwrInsight {
    return this.createInsight({
      severity: 'info',
      category: 'io_performance',
      title: 'High Logical Reads',
      description: `Logical reads are ${this.formatNumber(readsPerSec, 0)} per second ` +
        `(threshold: ${thresholds.highLogicalReadsPerSecond}). ` +
        `High buffer activity indicates significant data access.`,
      recommendation: 'Review high buffer gets queries. Optimize queries to access less data ' +
        'through better filtering or indexing strategies.',
      value: readsPerSec,
      unit: 'reads/sec',
      threshold: thresholds.highLogicalReadsPerSecond,
      impactScore: Math.min(40, Math.round(readsPerSec / thresholds.highLogicalReadsPerSecond * 10)),
      tags: [RESOURCE_TAGS.HIGH_IO],
      metadata: {
        rawValues: {
          logicalReadsPerSecond: readsPerSec,
        },
      },
    });
  }

  /**
   * Create high physical to logical reads ratio insight
   */
  private createHighPhysicalToLogicalRatioInsight(
    ratio: number,
    physReads: number,
    logicalReads: number
  ): AwrInsight {
    return this.createInsight({
      severity: ratio > 20 ? 'warning' : 'info',
      category: 'io_performance',
      title: 'Poor Buffer Cache Efficiency',
      description: `Physical to logical reads ratio is ${this.formatNumber(ratio)}%. ` +
        `This indicates poor buffer cache efficiency.`,
      recommendation: 'Increase buffer cache size or review queries causing excessive physical reads. ' +
        'Consider indexes to reduce data volume accessed.',
      value: ratio,
      unit: '%',
      impactScore: Math.min(60, Math.round(ratio * 2)),
      tags: [RESOURCE_TAGS.BUFFER_CACHE, RESOURCE_TAGS.IO_BOTTLENECK],
      metadata: {
        rawValues: {
          physicalReadsPerSecond: physReads,
          logicalReadsPerSecond: logicalReads,
          ratio,
        },
      },
    });
  }

  /**
   * Create tablespace I/O latency insight
   */
  private createTablespaceIoLatencyInsight(
    tablespaceName: string,
    latencyMs: number,
    operation: 'read' | 'write'
  ): AwrInsight {
    const severity: InsightSeverity = latencyMs > 20 ? 'warning' : 'info';

    return this.createInsight({
      severity,
      category: 'io_performance',
      title: `High ${operation === 'read' ? 'Read' : 'Write'} Latency: ${tablespaceName}`,
      description: `Tablespace "${tablespaceName}" has ${this.formatNumber(latencyMs, 1)}ms ` +
        `average ${operation} latency. Expected: <10ms for SSD, <20ms for HDD.`,
      recommendation: `Review storage performance for tablespace "${tablespaceName}". ` +
        `Consider faster storage, redistributing hot files, or caching improvements.`,
      value: latencyMs,
      unit: 'ms',
      impactScore: Math.min(50, Math.round(latencyMs * 2)),
      tags: [RESOURCE_TAGS.IO_BOTTLENECK],
      metadata: {
        rawValues: {
          tablespaceName,
          latencyMs,
          operation,
        },
      },
    });
  }

  /**
   * Create hard parse ratio insight
   */
  private createHardParseRatioInsight(
    hardParseRatio: number,
    hardParsesPerSec: number,
    parsesPerSec: number,
    thresholds: ResourceThresholds
  ): AwrInsight {
    return this.createInsight({
      severity: hardParseRatio >= 50 ? 'warning' : 'info',
      category: 'parse_overhead',
      title: 'High Hard Parse Ratio',
      description: `Hard parse ratio is ${this.formatNumber(hardParseRatio)}% ` +
        `(${this.formatNumber(hardParsesPerSec, 0)} hard parses of ${this.formatNumber(parsesPerSec, 0)} total per second). ` +
        `Threshold: ${thresholds.hardParseRatioWarningPercent}%.`,
      recommendation: 'Implement bind variables in application code. Review cursor_sharing parameter. ' +
        'Consider increasing shared pool size if hard parses are causing memory pressure.',
      value: hardParseRatio,
      unit: '%',
      threshold: thresholds.hardParseRatioWarningPercent,
      impactScore: Math.min(60, Math.round(hardParseRatio)),
      tags: [RESOURCE_TAGS.HARD_PARSE],
      metadata: {
        rawValues: {
          hardParsesPerSecond: hardParsesPerSec,
          parsesPerSecond: parsesPerSec,
        },
      },
    });
  }

  /**
   * Create high hard parse insight
   */
  private createHighHardParseInsight(hardParsesPerSec: number): AwrInsight {
    return this.createInsight({
      severity: hardParsesPerSec > 500 ? 'warning' : 'info',
      category: 'parse_overhead',
      title: 'Excessive Hard Parses',
      description: `Hard parses are ${this.formatNumber(hardParsesPerSec, 0)} per second. ` +
        `This causes significant CPU and shared pool overhead.`,
      recommendation: 'Use bind variables in all SQL statements. Consider session_cached_cursors ' +
        'and cursor_sharing settings. Review application SQL generation patterns.',
      value: hardParsesPerSec,
      unit: 'parses/sec',
      impactScore: Math.min(70, Math.round(hardParsesPerSec / 10)),
      tags: [RESOURCE_TAGS.HARD_PARSE],
      metadata: {
        rawValues: {
          hardParsesPerSecond: hardParsesPerSec,
        },
      },
    });
  }

  /**
   * Create high load average insight
   */
  private createHighLoadAverageInsight(
    loadAvg: number,
    cpuCount: number,
    severity: InsightSeverity
  ): AwrInsight {
    const loadPerCpu = loadAvg / cpuCount;

    return this.createInsight({
      severity,
      category: RESOURCE_CATEGORY,
      title: 'High System Load Average',
      description: `System load average is ${this.formatNumber(loadAvg, 2)} with ${cpuCount} CPUs ` +
        `(${this.formatNumber(loadPerCpu, 2)} per CPU). ` +
        `${loadPerCpu > 1 ? 'System is overloaded.' : 'System is approaching saturation.'}`,
      recommendation: severity === 'critical'
        ? 'CRITICAL: System is severely overloaded. Review CPU-intensive processes, ' +
          'reduce workload, or add CPU capacity immediately.'
        : 'Monitor load trends. Consider workload optimization or resource scaling.',
      value: loadAvg,
      unit: 'load',
      impactScore: Math.min(100, Math.round(loadPerCpu * 50)),
      tags: [RESOURCE_TAGS.LOAD_AVERAGE, RESOURCE_TAGS.HIGH_CPU],
      metadata: {
        rawValues: {
          loadAverage: loadAvg,
          cpuCount,
          loadPerCpu,
        },
      },
    });
  }
}
