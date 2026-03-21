/**
 * Resource Allocation Manager
 * CRITICAL FIX: Aligns worker concurrency with external service capacity limits
 */

import { JOB_QUEUE_CONFIGS, type JobName } from '../types/jobs.js';
import { getConfig } from './environment.js';
import { getLogger } from '../lib/utils/logger.js';
import os from 'os';

const logger = getLogger('resource-manager');

export interface ResourceRequirements {
  memory_mb: number;
  cpu_cores: number;
  grafana_connections?: number;
  database_connections?: number;
  io_intensive: boolean;
}

export interface SystemResources {
  totalMemoryMB: number;
  availableMemoryMB: number;
  cpuCores: number;
  cpuLoadAverage: number;
  grafanaMaxConcurrency: number;
  databaseMaxConnections: number;
}

export interface ResourceAllocation {
  jobName: string;
  maxConcurrentJobs: number;
  recommendedTeamSize: number;
  resourceUtilization: {
    memory: number;
    cpu: number;
    grafana: number;
    database: number;
  };
  warnings: string[];
}

/**
 * Resource Management and Allocation Calculator
 */
export class ResourceManager {
  private config = getConfig();

  /**
   * Get current system resources
   */
  async getSystemResources(): Promise<SystemResources> {
    const totalMemoryMB = Math.round(os.totalmem() / 1024 / 1024);
    const availableMemoryMB = Math.round(os.freemem() / 1024 / 1024);
    const cpuCores = os.cpus().length;
    const cpuLoadAverage = os.loadavg()[0];

    return {
      totalMemoryMB,
      availableMemoryMB,
      cpuCores,
      cpuLoadAverage,
      grafanaMaxConcurrency: this.config.GRAFANA_CONCURRENCY,
      databaseMaxConnections: this.config.DB_POOL_SIZE
    };
  }

  /**
   * Calculate optimal resource allocation for a job type
   */
  calculateJobAllocation(
    jobName: JobName,
    jobRequirements: ResourceRequirements,
    systemResources: SystemResources
  ): ResourceAllocation {
    const currentConfig = JOB_QUEUE_CONFIGS[jobName];
    const warnings: string[] = [];

    // Calculate maximum jobs based on different resource constraints
    const memoryLimit = Math.floor(systemResources.availableMemoryMB * 0.8 / jobRequirements.memory_mb);
    const cpuLimit = Math.floor(systemResources.cpuCores / jobRequirements.cpu_cores);

    // Special handling for Grafana-dependent jobs
    let grafanaLimit = Infinity;
    if (jobRequirements.grafana_connections) {
      grafanaLimit = Math.floor(systemResources.grafanaMaxConcurrency / jobRequirements.grafana_connections);

      // CRITICAL FIX: Metrics collection jobs need special consideration
      if (jobName === 'metrics-collection') {
        // Reserve 25% of Grafana capacity for other jobs
        grafanaLimit = Math.floor(systemResources.grafanaMaxConcurrency * 0.75 / jobRequirements.grafana_connections);

        if (currentConfig.teamSize * currentConfig.teamConcurrency > grafanaLimit) {
          warnings.push(
            `Current metrics collection config (${currentConfig.teamSize} × ${currentConfig.teamConcurrency} = ${currentConfig.teamSize * currentConfig.teamConcurrency}) ` +
            `exceeds Grafana capacity (${grafanaLimit}). Risk of connection exhaustion.`
          );
        }
      }
    }

    // Database connection limit
    let dbLimit = Infinity;
    if (jobRequirements.database_connections) {
      // Reserve connections for non-job operations
      const reservedConnections = 10;
      dbLimit = Math.floor((systemResources.databaseMaxConnections - reservedConnections) / jobRequirements.database_connections);
    }

    // Find the most restrictive limit
    const maxConcurrentJobs = Math.min(memoryLimit, cpuLimit, grafanaLimit, dbLimit);

    // Calculate recommended team size based on job characteristics
    let recommendedTeamSize: number;

    if (jobRequirements.io_intensive) {
      // IO-intensive jobs can have higher concurrency
      recommendedTeamSize = Math.min(maxConcurrentJobs, Math.max(2, Math.floor(maxConcurrentJobs * 0.8)));
    } else {
      // CPU-intensive jobs should be more conservative
      recommendedTeamSize = Math.min(maxConcurrentJobs, Math.max(1, Math.floor(systemResources.cpuCores * 0.6)));
    }

    // Resource utilization calculation
    const actualConcurrency = currentConfig.teamSize * currentConfig.teamConcurrency;
    const resourceUtilization = {
      memory: (actualConcurrency * jobRequirements.memory_mb) / systemResources.totalMemoryMB,
      cpu: (actualConcurrency * jobRequirements.cpu_cores) / systemResources.cpuCores,
      grafana: jobRequirements.grafana_connections ?
        (actualConcurrency * jobRequirements.grafana_connections) / systemResources.grafanaMaxConcurrency : 0,
      database: jobRequirements.database_connections ?
        (actualConcurrency * jobRequirements.database_connections) / systemResources.databaseMaxConnections : 0
    };

    // Add warnings for resource conflicts
    if (resourceUtilization.memory > 0.7) {
      warnings.push(`High memory utilization (${Math.round(resourceUtilization.memory * 100)}%)`);
    }
    if (resourceUtilization.cpu > 0.8) {
      warnings.push(`High CPU utilization (${Math.round(resourceUtilization.cpu * 100)}%)`);
    }
    if (resourceUtilization.grafana > 0.8) {
      warnings.push(`High Grafana connection utilization (${Math.round(resourceUtilization.grafana * 100)}%)`);
    }
    if (resourceUtilization.database > 0.7) {
      warnings.push(`High database connection utilization (${Math.round(resourceUtilization.database * 100)}%)`);
    }

    return {
      jobName,
      maxConcurrentJobs,
      recommendedTeamSize,
      resourceUtilization,
      warnings
    };
  }

  /**
   * Get resource requirements for specific job types
   */
  getJobResourceRequirements(jobName: JobName): ResourceRequirements {
    const baseRequirements: Record<JobName, ResourceRequirements> = {
      'analyze-test': {
        memory_mb: 512,
        cpu_cores: 2,
        database_connections: 2,
        io_intensive: true
      },
      'metrics-collection': {
        memory_mb: 256,
        cpu_cores: 1,
        grafana_connections: 3, // FIXED: Each job uses multiple connections
        database_connections: 1,
        io_intensive: true
      },
      'statistics-calculation': {
        memory_mb: 384,
        cpu_cores: 2,
        database_connections: 2,
        io_intensive: false
      },
      'checks-evaluation': {
        memory_mb: 256,
        cpu_cores: 1,
        database_connections: 1,
        io_intensive: false
      },
      'adapt-analysis': {
        memory_mb: 768,
        cpu_cores: 3,
        database_connections: 2,
        io_intensive: false
      },
      'panels-processing': {
        memory_mb: 256,
        cpu_cores: 1,
        database_connections: 2,
        io_intensive: true
      },
      'performance-test-metrics': {
        memory_mb: 256,
        cpu_cores: 1,
        database_connections: 2,
        io_intensive: true
      },
      'dynatrace-collection': {
        memory_mb: 192,
        cpu_cores: 1,
        database_connections: 1,
        io_intensive: true
      },
      'reevaluate-checks': {
        memory_mb: 256,
        cpu_cores: 1,
        database_connections: 1,
        io_intensive: false
      },
      'control-groups-pipeline': {
        memory_mb: 320,
        cpu_cores: 2,
        database_connections: 2,
        io_intensive: false
      },
      'control-group-statistics': {
        memory_mb: 320,
        cpu_cores: 2,
        database_connections: 2,
        io_intensive: false
      },
      'batch-analysis': {
        memory_mb: 128,
        cpu_cores: 1,
        database_connections: 1,
        io_intensive: false
      },
      'batch-flow': {
        memory_mb: 256,
        cpu_cores: 1,
        database_connections: 1,
        io_intensive: false
      },
      'reevaluation-batch': {
        memory_mb: 192,
        cpu_cores: 1,
        database_connections: 1,
        io_intensive: false
      },
      'orchestrate-reevaluate-batch': {
        memory_mb: 512,
        cpu_cores: 2,
        database_connections: 2,
        io_intensive: false
      },
      'collect-metrics-incremental': {
        memory_mb: 256,
        cpu_cores: 1,
        grafana_connections: 2,
        database_connections: 1,
        io_intensive: true
      }
    };

    return baseRequirements[jobName];
  }

  /**
   * Analyze all job configurations for resource conflicts
   */
  async analyzeResourceConflicts(): Promise<{
    isOptimal: boolean;
    allocations: ResourceAllocation[];
    criticalIssues: string[];
    recommendations: string[];
  }> {
    const systemResources = await this.getSystemResources();
    const allocations: ResourceAllocation[] = [];
    const criticalIssues: string[] = [];
    const recommendations: string[] = [];

    // Analyze each job type
    for (const jobName of Object.keys(JOB_QUEUE_CONFIGS) as JobName[]) {
      const requirements = this.getJobResourceRequirements(jobName);
      const allocation = this.calculateJobAllocation(jobName, requirements, systemResources);

      allocations.push(allocation);

      // Collect critical issues
      if (allocation.warnings.length > 0) {
        criticalIssues.push(`${jobName}: ${allocation.warnings.join(', ')}`);
      }

      // Generate recommendations
      const currentConfig = JOB_QUEUE_CONFIGS[jobName];
      if (allocation.recommendedTeamSize !== currentConfig.teamSize) {
        recommendations.push(
          `${jobName}: Adjust teamSize from ${currentConfig.teamSize} to ${allocation.recommendedTeamSize}`
        );
      }
    }

    // Check for total resource allocation
    const totalMemoryUsage = allocations.reduce((sum, alloc) => {
      const _config = JOB_QUEUE_CONFIGS[alloc.jobName as JobName];
      return sum + (alloc.resourceUtilization.memory * systemResources.totalMemoryMB);
    }, 0);

    const totalGrafanaUsage = allocations.reduce((sum, alloc) => {
      return sum + (alloc.resourceUtilization.grafana * systemResources.grafanaMaxConcurrency);
    }, 0);

    if (totalMemoryUsage > systemResources.totalMemoryMB * 0.9) {
      criticalIssues.push('Total memory allocation exceeds 90% of system memory');
    }

    if (totalGrafanaUsage > systemResources.grafanaMaxConcurrency * 0.9) {
      criticalIssues.push('Total Grafana connection usage exceeds 90% of configured limit');
    }

    const isOptimal = criticalIssues.length === 0;

    return {
      isOptimal,
      allocations,
      criticalIssues,
      recommendations
    };
  }

  /**
   * Generate optimized job queue configurations
   */
  async generateOptimizedConfigurations(): Promise<Record<JobName, {
    teamSize: number;
    teamConcurrency: number;
    batchSize: number;
    rationale: string;
  }>> {
    const analysis = await this.analyzeResourceConflicts();
    const optimizedConfigs: Record<string, any> = {};

    analysis.allocations.forEach(allocation => {
      const currentConfig = JOB_QUEUE_CONFIGS[allocation.jobName as JobName];
      const requirements = this.getJobResourceRequirements(allocation.jobName as JobName);

      optimizedConfigs[allocation.jobName] = {
        teamSize: allocation.recommendedTeamSize,
        teamConcurrency: requirements.io_intensive ? 2 : 1, // IO jobs can handle more concurrency
        batchSize: currentConfig.batchSize, // Keep existing batch size for now
        rationale: `Optimized for ${allocation.maxConcurrentJobs} max concurrent jobs. ` +
                  `Resource utilization: Memory ${Math.round(allocation.resourceUtilization.memory * 100)}%, ` +
                  `CPU ${Math.round(allocation.resourceUtilization.cpu * 100)}%` +
                  (allocation.resourceUtilization.grafana > 0 ? `, Grafana ${Math.round(allocation.resourceUtilization.grafana * 100)}%` : '')
      };
    });

    return optimizedConfigs;
  }

  /**
   * Log resource analysis results
   */
  async logResourceAnalysis(): Promise<void> {
    const analysis = await this.analyzeResourceConflicts();
    const systemResources = await this.getSystemResources();

    logger.info('🔍 Resource Allocation Analysis', {
      systemResources: {
        memory: `${systemResources.availableMemoryMB}MB / ${systemResources.totalMemoryMB}MB`,
        cpuCores: systemResources.cpuCores,
        cpuLoad: systemResources.cpuLoadAverage,
        grafanaMaxConcurrency: systemResources.grafanaMaxConcurrency,
        databaseMaxConnections: systemResources.databaseMaxConnections
      },
      isOptimal: analysis.isOptimal,
      totalIssues: analysis.criticalIssues.length
    });

    if (analysis.criticalIssues.length > 0) {
      logger.warn('⚠️ Critical Resource Issues:');
      analysis.criticalIssues.forEach(issue => logger.warn(`  - ${issue}`));
    }

    if (analysis.recommendations.length > 0) {
      logger.info('💡 Resource Optimization Recommendations:');
      analysis.recommendations.forEach(rec => logger.info(`  - ${rec}`));
    }

    // Log per-job analysis
    analysis.allocations.forEach(allocation => {
      if (allocation.warnings.length > 0) {
        logger.warn(`🚨 ${allocation.jobName} resource warnings:`, allocation.warnings);
      }
    });
  }
}

/**
 * Singleton resource manager instance
 */
let resourceManagerInstance: ResourceManager | null = null;

export function getResourceManager(): ResourceManager {
  if (!resourceManagerInstance) {
    resourceManagerInstance = new ResourceManager();
  }
  return resourceManagerInstance;
}

/**
 * Validate resource allocation at startup
 */
export async function validateResourceAllocationAtStartup(): Promise<boolean> {
  logger.info('🔍 Validating resource allocation...');

  const resourceManager = getResourceManager();
  await resourceManager.logResourceAnalysis();

  const analysis = await resourceManager.analyzeResourceConflicts();

  if (!analysis.isOptimal) {
    logger.error('❌ Resource allocation validation failed!');
    logger.error('Critical issues must be resolved before starting workers');
    return false;
  }

  logger.info('✅ Resource allocation validation passed');
  return true;
}