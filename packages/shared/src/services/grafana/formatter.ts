import { PanelMetricsDocument, MetricsRecord, Logger, ConsoleLogger } from './types';
import { ProcessedPanelResult } from './batching';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _logger: Logger = new ConsoleLogger('grafana-formatter');

/**
 * Transform Grafana Response to Metrics
 * Replicates Python's data transformation pipeline from format_result.py:58-100
 *
 * Key transformations:
 * 1. Convert millisecond timestamps to Date objects
 * 2. Remove string columns, keep only numeric data
 * 3. Transform wide format to long format (pandas melt equivalent)
 * 4. Sort and deduplicate data
 */
export async function transformGrafanaResponseToMetrics(
  queryResults: ProcessedPanelResult[],
  testRun?: any
): Promise<PanelMetricsDocument[]> {
  const results: PanelMetricsDocument[] = [];

  for (const queryResult of queryResults) {
    try {
      // Handle panels with errors - create empty metrics document
      if (queryResult.errors || !queryResult.data) {
        results.push(createEmptyMetricsDocument(queryResult.panel, queryResult.errors));
        continue;
      }

      // Transform successful responses
      const metricsData = await transformPanelData(queryResult, testRun);

      if (metricsData && metricsData.length > 0) {
        const panelDocument = {
          test_run_id: queryResult.panel.test_run_id,
          application_dashboard_id: queryResult.panel.application_dashboard_id,
          metrics_source_id: queryResult.panel.metrics_source_id,
          dashboard_uid: queryResult.panel.dashboard_uid,
          panel_id: queryResult.panel.panel_id,
          panel_title: queryResult.panel.panel_title,
          dashboard_label: queryResult.panel.dashboard_label,
          benchmark_ids: queryResult.panel.benchmark_ids,
          errors: null,
          data: metricsData,
          updated_at: new Date()
        };

        results.push(panelDocument);
      } else {
        // No data returned - create empty document
        results.push(createEmptyMetricsDocument(queryResult.panel, null));
      }
    } catch (error) {
      results.push(createEmptyMetricsDocument(queryResult.panel, [{
        target_index: 0,
        message: `Transformation error: ${error}`,
        type: 'transformationError'
      }]));
    }
  }

  return results;
}

/**
 * Transform individual panel data from Grafana response format to metrics records
 * Replicates Python's query_response_to_dataframe function (format_result.py:58-111)
 */
async function transformPanelData(queryResult: ProcessedPanelResult, testRun?: any): Promise<MetricsRecord[]> {
  const prometheusResponse = queryResult.data;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _panelId = queryResult.panel.panel_id;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _datasourceType = queryResult.panel.datasource_type;

  // Extract unit from panel configuration - exact Python logic (format_result.py:144-151)
  // Python: hasattr(panel_query_response, 'panel') and panel_query_response.panel
  const databasePanel = queryResult.panel.panel; // This is the JSONB panel field from ds_panels table
  let unit: string | null = null;

  // Python equivalent: field_config = getattr(panel_query_response.panel, 'fieldConfig', {})
  if (databasePanel && typeof databasePanel === 'object') {
    const fieldConfig = databasePanel.fieldConfig;
    if (fieldConfig && typeof fieldConfig === 'object') {
      const defaults = fieldConfig.defaults;
      if (defaults && typeof defaults === 'object') {
        unit = defaults.unit || null;
      }
    }
  }

  if (!prometheusResponse?.results || Object.keys(prometheusResponse.results).length === 0) {
    return [];
  }

  const allFrames: any[] = [];

  // Extract frames from all result keys (refIds)

  for (const [refId, result] of Object.entries(prometheusResponse.results)) {
    if (!result || typeof result !== 'object') {
      continue;
    }

    const resultData = result as any;

    // Check for frames in the result
    if (resultData.frames && Array.isArray(resultData.frames)) {
      for (const frame of resultData.frames) {
        if (frame && typeof frame === 'object') {
          allFrames.push({ ...frame, refId }); // Include refId for tracking
        }
      }
    }
    // No frames found - skip
  }

  if (allFrames.length === 0) {
    return [];
  }

  // Transform each frame to tabular data
  const transformedFrames: any[][] = [];

  for (const frame of allFrames) {
    try {
      const dataFrame = createDataFrameFromFrames(frame);

      if (dataFrame.length > 0) {
        // Remove string columns (keep only numeric data) - Python behavior
        const cleanedFrame = removeStringColumns(dataFrame, frame);

        if (cleanedFrame.length > 0 && cleanedFrame[0] && Object.keys(cleanedFrame[0]).length > 1) {
          // Transform timestamps from milliseconds to Date objects
          const timestampTransformed = transformTimestamps(cleanedFrame);

          // Apply Python's astype(object).pipe(lambda d: d.where(d.notnull(), None)) logic
          const normalizedFrame = timestampTransformed.map(row => {
            const normalizedRow: any = {};
            for (const [key, value] of Object.entries(row)) {
              if (value instanceof Date) {
                normalizedRow[key] = value;
              } else if (typeof value === 'number' && isNaN(value)) {
                normalizedRow[key] = null;
              } else if (value === undefined) {
                normalizedRow[key] = null;
              } else {
                normalizedRow[key] = value;
              }
            }
            return normalizedRow;
          });

          transformedFrames.push(normalizedFrame);
        }
      }
    } catch (frameError) {
      continue;
    }
  }

  if (transformedFrames.length === 0) {
    return [];
  }

  // Combine all frames and reshape to long format (pandas melt equivalent)
  const combinedData = transformedFrames.flat();

  // Use passed test run info for timestep calculation
  const longFormatData = convertToLongFormat(combinedData, unit, testRun);

  // Sort and deduplicate (Python behavior)
  const sortedData = sortAndDeduplicate(longFormatData);

  // CRITICAL: Check and drop nulls in last item (Python format_result.py:98-99)
  // Python: if df_long.iloc[-1]["value"] is None: df_long = df_long[:-1]
  if (sortedData.length > 0) {
    const lastItem = sortedData[sortedData.length - 1];
    if (lastItem.value === null || lastItem.value === undefined) {
      sortedData.pop(); // Remove last item if value is null
    }
  }

  return sortedData;
}

/**
 * Create DataFrame-like structure from Grafana frames
 * Replicates Python's create_dataframe_from_frames logic
 */
function createDataFrameFromFrames(frame: any): any[] {
  // EXACTLY match Python implementation: format_result.py:52-55
  // Python: pd.DataFrame(dict(zip(get_columns_from_frame(frames), frames["data"]["values"])))

  if (!frame.schema?.fields || !frame.data?.values) {
    return [];
  }

  const fields = frame.schema.fields;
  const values = frame.data.values;

  // Ensure we have matching field and value arrays
  if (!Array.isArray(fields) || !Array.isArray(values) || fields.length !== values.length) {
    return [];
  }

  // Get column names using EXACT Python logic from get_columns_from_frame
  const columnNames = fields.map(field => {
    // Python: field["config"]["displayNameFromDS"] if "config" in field.keys() and "displayNameFromDS" in field["config"] else field["name"]
    return (field.config && field.config.displayNameFromDS) ? field.config.displayNameFromDS : field.name;
  });

  // Get the length of data (should be same for all columns)
  const dataLength = values[0]?.length || 0;
  if (dataLength === 0) {
    return [];
  }

  // Convert columnar data to row-based data - mimicking pandas DataFrame creation
  const rows: any[] = [];
  for (let rowIndex = 0; rowIndex < dataLength; rowIndex++) {
    const row: any = {};

    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
      const fieldName = columnNames[fieldIndex];
      const value = values[fieldIndex]?.[rowIndex];
      row[fieldName] = value;
    }

    rows.push(row);
  }

  return rows;
}

/**
 * Remove string columns from DataFrame (keep only numeric data)
 * Replicates Python's string column filtering logic
 */
function removeStringColumns(dataFrame: any[], frame: any): any[] {
  // EXACTLY match Python implementation: format_result.py:71-82
  if (!frame.schema?.fields) {
    return dataFrame;
  }

  // Python logic: Find string column indices based on schema field types
  const stringColumnIndices: number[] = [];
  for (let i = 0; i < frame.schema.fields.length; i++) {
    const schemaField = frame.schema.fields[i];
    if (schemaField.type && schemaField.type.toLowerCase() === 'string') {
      stringColumnIndices.push(i);
    }
  }

  if (stringColumnIndices.length === 0) {
    return dataFrame;
  }

  // Get column names using same logic as createDataFrameFromFrames
  const columnNames = frame.schema.fields.map((field: any) => {
    return (field.config && field.config.displayNameFromDS) ? field.config.displayNameFromDS : field.name;
  });

  // Get string column names based on indices
  const stringColumns = stringColumnIndices.map(i => columnNames[i]);

  // Filter out string columns - Python: df_from_frames.drop(columns=string_columns)
  return dataFrame.map(row => {
    const filteredRow: any = {};
    for (const [key, value] of Object.entries(row)) {
      if (!stringColumns.includes(key)) {
        filteredRow[key] = value;
      }
    }
    return filteredRow;
  });
}

/**
 * Transform timestamps from milliseconds to Date objects
 * Replicates Python's transform_dataframe_timestamps function
 */
function transformTimestamps(dataFrame: any[]): any[] {
  return dataFrame.map(row => {
    const transformedRow: any = {};

    for (const [key, value] of Object.entries(row)) {
      if (key.toLowerCase() === 'time' && typeof value === 'number') {
        // Convert from milliseconds to Date object (Python: fromtimestamp(x / 1000.0))
        transformedRow.time = new Date(value);
      } else {
        transformedRow[key] = value;
      }
    }

    return transformedRow;
  });
}

/**
 * Convert wide format to long format (equivalent to pandas melt)
 * Replicates Python's DataFrame.melt operation (format_result.py:92-93)
 */
function convertToLongFormat(dataFrame: any[], unit?: string | null, testRun?: any): MetricsRecord[] {
  const longFormatData: MetricsRecord[] = [];

  for (const row of dataFrame) {
    const { time, ...metrics } = row;

    // Convert each metric column to a separate record - Python: df_wide.melt(ignore_index=False, var_name="metric_name")
    for (const [metricName, value] of Object.entries(metrics)) {
      // Allow null values in intermediate processing (Python keeps nulls until final cleanup)
      if (value !== undefined) {
        const recordTime = time || new Date();

        // Calculate timestep and ramp_up using add_metric_metadata_to_dataframe logic
        let timestep: number | null = null;
        let ramp_up = false;

        if (testRun && testRun.start_time) {
          const startTime = new Date(testRun.start_time);
          timestep = (recordTime.getTime() - startTime.getTime()) / 1000; // seconds since test start

          const rampUpSeconds = testRun.ramp_up || 0;
          ramp_up = timestep < rampUpSeconds;
        }

        // Add unit field to each record (Python format_result.py:160-161)
        longFormatData.push({
          metric_name: metricName,
          time: recordTime,
          timestep: timestep,
          ramp_up: ramp_up,
          value: value as number, // Keep null values for now, will be cleaned later
          unit: unit || null
        });
      }
    }
  }

  return longFormatData;
}

/**
 * Sort and deduplicate data
 * Replicates Python's sort_values and drop_duplicates operations
 */
function sortAndDeduplicate(data: MetricsRecord[]): MetricsRecord[] {
  // Sort by metric_name, time, value (Python behavior)
  const sorted = data.sort((a, b) => {
    // First sort by metric name
    if (a.metric_name !== b.metric_name) {
      return a.metric_name.localeCompare(b.metric_name);
    }

    // Then by time
    const timeA = a.time.getTime();
    const timeB = b.time.getTime();
    if (timeA !== timeB) {
      return timeA - timeB;
    }

    // Finally by value
    return (a.value || 0) - (b.value || 0);
  });

  // Deduplicate based on time and metric_name (Python behavior)
  const deduplicated: MetricsRecord[] = [];
  const seen = new Set<string>();

  for (const record of sorted) {
    const key = `${record.time.toISOString()}|${record.metric_name}`;

    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(record);
    }
  }

  return deduplicated;
}

function createEmptyMetricsDocument(
  panel: any,
  errors: any[] | null
): PanelMetricsDocument {
  return {
    test_run_id: panel.test_run_id,
    application_dashboard_id: panel.application_dashboard_id,
    metrics_source_id: panel.metrics_source_id,
    dashboard_uid: panel.dashboard_uid,
    panel_id: panel.panel_id,
    panel_title: panel.panel_title,
    dashboard_label: panel.dashboard_label,
    benchmark_ids: panel.benchmark_ids,
    errors: errors,
    data: [],
    updated_at: new Date()
  };
}
