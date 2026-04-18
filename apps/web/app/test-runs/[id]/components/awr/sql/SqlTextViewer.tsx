'use client';

/**
 * SQL Text Viewer Component
 *
 * Displays SQL text with formatting, syntax highlighting keywords,
 * copy to clipboard functionality, and expandable view.
 *
 * Features:
 * - Basic SQL keyword highlighting
 * - Copy to clipboard with feedback
 * - Expandable/collapsible view for long SQL
 * - Proper whitespace and indentation handling
 * - Scrollable container with max height
 * - Line numbering option
 *
 * @example
 * ```tsx
 * <SqlTextViewer
 *   sqlText="SELECT * FROM users WHERE active = 1"
 *   sqlId="abc123xyz"
 *   showCopyButton
 *   maxHeight={200}
 * />
 * ```
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  Button,
  _Collapse,
  alpha,
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  Check as CheckIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
} from '@mui/icons-material';
import type { SqlTextViewerProps} from '../types';

// ==================== SQL Keyword Highlighting ====================

/**
 * SQL keywords to highlight
 */
const SQL_KEYWORDS = [
  // DML
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'LIKE', 'BETWEEN',
  'IS', 'NULL', 'TRUE', 'FALSE', 'AS', 'ON', 'USING', 'JOIN', 'LEFT', 'RIGHT',
  'INNER', 'OUTER', 'CROSS', 'FULL', 'NATURAL', 'ORDER', 'BY', 'ASC', 'DESC',
  'NULLS', 'FIRST', 'LAST', 'GROUP', 'HAVING', 'DISTINCT', 'ALL', 'UNION',
  'INTERSECT', 'EXCEPT', 'MINUS', 'LIMIT', 'OFFSET', 'FETCH', 'NEXT', 'ROWS',
  'ONLY', 'WITH', 'RECURSIVE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'MERGE',
  // DDL
  'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'TABLE', 'VIEW', 'INDEX', 'SEQUENCE',
  'TRIGGER', 'FUNCTION', 'PROCEDURE', 'PACKAGE', 'TYPE', 'SCHEMA', 'DATABASE',
  // Transactions
  'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'BEGIN', 'TRANSACTION',
  // PL/SQL
  'DECLARE', 'CURSOR', 'FOR', 'LOOP', 'WHILE', 'IF', 'ELSIF', 'RETURN',
  'RAISE', 'EXCEPTION', 'PRAGMA', 'BULK', 'COLLECT', 'FORALL',
  // Oracle hints
  'HINT', 'PARALLEL', 'FULL', 'INDEX', 'HASH', 'NESTED', 'LOOPS',
  // Aggregate functions
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'LISTAGG', 'XMLAGG',
  // Other
  'OVER', 'PARTITION', 'WINDOW', 'ROW_NUMBER', 'RANK', 'DENSE_RANK',
  'LEAD', 'LAG', 'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE',
  'PIVOT', 'UNPIVOT', 'CONNECT', 'START', 'PRIOR', 'LEVEL',
];

/**
 * SQL data types to highlight
 */
const SQL_TYPES = [
  'VARCHAR', 'VARCHAR2', 'CHAR', 'NVARCHAR', 'NCHAR', 'CLOB', 'NCLOB', 'BLOB',
  'NUMBER', 'INTEGER', 'INT', 'SMALLINT', 'BIGINT', 'DECIMAL', 'NUMERIC',
  'FLOAT', 'DOUBLE', 'REAL', 'BINARY_FLOAT', 'BINARY_DOUBLE',
  'DATE', 'TIMESTAMP', 'INTERVAL', 'TIME', 'DATETIME',
  'BOOLEAN', 'RAW', 'LONG', 'ROWID', 'UROWID', 'XMLTYPE', 'JSON',
];

/**
 * Create keyword regex pattern
 */
function createKeywordPattern(): RegExp {
  const allKeywords = [...SQL_KEYWORDS, ...SQL_TYPES];
  return new RegExp(`\\b(${allKeywords.join('|')})\\b`, 'gi');
}

const KEYWORD_PATTERN = createKeywordPattern();

// ==================== Formatting Helpers ====================

/**
 * Format SQL text for display
 * - Normalize whitespace
 * - Add line breaks after major clauses
 */
function formatSqlText(sql: string, format: boolean = false): string {
  if (!sql) return '';

  // Remove excessive whitespace
  let formatted = sql.replace(/\s+/g, ' ').trim();

  if (format) {
    // Add line breaks after major clauses for better readability
    const breakKeywords = [
      'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER BY', 'GROUP BY',
      'HAVING', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN',
      'OUTER JOIN', 'UNION', 'INTERSECT', 'EXCEPT', 'WITH',
    ];

    for (const keyword of breakKeywords) {
      const regex = new RegExp(`\\s+(${keyword})\\s+`, 'gi');
      formatted = formatted.replace(regex, `\n$1 `);
    }

    // Indent sub-clauses
    formatted = formatted
      .replace(/\nAND\s+/gi, '\n  AND ')
      .replace(/\nOR\s+/gi, '\n  OR ')
      .replace(/\nJOIN/gi, '\n  JOIN')
      .replace(/\nLEFT JOIN/gi, '\n  LEFT JOIN')
      .replace(/\nRIGHT JOIN/gi, '\n  RIGHT JOIN')
      .replace(/\nINNER JOIN/gi, '\n  INNER JOIN');
  }

  return formatted;
}

/**
 * Highlight SQL keywords in text
 */
function highlightSql(sql: string): JSX.Element[] {
  if (!sql) return [];

  const parts: JSX.Element[] = [];
  let lastIndex = 0;
  let key = 0;

  // Find and highlight keywords
  const text = sql;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(KEYWORD_PATTERN.source, 'gi');

  while ((match = pattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(
        <span key={key++}>{text.substring(lastIndex, match.index)}</span>
      );
    }

    // Add highlighted keyword
    const isType = SQL_TYPES.includes(match[0].toUpperCase());
    parts.push(
      <span
        key={key++}
        style={{
          color: isType ? '#9c27b0' : '#1976d2',
          fontWeight: 600,
        }}
      >
        {match[0]}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.substring(lastIndex)}</span>);
  }

  return parts;
}

// ==================== Main Component ====================

/**
 * SQL Text Viewer Component
 *
 * Displays SQL text with optional syntax highlighting and copy functionality.
 */
export function SqlTextViewer({
  sqlText,
  sqlId,
  highlightSyntax = true,
  maxHeight = 300,
  showCopyButton = true,
  showExpandButton = true,
  onSnackbar,
}: SqlTextViewerProps): JSX.Element {
  // State
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [formatted, setFormatted] = useState(true);

  /**
   * Handle copy to clipboard
   */
  const handleCopy = useCallback(async (): Promise<void> => {
    if (!sqlText) return;

    try {
      await navigator.clipboard.writeText(sqlText);
      setCopied(true);
      onSnackbar?.('SQL copied to clipboard', 'success');

      // Reset copied state after 2 seconds
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onSnackbar?.('Failed to copy SQL', 'error');
    }
  }, [sqlText, onSnackbar]);

  /**
   * Toggle expanded state
   */
  const handleToggleExpand = useCallback((): void => {
    setExpanded((prev) => !prev);
  }, []);

  /**
   * Toggle format mode
   */
  const handleToggleFormat = useCallback((): void => {
    setFormatted((prev) => !prev);
  }, []);

  /**
   * Memoized processed SQL text
   */
  const processedSql = useMemo((): string => {
    return formatSqlText(sqlText || '', formatted);
  }, [sqlText, formatted]);

  /**
   * Memoized highlighted content
   */
  const _highlightedContent = useMemo((): JSX.Element | JSX.Element[] => {
    if (highlightSyntax) {
      return highlightSql(processedSql);
    }
    return <span>{processedSql}</span>;
  }, [processedSql, highlightSyntax]);

  // Check if SQL is long enough to need expansion
  const isLongSql = sqlText && sqlText.length > 2000;
  const displayedSql = !expanded && isLongSql
    ? processedSql.substring(0, 2000)
    : processedSql;

  // No SQL text
  if (!sqlText) {
    return (
      <Box
        sx={{
          p: 2,
          borderRadius: 1,
          backgroundColor: alpha('#9e9e9e', 0.08),
          border: `1px dashed ${alpha('#9e9e9e', 0.3)}`,
          textAlign: 'center',
        }}
      >
        <Typography variant="body2" color="text.secondary">
          SQL text not available
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        position: 'relative',
        borderRadius: 1,
        border: `1px solid ${alpha('#1976d2', 0.2)}`,
        backgroundColor: alpha('#1976d2', 0.02),
        overflow: 'hidden',
      }}
    >
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.5,
          py: 0.75,
          borderBottom: `1px solid ${alpha('#1976d2', 0.1)}`,
          backgroundColor: alpha('#1976d2', 0.04),
        }}
      >
        {/* SQL ID */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {sqlId && (
            <Typography
              variant="caption"
              sx={{
                fontFamily: 'monospace',
                fontWeight: 500,
                color: 'primary.main',
              }}
            >
              {sqlId}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            {sqlText.length.toLocaleString()} chars
          </Typography>
        </Box>

        {/* Actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {/* Format toggle */}
          <Tooltip title={formatted ? 'Show raw' : 'Format SQL'}>
            <Button
              size="small"
              variant="text"
              onClick={handleToggleFormat}
              sx={{
                minWidth: 'auto',
                px: 1,
                py: 0.25,
                fontSize: '0.7rem',
                color: formatted ? 'primary.main' : 'text.secondary',
              }}
            >
              {formatted ? 'Raw' : 'Format'}
            </Button>
          </Tooltip>

          {/* Copy button */}
          {showCopyButton && (
            <Tooltip title={copied ? 'Copied!' : 'Copy SQL'}>
              <IconButton
                size="small"
                onClick={handleCopy}
                aria-label="Copy SQL to clipboard"
                sx={{
                  color: copied ? 'success.main' : 'text.secondary',
                }}
              >
                {copied ? (
                  <CheckIcon sx={{ fontSize: 16 }} />
                ) : (
                  <CopyIcon sx={{ fontSize: 16 }} />
                )}
              </IconButton>
            </Tooltip>
          )}

          {/* Expand button */}
          {showExpandButton && isLongSql && (
            <Tooltip title={expanded ? 'Collapse' : 'Expand'}>
              <IconButton
                size="small"
                onClick={handleToggleExpand}
                aria-expanded={expanded}
                aria-label={expanded ? 'Collapse SQL' : 'Expand SQL'}
                sx={{ color: 'text.secondary' }}
              >
                {expanded ? (
                  <FullscreenExitIcon sx={{ fontSize: 16 }} />
                ) : (
                  <FullscreenIcon sx={{ fontSize: 16 }} />
                )}
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* SQL Content */}
      <Box
        sx={{
          p: 1.5,
          maxHeight: expanded ? 'none' : maxHeight,
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: '0.75rem',
          lineHeight: 1.6,
          color: 'text.primary',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          '&::-webkit-scrollbar': {
            width: 8,
            height: 8,
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: alpha('#1976d2', 0.2),
            borderRadius: 4,
            '&:hover': {
              backgroundColor: alpha('#1976d2', 0.3),
            },
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: alpha('#1976d2', 0.05),
          },
        }}
        role="region"
        aria-label="SQL text"
      >
        {highlightSyntax ? (
          highlightSql(displayedSql)
        ) : (
          <span>{displayedSql}</span>
        )}
        {!expanded && isLongSql && (
          <Box
            component="span"
            sx={{
              display: 'inline-block',
              ml: 1,
              px: 1,
              py: 0.25,
              borderRadius: 0.5,
              backgroundColor: alpha('#1976d2', 0.1),
              border: `1px solid ${alpha('#1976d2', 0.2)}`,
            }}
          >
            <Typography
              component="span"
              variant="caption"
              sx={{
                color: 'primary.main',
                fontWeight: 600,
                fontSize: '0.7rem',
              }}
            >
              +{((sqlText.length - 2000) / 1000).toFixed(1)}K chars truncated - click expand below to see full SQL
            </Typography>
          </Box>
        )}
      </Box>

      {/* Expand/Collapse bar for long SQL */}
      {isLongSql && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            py: 0.5,
            borderTop: `1px solid ${alpha('#1976d2', 0.1)}`,
            backgroundColor: alpha('#1976d2', 0.04),
            cursor: 'pointer',
            '&:hover': {
              backgroundColor: alpha('#1976d2', 0.08),
            },
          }}
          onClick={handleToggleExpand}
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse SQL text' : 'Expand SQL text'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleToggleExpand();
            }
          }}
        >
          {expanded ? (
            <>
              <CollapseIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                Show less
              </Typography>
            </>
          ) : (
            <>
              <ExpandIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                Show more ({((sqlText.length - 2000) / 1000).toFixed(1)}K more characters)
              </Typography>
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

// Default export
export default SqlTextViewer;
