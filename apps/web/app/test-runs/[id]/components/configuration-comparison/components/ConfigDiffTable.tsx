'use client';

import React, { useRef } from 'react';
import { useScrollParentVirtualizer } from '@/hooks/useScrollParentVirtualizer';
import {
  Box,
  Typography,
  Chip,
  IconButton,
} from '@mui/material';
import {
  Flag,
  FlagOutlined,
  GitHub,
} from '@mui/icons-material';
import { ConfigDiffTableProps, ConfigComparison } from '../types';
import { getEffectiveTags } from '../utils/comparison-formatters';

/**
 * Get background color for a comparison row based on status
 */
const getRowBackgroundColor = (status: string, index: number): string => {
  switch (status) {
    case 'changed':
      return 'rgba(255, 193, 7, 0.1)';
    case 'expected':
      return 'rgba(33, 150, 243, 0.1)';
    case 'new':
      return 'rgba(76, 175, 80, 0.1)';
    case 'removed':
      return 'rgba(244, 67, 54, 0.1)';
    default:
      return index % 2 === 0 ? 'action.hover' : 'transparent';
  }
};

/**
 * Get hover background color for a comparison row based on status
 */
const getRowHoverColor = (status: string): string => {
  switch (status) {
    case 'changed':
      return 'rgba(255, 193, 7, 0.2)';
    case 'expected':
      return 'rgba(33, 150, 243, 0.2)';
    case 'new':
      return 'rgba(76, 175, 80, 0.2)';
    case 'removed':
      return 'rgba(244, 67, 54, 0.2)';
    default:
      return 'action.selected';
  }
};

/**
 * Get status chip background color
 */
const getStatusChipColor = (status: string): string => {
  switch (status) {
    case 'changed':
      return 'warning.main';
    case 'expected':
      return 'info.main';
    case 'new':
      return 'success.main';
    case 'removed':
      return 'error.main';
    default:
      return 'grey.500';
  }
};

/**
 * Get status chip label
 */
const getStatusLabel = (status: string): string => {
  switch (status) {
    case 'changed':
      return 'CHG';
    case 'expected':
      return 'IGN';
    case 'new':
      return 'NEW';
    case 'removed':
      return 'DEL';
    default:
      return 'SAME';
  }
};

interface ConfigDiffRowProps {
  comparison: ConfigComparison;
  index: number;
  testRunConfigs: { key: string; tags?: string[] }[];
  expectedChangesLoading: boolean;
  onToggleExpectedChange: (configKey: string, isExpected: boolean) => void;
  /** Virtualiser callback ref; measures this row's real height after wrapping. */
  measureRef?: (el: HTMLElement | null) => void;
  /** Index the virtualiser keys its measurement cache on. */
  dataIndex?: number;
}

/**
 * Single row in the config diff table
 */
function ConfigDiffRow({
  comparison,
  index,
  testRunConfigs,
  expectedChangesLoading,
  onToggleExpectedChange,
  measureRef,
  dataIndex,
}: ConfigDiffRowProps) {
  const effectiveTags = getEffectiveTags(comparison);
  const config = testRunConfigs.find(c => c.key === comparison.key);
  const hasGitHubTag = config?.tags?.some(tag => tag.toLowerCase() === 'github');
  const hasValuesDiff = comparison.currentValue !== comparison.previousValue && comparison.previousValue !== null;

  return (
    <Box
      ref={measureRef}
      data-index={dataIndex}
      sx={{
        // Subgrid rather than the original `display: contents`: a contents row
        // generates no box, so the virtualiser would have nothing to attach its
        // measuring ref to. Subgrid gives the row a real box while keeping the
        // five columns aligned to the parent grid exactly as before.
        //
        // Deliberately NOT content-visibility here. It would report the
        // contain-intrinsic-size placeholder for any row scrolled out of view,
        // and measureElement would cache that instead of the row's real height -
        // which is exactly what the virtualiser needs to get right for rows whose
        // config values wrap.
        display: 'grid',
        gridColumn: '1 / -1',
        gridTemplateColumns: 'subgrid',
        '& > *': {
          backgroundColor: getRowBackgroundColor(comparison.status, index),
          borderTop: '1px solid',
          borderColor: 'divider',
          '&:hover': {
            backgroundColor: getRowHoverColor(comparison.status),
          },
        },
      }}
    >
      {/* Key Column */}
      <Box sx={{ p: 2, borderRight: '1px solid', borderColor: 'divider' }}>
        <Typography
          variant="body2"
          sx={{
            fontWeight: 500,
            color: 'text.primary',
            mb: 1,
            wordBreak: 'break-word',
            lineHeight: 1.4,
          }}
        >
          {comparison.key}
        </Typography>
        {effectiveTags.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
            {effectiveTags.map((tag, tagIndex) => (
              <Chip
                key={tagIndex}
                label={tag}
                sx={{
                  height: '20px',
                  fontWeight: 600,
                  backdropFilter: 'blur(8px)',
                  transition: 'all 0.2s ease',
                  background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)',
                  border: '1px solid rgba(25, 118, 210, 0.3)',
                  color: 'primary.main',
                  '&:hover': {
                    transform: 'translateY(-1px)',
                    boxShadow: '0 4px 12px rgba(25, 118, 210, 0.2)',
                    border: '1px solid rgba(25, 118, 210, 0.5)',
                  },
                  '& .MuiChip-label': {
                    px: 0.75,
                    py: 0,
                    fontSize: '0.7rem',
                  },
                }}
              />
            ))}
          </Box>
        )}
      </Box>

      {/* Baseline Value Column */}
      <Box sx={{ p: 2, borderRight: '1px solid', borderColor: 'divider' }}>
        {comparison.previousValue !== null ? (
          <Typography
            variant="body2"
            sx={{
              fontFamily: 'monospace',
              color: comparison.status === 'removed' ? 'text.disabled' : 'text.secondary',
              fontSize: '0.875rem',
              wordBreak: 'break-all',
              lineHeight: 1.4,
              whiteSpace: 'pre-wrap',
              textDecoration: comparison.status === 'removed' ? 'line-through' : 'none',
            }}
          >
            {comparison.previousValue}
          </Typography>
        ) : (
          <Typography
            variant="body2"
            sx={{
              color: 'text.disabled',
              fontStyle: 'italic',
            }}
          >
            (not present)
          </Typography>
        )}
      </Box>

      {/* Current Value Column */}
      <Box sx={{ p: 2, borderRight: '1px solid', borderColor: 'divider' }}>
        {comparison.currentValue !== null ? (
          <Box>
            <Typography
              variant="body2"
              sx={{
                fontFamily: 'monospace',
                color: 'text.primary',
                fontSize: '0.875rem',
                wordBreak: 'break-all',
                lineHeight: 1.4,
                whiteSpace: 'pre-wrap',
              }}
            >
              {comparison.currentValue}
            </Typography>
            {hasGitHubTag && hasValuesDiff && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  mt: 0.5,
                }}
              >
                <IconButton
                  size="small"
                  sx={{
                    padding: '2px',
                    '&:hover': {
                      backgroundColor: 'action.hover',
                    },
                  }}
                  href={`${comparison.key}/compare/${comparison.previousValue}...${comparison.currentValue}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  component="a"
                  title="View diff in GitHub"
                >
                  <GitHub sx={{ fontSize: '14px' }} />
                </IconButton>
                <Typography
                  component="a"
                  href={`${comparison.key}/compare/${comparison.previousValue}...${comparison.currentValue}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{
                    fontSize: '0.75rem',
                    color: 'primary.main',
                    textDecoration: 'none',
                    '&:hover': {
                      textDecoration: 'underline',
                    },
                  }}
                >
                  View diff on GitHub
                </Typography>
              </Box>
            )}
          </Box>
        ) : (
          <Typography
            variant="body2"
            sx={{
              color: 'text.disabled',
              fontStyle: 'italic',
            }}
          >
            (not present)
          </Typography>
        )}
      </Box>

      {/* Status Column */}
      <Box sx={{ p: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Chip
          label={getStatusLabel(comparison.status)}
          size="small"
          sx={{
            height: '20px',
            fontSize: '0.65rem',
            minWidth: '50px',
            backgroundColor: getStatusChipColor(comparison.status),
            color: 'white',
            fontWeight: 600,
            '& .MuiChip-label': {
              px: 1,
            },
          }}
        />
      </Box>

      {/* Flag Column */}
      <Box sx={{ p: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <IconButton
          size="small"
          onClick={() => onToggleExpectedChange(comparison.key, comparison.isExpected || false)}
          disabled={expectedChangesLoading}
          sx={{
            padding: '4px',
            color: comparison.isExpected ? 'info.main' : 'text.disabled',
            '&:hover': {
              backgroundColor: 'action.hover',
            },
          }}
        >
          {comparison.isExpected ? <Flag fontSize="small" /> : <FlagOutlined fontSize="small" />}
        </IconButton>
      </Box>
    </Box>
  );
}

/**
 * Table displaying configuration comparisons between test runs
 */
export function ConfigDiffTable({
  comparisons,
  selectedRelatedTestRun,
  testRunConfigs,
  expectedChangesLoading,
  onToggleExpectedChange,
}: ConfigDiffTableProps) {
  // Window-virtualised: a run with a few hundred config changes used to mount
  // every row up front, which is what made expanding this card block the main
  // thread for over a second. Only the rows near the viewport are rendered; the
  // rest are represented by two spacer rows so the grid keeps its full height
  // and the page scrollbar does not jump.
  //
  // The virtualiser measures rows rather than assuming a height, because a long
  // config value wraps and a short one does not. estimateSize is only the
  // first guess before measureElement corrects it.
  const parentRef = useRef<HTMLDivElement>(null);
  const { rows: virtualRows, padTop: paddingTop, padBottom: paddingBottom } =
    useScrollParentVirtualizer({
      parentRef,
      count: comparisons.length,
      estimateSize: 57,
      overscan: 8,
    });

  return (
    <Box
      ref={parentRef}
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        display: 'grid',
        gridTemplateColumns: 'minmax(150px, 1fr) minmax(100px, 1fr) minmax(100px, 1fr) 80px 60px',
        width: '100%',
      }}
    >
      {/* Header Row */}
      <Box
        sx={{
          display: 'contents',
          fontWeight: 600,
          borderBottom: '2px solid',
          borderColor: 'divider',
        }}
      >
        <Typography
          variant="subtitle2"
          sx={{ p: 2, fontWeight: 600, borderBottom: '2px solid', borderColor: 'divider' }}
        >
          Configuration Key
        </Typography>
        <Typography
          variant="subtitle2"
          sx={{ p: 2, fontWeight: 600, borderBottom: '2px solid', borderColor: 'divider' }}
        >
          {selectedRelatedTestRun ? `Baseline Value (${selectedRelatedTestRun})` : 'Baseline Value'}
        </Typography>
        <Typography
          variant="subtitle2"
          sx={{ p: 2, fontWeight: 600, borderBottom: '2px solid', borderColor: 'divider' }}
        >
          Current Value
        </Typography>
        <Typography
          variant="subtitle2"
          sx={{
            p: 2,
            fontWeight: 600,
            borderBottom: '2px solid',
            borderColor: 'divider',
            textAlign: 'center',
          }}
        >
          Status
        </Typography>
        <Typography
          variant="subtitle2"
          sx={{
            p: 2,
            fontWeight: 600,
            borderBottom: '2px solid',
            borderColor: 'divider',
            textAlign: 'center',
          }}
        >
          Ignore
        </Typography>
      </Box>

      {/* Data Rows (virtualised — spacers keep the grid's full scroll height) */}
      {paddingTop > 0 && <Box sx={{ gridColumn: '1 / -1', height: `${paddingTop}px` }} />}
      {virtualRows.map((virtualRow) => {
        const comparison = comparisons[virtualRow.index];
        if (!comparison) return null;
        return (
          <ConfigDiffRow
            key={`${comparison.key}-${getEffectiveTags(comparison).join(',')}-${virtualRow.index}`}
            comparison={comparison}
            index={virtualRow.index}
            testRunConfigs={testRunConfigs}
            expectedChangesLoading={expectedChangesLoading}
            onToggleExpectedChange={onToggleExpectedChange}
            measureRef={virtualRow.measureRef}
            dataIndex={virtualRow.index}
          />
        );
      })}
      {paddingBottom > 0 && <Box sx={{ gridColumn: '1 / -1', height: `${paddingBottom}px` }} />}
    </Box>
  );
}
