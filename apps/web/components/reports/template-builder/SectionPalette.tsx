'use client';

/**
 * Section Palette Component
 *
 * A visual palette for selecting and adding report sections.
 * Displays all 10 section types organized by category with
 * descriptions, icons, and one-click adding functionality.
 *
 * Features:
 * - Category-based grouping (Structure, Performance, Data Analysis, Custom)
 * - Visual type indicators with colors
 * - Click-to-add functionality
 * - Tracks already-added section types
 * - Allows multiple instances of text_block and graphs
 * - Tooltips with section descriptions
 *
 * @example
 * ```tsx
 * <SectionPalette
 *   onAddSection={(type) => handleAddSection(type)}
 *   addedTypes={sections.map(s => s.type)}
 *   disabled={isSubmitting}
 * />
 * ```
 */

import { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Tooltip,
  IconButton,
  Chip,
  Collapse,
  alpha,
} from '@mui/material';
import {
  Title as TitleIcon,
  Description as DescriptionIcon,
  Speed as SpeedIcon,
  Timeline as TimelineIcon,
  Timer as TimerIcon,
  TrendingDown as TrendingDownIcon,
  Storage as StorageIcon,
  TrendingUp as TrendingUpIcon,
  CompareArrows as CompareIcon,
  BarChart as BarChartIcon,
  Add as AddIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Comment as CommentIcon,
} from '@mui/icons-material';
import {
  type ReportSectionType,
  REPORT_SECTION_TYPES,
  getSectionTypeLabel,
  isCommentableSection,
} from '@/lib/api/reports';

// ==================== Types ====================

/**
 * Props for the SectionPalette component
 */
export interface SectionPaletteProps {
  /** Callback when a section is added */
  onAddSection: (type: ReportSectionType) => void;
  /** Currently added section types (to track duplicates) */
  addedTypes?: ReportSectionType[];
  /** Whether the palette is disabled */
  disabled?: boolean;
  /** Compact mode - single row with horizontal scroll */
  compact?: boolean;
  /** Whether to show descriptions */
  showDescriptions?: boolean;
  /** Whether to show category headers */
  showCategories?: boolean;
}

/**
 * Section type metadata
 */
interface SectionTypeInfo {
  type: ReportSectionType;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  category: 'structure' | 'performance' | 'analysis' | 'custom';
  allowMultiple: boolean;
}

// ==================== Section Type Definitions ====================

/**
 * Get icon component for a section type
 */
function getSectionIcon(type: ReportSectionType): React.ReactNode {
  const iconProps = { fontSize: 'small' as const };
  switch (type) {
    case 'header':
      return <TitleIcon {...iconProps} />;
    case 'text_block':
      return <DescriptionIcon {...iconProps} />;
    case 'slo':
      return <SpeedIcon {...iconProps} />;
    case 'apdex':
      return <TimelineIcon {...iconProps} />;
    case 'transaction_response_times':
      return <TimerIcon {...iconProps} />;
    case 'regressions':
      return <TrendingDownIcon {...iconProps} />;
    case 'awr':
      return <StorageIcon {...iconProps} />;
    case 'trends':
      return <TrendingUpIcon {...iconProps} />;
    case 'comparisons':
      return <CompareIcon {...iconProps} />;
    case 'graphs':
      return <BarChartIcon {...iconProps} />;
    default:
      return <DescriptionIcon {...iconProps} />;
  }
}

/**
 * Section type metadata with categories
 */
const SECTION_TYPE_INFO: Record<ReportSectionType, Omit<SectionTypeInfo, 'type'>> = {
  header: {
    label: 'Header',
    description: 'Report header with title, date, and branding',
    icon: getSectionIcon('header'),
    color: '#1976d2',
    category: 'structure',
    allowMultiple: false,
  },
  text_block: {
    label: 'Text Block',
    description: 'Custom text content for notes or descriptions',
    icon: getSectionIcon('text_block'),
    color: '#7c4dff',
    category: 'structure',
    allowMultiple: true,
  },
  slo: {
    label: 'SLO Results',
    description: 'Service Level Objective compliance and results',
    icon: getSectionIcon('slo'),
    color: '#4caf50',
    category: 'performance',
    allowMultiple: false,
  },
  apdex: {
    label: 'Apdex Report',
    description: 'Application Performance Index scores',
    icon: getSectionIcon('apdex'),
    color: '#ff9800',
    category: 'performance',
    allowMultiple: false,
  },
  transaction_response_times: {
    label: 'Response Times',
    description: 'Response time metrics per transaction',
    icon: getSectionIcon('transaction_response_times'),
    color: '#2196f3',
    category: 'performance',
    allowMultiple: false,
  },
  regressions: {
    label: 'Regressions',
    description: 'Performance regression analysis',
    icon: getSectionIcon('regressions'),
    color: '#f44336',
    category: 'analysis',
    allowMultiple: false,
  },
  awr: {
    label: 'AWR Analysis',
    description: 'Oracle Database AWR analysis',
    icon: getSectionIcon('awr'),
    color: '#9c27b0',
    category: 'analysis',
    allowMultiple: false,
  },
  trends: {
    label: 'Trends',
    description: 'Historical performance trends',
    icon: getSectionIcon('trends'),
    color: '#00bcd4',
    category: 'analysis',
    allowMultiple: false,
  },
  comparisons: {
    label: 'Comparisons',
    description: 'Test run comparisons',
    icon: getSectionIcon('comparisons'),
    color: '#795548',
    category: 'analysis',
    allowMultiple: false,
  },
  graphs: {
    label: 'Custom Graphs',
    description: 'Custom performance graphs and charts',
    icon: getSectionIcon('graphs'),
    color: '#607d8b',
    category: 'custom',
    allowMultiple: true,
  },
};

/**
 * Category metadata
 */
const CATEGORIES = [
  { id: 'structure', label: 'Structure', description: 'Report structure and content' },
  { id: 'performance', label: 'Performance', description: 'Performance metrics and KPIs' },
  { id: 'analysis', label: 'Analysis', description: 'Data analysis and insights' },
  { id: 'custom', label: 'Custom', description: 'Custom visualizations' },
] as const;

// ==================== Main Component ====================

/**
 * SectionPalette - Visual palette for adding report sections
 */
export function SectionPalette({
  onAddSection,
  addedTypes = [],
  disabled = false,
  compact = false,
  showDescriptions = true,
  showCategories = true,
}: SectionPaletteProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['structure', 'performance', 'analysis', 'custom'])
  );

  // Build section info array with availability status
  const sections = useMemo(() => {
    return REPORT_SECTION_TYPES.map((type) => {
      const info = SECTION_TYPE_INFO[type];
      const isAdded = addedTypes.includes(type);
      const isAvailable = info.allowMultiple || !isAdded;

      return {
        type,
        ...info,
        isAdded,
        isAvailable,
      };
    });
  }, [addedTypes]);

  // Group sections by category
  const sectionsByCategory = useMemo(() => {
    const grouped: Record<string, typeof sections> = {};
    for (const category of CATEGORIES) {
      grouped[category.id] = sections.filter((s) => s.category === category.id);
    }
    return grouped;
  }, [sections]);

  // Toggle category expansion
  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  // Handle section click
  const handleSectionClick = (type: ReportSectionType, isAvailable: boolean) => {
    if (!disabled && isAvailable) {
      onAddSection(type);
    }
  };

  // Render a single section card
  const renderSectionCard = (section: (typeof sections)[number]) => {
    const { type, label, description, icon, color, isAvailable, isAdded, allowMultiple } = section;
    const supportsComments = isCommentableSection(type);

    return (
      <Tooltip
        key={type}
        title={
          !isAvailable
            ? `${label} already added (only one allowed)`
            : allowMultiple
              ? `Add ${label} (multiple allowed)`
              : `Add ${label}`
        }
        arrow
      >
        <Paper
          variant="outlined"
          onClick={() => handleSectionClick(type, isAvailable)}
          sx={{
            p: compact ? 1 : 1.5,
            cursor: disabled || !isAvailable ? 'not-allowed' : 'pointer',
            opacity: disabled || !isAvailable ? 0.5 : 1,
            transition: 'all 0.2s ease',
            border: '1px solid',
            borderColor: isAdded ? alpha(color, 0.5) : 'divider',
            backgroundColor: isAdded ? alpha(color, 0.05) : 'background.paper',
            '&:hover': {
              borderColor: disabled || !isAvailable ? 'divider' : color,
              backgroundColor:
                disabled || !isAvailable ? 'background.paper' : alpha(color, 0.08),
              transform: disabled || !isAvailable ? 'none' : 'translateY(-1px)',
              boxShadow:
                disabled || !isAvailable ? 'none' : `0 2px 8px ${alpha(color, 0.2)}`,
            },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            {/* Icon */}
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: '8px',
                backgroundColor: alpha(color, 0.12),
                color: color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {icon}
            </Box>

            {/* Content */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography
                  variant="subtitle2"
                  sx={{
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    color: 'text.primary',
                  }}
                >
                  {label}
                </Typography>

                {/* Indicators */}
                {allowMultiple && (
                  <Chip
                    label="+"
                    size="small"
                    sx={{
                      height: 16,
                      fontSize: '0.6rem',
                      backgroundColor: alpha(color, 0.15),
                      color: color,
                    }}
                  />
                )}
                {supportsComments && !compact && (
                  <Tooltip title="Supports comments">
                    <CommentIcon
                      sx={{ fontSize: 12, color: 'text.secondary', ml: 'auto' }}
                    />
                  </Tooltip>
                )}
              </Box>

              {showDescriptions && !compact && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: 'block',
                    mt: 0.5,
                    fontSize: '0.7rem',
                    lineHeight: 1.3,
                  }}
                >
                  {description}
                </Typography>
              )}
            </Box>

            {/* Add button */}
            {isAvailable && !compact && (
              <IconButton
                size="small"
                color="primary"
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSectionClick(type, true);
                }}
                sx={{
                  width: 24,
                  height: 24,
                  backgroundColor: alpha(color, 0.1),
                  color: color,
                  '&:hover': {
                    backgroundColor: alpha(color, 0.2),
                  },
                }}
              >
                <AddIcon sx={{ fontSize: 14 }} />
              </IconButton>
            )}
          </Box>
        </Paper>
      </Tooltip>
    );
  };

  // Compact mode - horizontal scroll
  if (compact) {
    return (
      <Box
        sx={{
          display: 'flex',
          gap: 1,
          overflowX: 'auto',
          pb: 1,
          '&::-webkit-scrollbar': {
            height: 4,
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: 'action.hover',
            borderRadius: 2,
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'action.selected',
            borderRadius: 2,
          },
        }}
      >
        {sections.map((section) => (
          <Box key={section.type} sx={{ flexShrink: 0, width: 140 }}>
            {renderSectionCard(section)}
          </Box>
        ))}
      </Box>
    );
  }

  // Full mode - categorized grid
  return (
    <Box>
      {CATEGORIES.map((category) => {
        const categorySections = sectionsByCategory[category.id];
        if (categorySections.length === 0) return null;

        const isExpanded = expandedCategories.has(category.id);

        return (
          <Box key={category.id} sx={{ mb: 2 }}>
            {showCategories && (
              <Box
                onClick={() => toggleCategory(category.id)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  cursor: 'pointer',
                  mb: 1,
                  py: 0.5,
                  '&:hover': {
                    '& .category-label': {
                      color: 'primary.main',
                    },
                  },
                }}
              >
                {isExpanded ? (
                  <ExpandLessIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                ) : (
                  <ExpandMoreIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                )}
                <Typography
                  className="category-label"
                  variant="subtitle2"
                  sx={{
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    color: 'text.secondary',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {category.label}
                </Typography>
                <Chip
                  label={categorySections.length}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: '0.65rem',
                    backgroundColor: 'action.hover',
                  }}
                />
              </Box>
            )}

            <Collapse in={!showCategories || isExpanded}>
              <Grid container spacing={1}>
                {categorySections.map((section) => (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={section.type}>
                    {renderSectionCard(section)}
                  </Grid>
                ))}
              </Grid>
            </Collapse>
          </Box>
        );
      })}
    </Box>
  );
}

export default SectionPalette;
