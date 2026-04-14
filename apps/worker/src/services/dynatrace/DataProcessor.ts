import { getLogger } from '../../lib/utils/logger.js';
import {
  DynatraceQueryResult,
  MetricRecord,
  PanelMetricsDocument,
  PanelDocument
} from '../../types/dynatrace/index.js';
import { validateRegexPattern } from '@perfana/shared/utils';

const logger = getLogger('dynatrace-data-processor');

/**
 * Dynatrace Data Processor
 *
 * Processes DQL query results into time-series metrics
 * Based on Python implementation: data_processor.py
 *
 * Key features:
 * 1. Regex pattern filtering for metric names
 * 2. DQL grouping field extraction (by: {field1, field2})
 * 3. Field rename parsing (fieldsRename)
 * 4. FieldsAdd operations support
 * 5. Time series array expansion
 * 6. Complex metric name construction
 */

export class DataProcessor {
  /**
   * Check if a metric name matches the given regex pattern
   * Uses safe-regex validation to prevent ReDoS attacks
   */
  private matchesMetricPattern(metricName: string, pattern?: string | null): boolean {
    if (!pattern) {
      return true;
    }

    // Validate pattern for safety (ReDoS prevention)
    const result = validateRegexPattern(pattern);
    if (!result.safe) {
      logger.warn(`Unsafe or invalid regex pattern '${pattern}': ${result.error}`);
      return true; // If pattern is unsafe/invalid, don't filter
    }

    return result.regex!.test(metricName);
  }

  /**
   * Parse DQL query to extract grouping fields from 'by:' clause
   * Example: "by: { field1, field2, field3 }" → ["field1", "field2", "field3"]
   */
  private parseDqlGroupingFields(query: string): string[] {
    try {
      const byPattern = /by:\s*\{\s*([^}]+)\s*\}/i;
      const match = query.match(byPattern);

      if (!match) {
        return [];
      }

      const fieldsStr = match[1];
      const fields = fieldsStr.split(',').map(f => f.trim());

      logger.debug(`Extracted grouping fields from DQL: ${fields.join(', ')}`);
      return fields;
    } catch (error) {
      logger.warn(`Failed to parse DQL grouping fields:`, error);
      return [];
    }
  }

  /**
   * Parse DQL query to extract field rename mappings from 'fieldsRename' operations
   * Example: "fieldsRename `NewName` = old_field_name" → { old_field_name: "NewName" }
   */
  private parseDqlFieldRenames(query: string): Record<string, string> {
    try {
      const renameMappings: Record<string, string> = {};
      const renamePattern = /fieldsRename\s+`?([^`=\s]+)`?\s*=\s*([^,\n|]+)/gi;

      let match: RegExpExecArray | null;
      while ((match = renamePattern.exec(query)) !== null) {
        const newName = match[1].trim();
        const oldName = match[2].trim();
        renameMappings[oldName] = newName;
      }

      logger.debug(`Extracted field renames from DQL:`, renameMappings);
      return renameMappings;
    } catch (error) {
      logger.warn(`Failed to parse DQL field renames:`, error);
      return {};
    }
  }

  /**
   * Check if the DQL query contains fieldsAdd operations
   */
  private hasFieldsAdd(query: string): boolean {
    return query.toLowerCase().includes('fieldsadd');
  }

  /**
   * Parse DQL query to extract field names added by fieldsAdd operations
   * Example: "fieldsAdd fieldName = value" → ["fieldName"]
   */
  private parseFieldsAddNames(query: string): string[] {
    try {
      const fieldsAddNames: string[] = [];
      const fieldsAddPattern = /fieldsAdd\s+([^=\s]+)\s*=/gi;

      let match: RegExpExecArray | null;
      while ((match = fieldsAddPattern.exec(query)) !== null) {
        const fieldName = match[1].trim();
        fieldsAddNames.push(fieldName);
      }

      logger.debug(`Extracted fieldsAdd field names from DQL: ${fieldsAddNames.join(', ')}`);
      return fieldsAddNames;
    } catch (error) {
      logger.warn(`Failed to parse DQL fieldsAdd operations:`, error);
      return [];
    }
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegexString(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Extract filter value from DQL query for a specific field
   * Example: "filter dt.entity.service == 'SERVICE-123'" -> 'SERVICE-123'
   * Uses safe-regex validation to prevent ReDoS attacks
   */
  private extractFilterValue(query: string, fieldName: string): string | null {
    try {
      // Escape field name to safely use in regex pattern
      const escapedFieldName = this.escapeRegexString(fieldName);

      // Match patterns like: filter fieldName == "value" or filter fieldName == 'value'
      const patternStrings = [
        `filter\\s+${escapedFieldName}\\s*==\\s*["']([^"']+)["']`,
        `filter\\s+${escapedFieldName}\\s*==\\s*([^\\s,)]+)`,
        `${escapedFieldName}\\s*==\\s*["']([^"']+)["']`,
        `${escapedFieldName}\\s*==\\s*([^\\s,)]+)`
      ];

      for (const patternStr of patternStrings) {
        const result = validateRegexPattern(patternStr, { flags: 'i' });
        if (!result.safe) {
          logger.warn(`Unsafe regex pattern for field '${fieldName}': ${result.error}`);
          continue;
        }

        const match = query.match(result.regex!);
        if (match) {
          logger.debug(`Found filter value for ${fieldName}: ${match[1]}`);
          return match[1];
        }
      }

      return null;
    } catch (error) {
      logger.warn(`Failed to extract filter value for ${fieldName}:`, error);
      return null;
    }
  }

  /**
   * Extract grouping field values from a DQL response record
   * For Metrics API v2 queries (no 'by:' clause), also extracts dt.entity.* dimension values
   */
  private getGroupingFieldValues(record: Record<string, any>, query: string): string[] {
    try {
      const groupingFields = this.parseDqlGroupingFields(query);

      // For Metrics API v2 queries (no 'by:' clause), extract dt.entity.* dimension fields
      if (groupingFields.length === 0) {
        const dimensionValues: string[] = [];
        for (const [key, value] of Object.entries(record)) {
          // Dynatrace dimension fields start with 'dt.entity.'
          if (key.startsWith('dt.entity.') && value !== null && value !== undefined && value !== '') {
            // Use the entity ID (e.g., HOST-123) as a dimension value
            dimensionValues.push(String(value));
          }
        }
        if (dimensionValues.length > 0) {
          logger.debug(`Extracted Metrics API v2 dimension values: ${dimensionValues.join(', ')}`);
        }
        return dimensionValues;
      }

      const fieldRenames = this.parseDqlFieldRenames(query);
      const groupingValues: string[] = [];

      logger.debug(`Processing grouping fields: ${groupingFields.join(', ')}`);
      logger.debug(`Field renames:`, fieldRenames);
      logger.debug(`Available record fields: ${Object.keys(record).join(', ')}`);

      for (const originalField of groupingFields) {
        // Check if field was renamed
        const actualField = fieldRenames[originalField] || originalField;

        // Get value from record
        const fieldValue = record[actualField];
        logger.debug(`Field '${originalField}' -> '${actualField}' = ${fieldValue}`);

        if (fieldValue !== null && fieldValue !== undefined && fieldValue !== '') {
          groupingValues.push(String(fieldValue));
        } else {
          // Try to extract value from query filter if missing in response
          const filterValue = this.extractFilterValue(query, originalField);
          if (filterValue) {
            logger.info(`Using filter value '${filterValue}' for missing grouping field '${actualField}' (from query)`);
            groupingValues.push(filterValue);
          } else {
            logger.warn(`Missing value for grouping field '${actualField}' (original: '${originalField}')`);
            logger.warn(`Complete record structure: ${JSON.stringify(record, null, 2)}`);
            logger.warn(`Query: ${query}`);
            return []; // Return empty if any grouping field is missing and no filter found
          }
        }
      }

      return groupingValues;
    } catch (error) {
      logger.warn(`Failed to extract grouping field values:`, error);
      return [];
    }
  }

  /**
   * Check if a field is a grouping field based on the DQL query
   */
  private isGroupingField(fieldName: string, query: string): boolean {
    try {
      const groupingFields = this.parseDqlGroupingFields(query);
      if (groupingFields.length === 0) {
        return false;
      }

      const fieldRenames = this.parseDqlFieldRenames(query);

      // Check if fieldName is either an original grouping field OR a renamed grouping field
      for (const originalField of groupingFields) {
        const actualField = fieldRenames[originalField] || originalField;
        if (fieldName === originalField || fieldName === actualField) {
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.warn(`Failed to check if field is grouping field:`, error);
      return false;
    }
  }

  /**
   * Calculate timestep and rampUp status for a given timestamp
   * Reuses logic from Grafana formatter (formatter.ts:318-323)
   */
  private calculateTimestepAndRampUp(
    timestamp: Date,
    testRun?: any
  ): { timestep: number; rampUp: boolean } {
    // Note: TypeORM entity uses camelCase (startTime, analysisStartOffset) not snake_case
    if (!testRun) {
      logger.warn('calculateTimestepAndRampUp: testRun is undefined or null');
      return { timestep: 0.0, rampUp: false };
    }

    // Check for startTime in both camelCase (TypeORM entity) and snake_case (raw query)
    const startTimeValue = testRun.startTime || testRun.start_time;

    if (!startTimeValue) {
      logger.warn(`calculateTimestepAndRampUp: testRun has no startTime or start_time. Available properties: ${Object.keys(testRun).join(', ')}`);
      return { timestep: 0.0, rampUp: false };
    }

    const startTime = new Date(startTimeValue);
    const timestep = (timestamp.getTime() - startTime.getTime()) / 1000; // seconds since test start

    // Round to integer for cleaner display
    const roundedTimestep = Math.round(timestep);

    const analysisStartOffsetSeconds = testRun.analysisStartOffset || testRun.ramp_up || 0;
    const rampUp = roundedTimestep < analysisStartOffsetSeconds;

    return { timestep: roundedTimestep, rampUp };
  }

  /**
   * Parse timestamp from DQL record
   */
  private parseTimestamp(record: Record<string, any>, testRunEnd?: Date): { timestamp: Date; fieldName: string | null } {
    // Check for various timestamp field patterns
    const timestampFields = [
      'timestamp',
      'timeframe.start',
      'timeframe',
      'time',
      '_time',
      'dt.timestamp'
    ];

    for (const tsField of timestampFields) {
      if (tsField in record) {
        const value = record[tsField];
        if (value) {
          return {
            timestamp: this.parseTimestampValue(value),
            fieldName: tsField
          };
        }
      }
    }

    // Check if timeframe object exists
    if ('timeframe' in record && typeof record.timeframe === 'object') {
      const timeframe = record.timeframe;
      if (timeframe.start) {
        return {
          timestamp: this.parseTimestampValue(timeframe.start),
          fieldName: 'timeframe.start'
        };
      }
      if (timeframe.end) {
        return {
          timestamp: this.parseTimestampValue(timeframe.end),
          fieldName: 'timeframe.end'
        };
      }
    }

    // Use test run end time as fallback
    logger.debug(`No timestamp field found in DQL record, using test run end time`);
    return {
      timestamp: testRunEnd || new Date(),
      fieldName: 'default'
    };
  }

  /**
   * Parse timestamp value from various formats
   */
  private parseTimestampValue(value: any): Date {
    if (typeof value === 'string') {
      return new Date(value);
    } else if (typeof value === 'number') {
      // Assume Unix timestamp in milliseconds
      return new Date(value);
    } else if (typeof value === 'object' && value !== null) {
      // Handle timeframe objects
      if ('start' in value) {
        return new Date(value.start);
      }
      if ('end' in value) {
        return new Date(value.end);
      }
    }

    logger.warn(`Unknown timestamp format: ${value}`);
    return new Date();
  }

  /**
   * Process DQL query results into panel and metrics documents
   */
  async processDynatraceResults(
    queryResults: DynatraceQueryResult[],
    testRunId: string,
    testRunEnd?: Date,
    testRun?: any
  ): Promise<{ panelDocuments: PanelDocument[]; metricsDocuments: PanelMetricsDocument[] }> {
    logger.info(`Processing ${queryResults.length} query results into panel and metrics documents`);

    const panelDocuments: PanelDocument[] = [];
    const metricsDocuments: PanelMetricsDocument[] = [];

    for (const result of queryResults) {
      try {
        // Always create a panel document (even for errors)
        const panelDoc = this.createPanelDocument(result, testRunId);
        panelDocuments.push(panelDoc);

        // Only create metrics document if query succeeded
        if (!result.error) {
          const metricsDoc = this.createMetricsDocumentFromDqlResult(
            result,
            testRunId,
            testRunEnd,
            testRun
          );

          if (metricsDoc) {
            metricsDocuments.push(metricsDoc);
            logger.debug(`Created metrics document for tile ${result.tileId}`);
          }
        } else {
          logger.warn(`Query error for tile ${result.tileId}: ${result.error}`);
        }
      } catch (error) {
        logger.error(`Error processing result for tile ${result.tileId}:`, error);

        // Create error panel document
        const errorPanel = this.createErrorPanelDocument(result, testRunId, error as Error);
        panelDocuments.push(errorPanel);
      }
    }

    logger.info(`Generated ${panelDocuments.length} panel documents and ${metricsDocuments.length} metrics documents`);
    return { panelDocuments, metricsDocuments };
  }

  /**
   * Create panel document from Dynatrace query result
   */
  private createPanelDocument(result: DynatraceQueryResult, testRunId: string): PanelDocument {
    if (!result.panelId) {
      throw new Error(`panelId is required but not configured for tile ${result.tileId}`);
    }

    return {
      test_run_id: testRunId,
      application_dashboard_id: result.applicationDashboardId,
      metrics_source_id: result.metricsSourceId,
      dashboard_uid: result.dashboardLabel,
      panel_id: result.panelId,
      panel_title: result.tileTitle,
      dashboard_label: result.dashboardLabel,
      panel: {
        type: result.visualization,
        title: result.tileTitle,
        id: result.panelId,
        dynatrace: true
      },
      query_variables: {},
      datasource_type: 'dynatrace',
      benchmark_ids: null,
      requests: [],
      errors: result.error ? [{
        target_index: 0,
        message: result.error,
        type: 'DynatraceQueryError'
      }] : null,
      warnings: null
    };
  }

  /**
   * Create error panel document for failed processing
   */
  private createErrorPanelDocument(
    result: DynatraceQueryResult,
    testRunId: string,
    error: Error
  ): PanelDocument {
    if (!result.panelId) {
      throw new Error(`panelId is required but not configured for tile ${result.tileId}`);
    }

    return {
      test_run_id: testRunId,
      application_dashboard_id: result.applicationDashboardId,
      metrics_source_id: result.metricsSourceId,
      dashboard_uid: result.dashboardLabel,
      panel_id: result.panelId,
      panel_title: result.tileTitle,
      dashboard_label: result.dashboardLabel,
      panel: {
        type: result.visualization,
        title: result.tileTitle,
        id: result.panelId,
        dynatrace: true,
        error: error.message
      },
      query_variables: {},
      datasource_type: 'dynatrace',
      benchmark_ids: null,
      requests: [],
      errors: [{
        target_index: 0,
        message: `Processing error: ${error.message}`,
        type: error.constructor.name
      }],
      warnings: null
    };
  }

  /**
   * Create metrics document from DQL query result
   */
  private createMetricsDocumentFromDqlResult(
    result: DynatraceQueryResult,
    testRunId: string,
    testRunEnd?: Date,
    testRun?: any
  ): PanelMetricsDocument | null {
    try {
      const { tileId, tileTitle, result: dqlResult, query, matchMetricPattern, omitGroupByVariableFromMetricName, metricName: explicitMetricName } = result;

      if (matchMetricPattern) {
        logger.info(`Applying metric pattern filter: '${matchMetricPattern}' for tile ${tileId}`);
      }

      // Debug: Log the entire DQL result structure
      logger.info(`📊 Processing DQL/Metrics result for tile ${tileId} (${tileTitle})`);
      logger.debug(`DQL result structure for tile ${tileId}:`, {
        hasResult: !!dqlResult,
        resultKeys: dqlResult ? Object.keys(dqlResult) : [],
        recordsType: dqlResult?.records ? typeof dqlResult.records : 'undefined',
        recordsLength: dqlResult?.records?.length || 0
      });

      // Extract records from DQL result
      const records = dqlResult?.records || [];
      if (records.length === 0) {
        logger.warn(`No records found in DQL result for tile ${tileId}. Full result:`, JSON.stringify(dqlResult, null, 2));
        return null;
      }

      logger.info(`  Found ${records.length} records for tile ${tileId}`);
      logger.debug(`  Sample record (first): ${JSON.stringify(records[0], null, 2)}`);

      // Skip the first record if it's a header/schema record (all values are null)
      let dataRecords = records;
      if (records.length > 0 && Object.values(records[0]).every(v => v === null)) {
        logger.debug(`Skipping header record for tile ${tileId}`);
        dataRecords = records.slice(1);
      }

      if (dataRecords.length === 0) {
        logger.warn(`No data records found after filtering for tile ${tileId}`);
        return null;
      }

      // Convert DQL records to metrics data
      const metricsData: MetricRecord[] = [];

      // Check if query has fieldsAdd operations
      const hasFieldsAdd = this.hasFieldsAdd(query);
      const fieldsAddNames = hasFieldsAdd ? this.parseFieldsAddNames(query) : [];

      for (let i = 0; i < dataRecords.length; i++) {
        const record = dataRecords[i];

        // Parse timestamp
        const { timestamp, fieldName: timestampField } = this.parseTimestamp(record, testRunEnd);

        // Extract grouping field values
        const groupingValues = this.getGroupingFieldValues(record, query);

        // Skip this record if any required grouping fields are missing
        if (groupingValues.length === 0 && this.parseDqlGroupingFields(query).length > 0) {
          logger.warn(`Skipping record ${i} for tile ${tileId} due to missing grouping field values`);
          continue;
        }

        // Create metric name prefix from grouping fields, excluding omitted fields
        let metricPrefix = '';
        if (omitGroupByVariableFromMetricName && omitGroupByVariableFromMetricName.length > 0) {
          const groupingFields = this.parseDqlGroupingFields(query);
          const fieldRenames = this.parseDqlFieldRenames(query);
          const filteredGroupingValues: string[] = [];

          for (let j = 0; j < groupingFields.length; j++) {
            if (j < groupingValues.length) {
              const originalField = groupingFields[j];
              const actualField = fieldRenames[originalField] || originalField;

              if (!omitGroupByVariableFromMetricName.includes(originalField) &&
                  !omitGroupByVariableFromMetricName.includes(actualField)) {
                filteredGroupingValues.push(groupingValues[j]);
              }
            }
          }

          metricPrefix = filteredGroupingValues.join('_');
        } else {
          metricPrefix = groupingValues.join('_');
        }

        // Get metricName value if present (from fieldsAdd metricName = "value")
        const metricNameFromFieldsAdd = record.metricName;

        // Extract metric values from the record
        for (const [fieldName, fieldValue] of Object.entries(record)) {
          // Skip timestamp-related fields
          if (fieldName.startsWith('timestamp') ||
              fieldName.startsWith('timeframe') ||
              fieldName.startsWith('time') ||
              fieldName.startsWith('_time') ||
              fieldName.startsWith('dt.timestamp') ||
              fieldName === timestampField) {
            continue;
          }

          // Skip grouping fields and non-metric fields
          if (this.isGroupingField(fieldName, query) ||
              fieldName === 'timeframe' ||
              fieldName === 'interval') {
            continue;
          }

          // If query has fieldsAdd for metricName, we still want to process timeseries fields
          // Only skip if this is a fieldsAdd field that we're NOT interested in
          // (i.e., skip fieldsAdd metadata fields, but keep timeseries data fields)
          if (hasFieldsAdd && fieldsAddNames.includes(fieldName) && fieldName !== 'metricName') {
            continue;
          }

          // Skip metricName field itself (it's metadata, not data)
          if (fieldName === 'metricName') {
            continue;
          }

          // Skip intermediate DQL operation fields
          if (fieldName.startsWith('valuesOp')) {
            continue;
          }

          // Process field value
          if (fieldValue !== null && fieldValue !== undefined) {
            if (Array.isArray(fieldValue)) {
              // Handle arrays of values (timeseries data)
              const intervalNs = parseInt(String(record.interval || '60000000000'), 10);
              const intervalSeconds = intervalNs / 1_000_000_000;

              // Get start time from timeframe
              let startTime = timestamp;
              if (record.timeframe && typeof record.timeframe === 'object' && record.timeframe.start) {
                startTime = this.parseTimestampValue(record.timeframe.start);
              }

              for (let idx = 0; idx < fieldValue.length; idx++) {
                const value = fieldValue[idx];
                if (typeof value === 'number' && !isNaN(value)) {
                  const pointTimestamp = new Date(startTime.getTime() + idx * intervalSeconds * 1000);

                  // Construct metric name: always include metricPrefix when present to ensure uniqueness
                  // This prevents duplicate keys when multiple series (e.g., network interfaces) return same timestamp
                  const baseMetricName = explicitMetricName || metricNameFromFieldsAdd || fieldName;
                  const metricName = metricPrefix
                    ? `${metricPrefix}_${baseMetricName}`
                    : baseMetricName;

                  // Apply metric pattern filtering
                  if (this.matchesMetricPattern(metricName, matchMetricPattern)) {
                    const { timestep, rampUp } = this.calculateTimestepAndRampUp(pointTimestamp, testRun);

                    metricsData.push({
                      metricName,
                      time: pointTimestamp,
                      timestep,
                      rampUp,
                      value
                    });
                  }
                }
              }
            } else if (typeof fieldValue === 'number' && !isNaN(fieldValue)) {
              // Single numeric value
              // Construct metric name: always include metricPrefix when present to ensure uniqueness
              const baseMetricName = explicitMetricName || metricNameFromFieldsAdd || fieldName;
              const metricName = metricPrefix
                ? `${metricPrefix}_${baseMetricName}`
                : baseMetricName;

              if (this.matchesMetricPattern(metricName, matchMetricPattern)) {
                const { timestep, rampUp } = this.calculateTimestepAndRampUp(timestamp, testRun);

                metricsData.push({
                  metricName,
                  time: timestamp,
                  timestep,
                  rampUp,
                  value: fieldValue
                });
              }
            } else if (typeof fieldValue === 'string') {
              // Try to parse string as number
              const parsedValue = this.parseNumericString(fieldValue);
              if (parsedValue !== null) {
                // Construct metric name (priority: explicit > fieldsAdd > field name)
                const metricName = explicitMetricName
                  ? explicitMetricName
                  : (metricNameFromFieldsAdd
                    ? (metricPrefix ? `${metricPrefix}_${metricNameFromFieldsAdd}` : metricNameFromFieldsAdd)
                    : (metricPrefix ? `${metricPrefix}_${fieldName}` : fieldName));

                if (this.matchesMetricPattern(metricName, matchMetricPattern)) {
                  const { timestep, rampUp } = this.calculateTimestepAndRampUp(timestamp, testRun);

                  metricsData.push({
                    metricName,
                    time: timestamp,
                    timestep,
                    rampUp,
                    value: parsedValue
                  });
                }
              }
            }
          }
        }
      }

      if (metricsData.length === 0) {
        logger.warn(`No metric data extracted from DQL result for tile ${tileId}`);
        return null;
      }

      // Get unique metric names
      const uniqueMetricNames = [...new Set(metricsData.map(m => m.metricName))];

      logger.info(`✅ Created ${metricsData.length} metric data points for tile ${tileId}`);
      logger.info(`  📌 Unique metrics (${uniqueMetricNames.length}): ${uniqueMetricNames.join(', ')}`);
      logger.info(`  📊 Sample data points (first 3): ${JSON.stringify(metricsData.slice(0, 3), null, 2)}`);

      if (!result.panelId) {
        throw new Error(`panelId is required but not configured for tile ${tileId}`);
      }

      return {
        testRunId,
        applicationDashboardId: result.applicationDashboardId,
        metricsSourceId: result.metricsSourceId,
        dashboardUid: 'dynatrace',
        panelId: result.panelId,
        panelTitle: tileTitle,
        dashboardLabel: result.dashboardLabel,
        data: metricsData,
        errors: [],
        benchmarkIds: []
      };
    } catch (error) {
      logger.error(`Error creating metrics document from DQL result:`, error);
      return null;
    }
  }

  /**
   * Parse numeric string (including percentages)
   */
  private parseNumericString(value: string): number | null {
    // Try direct parsing
    const directParse = parseFloat(value);
    if (!isNaN(directParse)) {
      return directParse;
    }

    // Try percentage parsing
    if (value.endsWith('%')) {
      const percentParse = parseFloat(value.slice(0, -1));
      if (!isNaN(percentParse)) {
        return percentParse;
      }
    }

    return null;
  }
}
