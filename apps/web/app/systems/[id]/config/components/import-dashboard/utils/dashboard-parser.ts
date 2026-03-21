/**
 * Utility functions for parsing Dynatrace dashboard JSON files
 */

import { DashboardTile, ParseResult, SUPPORTED_VISUALIZATION_TYPES } from '../types';

/**
 * Extract template variables from a metric selector query
 * Variables are denoted by $variableName pattern
 */
export const extractVariablesFromQuery = (query: string): string[] => {
  const variableRegex = /\$(\w+)/g;
  const variables: string[] = [];
  let match;

  while ((match = variableRegex.exec(query)) !== null) {
    const variable = match[1];
    if (!variables.includes(variable)) {
      variables.push(variable);
    }
  }

  return variables;
};

/**
 * Parse Dynatrace classic dashboard format (array of tiles)
 */
const parseDynatraceClassicFormat = (
  tiles: unknown[],
  extractVariables: (query: string) => string[]
): { tiles: DashboardTile[]; variables: Set<string> } => {
  const parsedTiles: DashboardTile[] = [];
  const allVars = new Set<string>();

  tiles.forEach((tile: unknown, index: number) => {
    const tileData = tile as Record<string, unknown>;

    // Check if this is a DATA_EXPLORER tile with queries
    if (
      tileData.tileType === 'DATA_EXPLORER' &&
      tileData.queries &&
      Array.isArray(tileData.queries)
    ) {
      // Get visualization type from visualConfig
      const visualConfig = tileData.visualConfig as Record<string, unknown> | undefined;
      const visualType = visualConfig?.type as string | undefined;

      // Only process supported visualization types
      if (visualType && SUPPORTED_VISUALIZATION_TYPES.includes(visualType as typeof SUPPORTED_VISUALIZATION_TYPES[number])) {
        // Process each query in the tile
        (tileData.queries as unknown[]).forEach((query: unknown, queryIndex: number) => {
          const queryData = query as Record<string, unknown>;
          if (queryData.metricSelector) {
            const variables = extractVariables(queryData.metricSelector as string);
            const tileName = (tileData.customName || tileData.name || `Tile ${index + 1}`) as string;
            const queryId = (queryData.id || queryIndex) as string | number;

            const dashboardTile: DashboardTile = {
              id: `tile-${index}-query-${queryId}`,
              title: `${tileName} - Query ${typeof queryId === 'number' ? queryId + 1 : queryId}`,
              query: queryData.metricSelector as string,
              visualization: visualType.toLowerCase().replace('_', ''),
              variables,
              selected: true,
            };

            parsedTiles.push(dashboardTile);
            variables.forEach(v => allVars.add(v));
          }
        });
      }
    }
  });

  return { tiles: parsedTiles, variables: allVars };
};

/**
 * Parse custom dashboard format (object with tile IDs as keys)
 */
const parseCustomFormat = (
  tiles: Record<string, unknown>,
  extractVariables: (query: string) => string[]
): { tiles: DashboardTile[]; variables: Set<string> } => {
  const parsedTiles: DashboardTile[] = [];
  const allVars = new Set<string>();

  Object.entries(tiles).forEach(([tileId, tile]) => {
    const tileData = tile as Record<string, unknown>;
    const visualization = tileData.visualization as string;

    if (
      tileData.type === 'data' &&
      (visualization === 'areaChart' || visualization === 'lineChart') &&
      tileData.query
    ) {
      const variables = extractVariables(tileData.query as string);
      const dashboardTile: DashboardTile = {
        id: tileId,
        title: (tileData.title as string) || `Tile ${tileId}`,
        query: tileData.query as string,
        visualization,
        variables,
        selected: true,
      };

      parsedTiles.push(dashboardTile);
      variables.forEach(v => allVars.add(v));
    }
  });

  return { tiles: parsedTiles, variables: allVars };
};

/**
 * Parse a dashboard JSON file and extract compatible tiles
 */
export const parseDashboardFile = (fileContent: string): ParseResult => {
  try {
    const dashboard = JSON.parse(fileContent) as Record<string, unknown>;

    if (!dashboard.tiles) {
      return {
        tiles: [],
        variables: [],
        error: 'Invalid dashboard file: missing tiles property',
      };
    }

    let result: { tiles: DashboardTile[]; variables: Set<string> };

    // Handle both classic Dynatrace format (array) and custom format (object)
    if (Array.isArray(dashboard.tiles)) {
      // Dynatrace classic dashboard format
      result = parseDynatraceClassicFormat(dashboard.tiles, extractVariablesFromQuery);
    } else {
      // Custom dashboard format (object with tile IDs as keys)
      result = parseCustomFormat(
        dashboard.tiles as Record<string, unknown>,
        extractVariablesFromQuery
      );
    }

    if (result.tiles.length === 0) {
      return {
        tiles: [],
        variables: [],
        error:
          'No compatible tiles with metric queries found in the dashboard. Supported formats: Dynatrace DATA_EXPLORER tiles with metricSelector queries, or custom tiles with DQL queries.',
      };
    }

    return {
      tiles: result.tiles,
      variables: Array.from(result.variables),
    };
  } catch (err) {
    const errorMessage =
      err && typeof err === 'object' && 'message' in err
        ? (err as Error).message
        : 'Failed to parse dashboard file';
    return {
      tiles: [],
      variables: [],
      error: errorMessage,
    };
  }
};

/**
 * Initialize variable values with empty strings
 */
export const initializeVariableValues = (
  variables: string[]
): Record<string, string> => {
  const initialValues: Record<string, string> = {};
  variables.forEach(variable => {
    initialValues[variable] = '';
  });
  return initialValues;
};
