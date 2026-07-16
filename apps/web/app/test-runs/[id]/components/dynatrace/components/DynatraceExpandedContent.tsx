'use client';

import {
  Box,
  Tabs,
  Tab,
  Paper,
  Typography,
  Autocomplete,
  TextField,
  Button,
  CircularProgress,
} from '@mui/material';
import { OpenInNew, Compare } from '@mui/icons-material';
import { TestRun } from '@/types/test-runs';
import {
  DynatraceConfig,
  DynatraceEntityMapping,
  RelatedTestRun,
  TabPanelProps,
} from '../types';
import { getEntityTypeColor, MULTIDIMENSIONAL_ANALYSIS_ITEMS, DEEP_LINK_ITEMS } from '../utils/dynatrace-config';
import { getTestRunDisplayText, getTestRunSecondaryInfo } from '../utils/dynatrace-formatters';
import HostsTabContent from '../HostsTabContent';

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`dynatrace-tabpanel-${index}`}
      aria-labelledby={`dynatrace-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `dynatrace-tab-${index}`,
    'aria-controls': `dynatrace-tabpanel-${index}`,
  };
}

interface DynatraceExpandedContentProps {
  testRun: TestRun;
  configs: DynatraceConfig[];
  serviceEntities: DynatraceEntityMapping[];
  hostEntities: DynatraceEntityMapping[];

  // Filter state
  scenarios: string[];
  transactions: string[];
  samplers: string[];
  selectedScenario: string | null;
  selectedTransaction: string | null;
  selectedSampler: string | null;
  minDuration: string;
  maxDuration: string;
  isFullFilterSelected: boolean;

  // Tab state
  tabValue: number;
  primaryTabValue: number;
  onTabChange: (event: React.SyntheticEvent, newValue: number) => void;
  onPrimaryTabChange: (event: React.SyntheticEvent, newValue: number) => void;

  // Filter handlers
  onScenarioChange: (value: string | null) => void;
  onTransactionChange: (value: string | null) => void;
  onSamplerChange: (value: string | null) => void;
  onMinDurationChange: (value: string) => void;
  onMaxDurationChange: (value: string) => void;

  // Comparison state
  relatedTestRuns: RelatedTestRun[];
  selectedComparisonTestRun: RelatedTestRun | null;
  comparisonLoading: boolean;
  onComparisonTestRunChange: (value: RelatedTestRun | null) => void;
  onFetchRelatedTestRuns: () => void;

  // Action handlers
  onDeepLinkClick: (entity: { entityId: string; displayName: string; type: string; dynatraceConfigId?: string }, linkType: string) => void;
  onMultiDimensionalAnalysis: (entity: { entityId: string; displayName: string; type: string; dynatraceConfigId?: string }, analysisType: string) => void;
  onComparisonClick: (mapping: DynatraceEntityMapping, comparisonTestRun: RelatedTestRun) => void;
}

export function DynatraceExpandedContent({
  testRun,
  configs,
  serviceEntities,
  hostEntities,
  scenarios,
  transactions,
  samplers,
  selectedScenario,
  selectedTransaction,
  selectedSampler,
  minDuration,
  maxDuration,
  isFullFilterSelected,
  tabValue,
  primaryTabValue,
  onTabChange,
  onPrimaryTabChange,
  onScenarioChange,
  onTransactionChange,
  onSamplerChange,
  onMinDurationChange,
  onMaxDurationChange,
  relatedTestRuns,
  selectedComparisonTestRun,
  comparisonLoading,
  onComparisonTestRunChange,
  onFetchRelatedTestRuns,
  onDeepLinkClick,
  onMultiDimensionalAnalysis,
  onComparisonClick,
}: DynatraceExpandedContentProps) {
  return (
    <Box>
      {/* Primary tabs: Services | Hosts */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs
          value={primaryTabValue}
          onChange={onPrimaryTabChange}
          aria-label="entity type tabs"
        >
          <Tab
            label={`Hosts (${hostEntities.length})`}
            disabled={hostEntities.length === 0}
          />
          <Tab
            label={`Services (${serviceEntities.length})`}
            disabled={serviceEntities.length === 0}
          />
        </Tabs>
      </Box>

      {/* Services Tab (index 1 — Hosts is the default first tab, see #425) */}
      <TabPanel value={primaryTabValue} index={1}>
        {/* Service tabs */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs
            value={tabValue}
            onChange={onTabChange}
            aria-label="dynatrace service tabs"
            variant="scrollable"
            scrollButtons="auto"
          >
            {serviceEntities.map((mapping, index) => (
              <Tab
                key={mapping.id}
                label={mapping.entityDisplayName}
                {...a11yProps(index)}
                sx={{
                  color: getEntityTypeColor(mapping.entityType),
                  '&.Mui-selected': {
                    color: getEntityTypeColor(mapping.entityType),
                  }
                }}
              />
            ))}
          </Tabs>
        </Box>

        {/* Tab panels for each service */}
        {serviceEntities.map((mapping, index) => (
          <TabPanel key={mapping.id} value={tabValue} index={index}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Request Filtering Section */}
              <RequestFilteringSection
                scenarios={scenarios}
                transactions={transactions}
                samplers={samplers}
                selectedScenario={selectedScenario}
                selectedTransaction={selectedTransaction}
                selectedSampler={selectedSampler}
                minDuration={minDuration}
                maxDuration={maxDuration}
                onScenarioChange={onScenarioChange}
                onTransactionChange={onTransactionChange}
                onSamplerChange={onSamplerChange}
                onMinDurationChange={onMinDurationChange}
                onMaxDurationChange={onMaxDurationChange}
              />

              {/* Multidimensional Analysis Section */}
              <AnalysisSection
                mapping={mapping}
                isFullFilterSelected={isFullFilterSelected}
                onAnalysisClick={(analysisType) => onMultiDimensionalAnalysis({
                  entityId: mapping.entityId,
                  displayName: mapping.entityDisplayName,
                  type: mapping.entityType,
                  dynatraceConfigId: mapping.dynatraceConfigId
                }, analysisType)}
                title="Multidimensional Analysis"
                description="Analyze performance metrics across multiple dimensions"
                items={MULTIDIMENSIONAL_ANALYSIS_ITEMS}
              />

              {/* Deeplinks Section */}
              <AnalysisSection
                mapping={mapping}
                isFullFilterSelected={isFullFilterSelected}
                onAnalysisClick={(linkType) => onDeepLinkClick({
                  entityId: mapping.entityId,
                  displayName: mapping.entityDisplayName,
                  type: mapping.entityType,
                  dynatraceConfigId: mapping.dynatraceConfigId
                }, linkType)}
                title="Performance Insights"
                description="Navigate directly to detailed analysis views in Dynatrace"
                items={DEEP_LINK_ITEMS}
              />

              {/* Performance Comparison Section */}
              <ComparisonSection
                mapping={mapping}
                isFullFilterSelected={isFullFilterSelected}
                relatedTestRuns={relatedTestRuns}
                selectedComparisonTestRun={selectedComparisonTestRun}
                comparisonLoading={comparisonLoading}
                onComparisonTestRunChange={onComparisonTestRunChange}
                onFetchRelatedTestRuns={onFetchRelatedTestRuns}
                onComparisonClick={(mapping, testRun) => onComparisonClick(mapping, testRun)}
              />
            </Box>
          </TabPanel>
        ))}
      </TabPanel>

      {/* Hosts Tab (index 0 — default-selected tab) */}
      <TabPanel value={primaryTabValue} index={0}>
        <HostsTabContent
          hostEntities={hostEntities}
          testRun={testRun}
          configs={configs}
        />
      </TabPanel>
    </Box>
  );
}

// Request Filtering Section Component
interface RequestFilteringSectionProps {
  scenarios: string[];
  transactions: string[];
  samplers: string[];
  selectedScenario: string | null;
  selectedTransaction: string | null;
  selectedSampler: string | null;
  minDuration: string;
  maxDuration: string;
  onScenarioChange: (value: string | null) => void;
  onTransactionChange: (value: string | null) => void;
  onSamplerChange: (value: string | null) => void;
  onMinDurationChange: (value: string) => void;
  onMaxDurationChange: (value: string) => void;
}

function RequestFilteringSection({
  scenarios,
  transactions,
  samplers,
  selectedScenario,
  selectedTransaction,
  selectedSampler,
  minDuration,
  maxDuration,
  onScenarioChange,
  onTransactionChange,
  onSamplerChange,
  onMinDurationChange,
  onMaxDurationChange,
}: RequestFilteringSectionProps) {
  return (
    <Paper
      elevation={1}
      sx={{
        p: 3,
        borderRadius: 3,
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        transition: 'all 0.2s ease-in-out',
        '&:hover': { boxShadow: '0 8px 25px -5px rgba(0, 0, 0, 0.1)' }
      }}
    >
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
          Request Filtering
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Filter by request name hierarchy and response time duration
        </Typography>
      </Box>

      {/* Hierarchical Request Name Filters */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 2, mb: 2 }}>
        <Autocomplete
          size="small"
          options={scenarios}
          value={selectedScenario}
          onChange={(_event, newValue) => onScenarioChange(newValue)}
          renderInput={(params) => <TextField {...params} label="Scenario" placeholder="Select scenario" />}
        />
        <Autocomplete
          size="small"
          options={transactions}
          value={selectedTransaction}
          onChange={(_event, newValue) => onTransactionChange(newValue)}
          disabled={!selectedScenario}
          renderInput={(params) => <TextField {...params} label="Transaction" placeholder="Select transaction" />}
        />
        <Autocomplete
          size="small"
          options={samplers}
          value={selectedSampler}
          onChange={(_event, newValue) => onSamplerChange(newValue)}
          disabled={!selectedTransaction}
          renderInput={(params) => <TextField {...params} label="Sampler" placeholder="Select sampler" />}
        />
      </Box>

      {/* Duration Filters */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
        <TextField
          size="small"
          label="Min Duration (ms)"
          type="number"
          value={minDuration}
          onChange={(e) => onMinDurationChange(e.target.value)}
          placeholder="e.g., 100"
        />
        <TextField
          size="small"
          label="Max Duration (ms)"
          type="number"
          value={maxDuration}
          onChange={(e) => onMaxDurationChange(e.target.value)}
          placeholder="e.g., 5000"
        />
      </Box>
    </Paper>
  );
}

// Analysis Section Component (for both MDA and Deeplinks)
interface AnalysisSectionProps {
  mapping: DynatraceEntityMapping;
  isFullFilterSelected: boolean;
  onAnalysisClick: (key: string) => void;
  title: string;
  description: string;
  items: Array<{ key: string; label: string; icon: React.ComponentType<{ sx?: object }>; description: string }>;
}

function AnalysisSection({
  mapping,
  isFullFilterSelected,
  onAnalysisClick,
  title,
  description,
  items,
}: AnalysisSectionProps) {
  const entityColor = getEntityTypeColor(mapping.entityType);

  return (
    <Paper
      elevation={1}
      sx={{
        p: 4,
        borderRadius: 3,
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        transition: 'all 0.2s ease-in-out',
        '&:hover': { boxShadow: '0 8px 25px -5px rgba(0, 0, 0, 0.1)' }
      }}
    >
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
        {!isFullFilterSelected && (
          <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
            Select Scenario, Transaction, and Sampler above to enable deeplinks
          </Typography>
        )}
      </Box>

      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
        gap: 2,
        width: '100%'
      }}>
        {items.map((item) => {
          const IconComponent = item.icon;
          return (
            <Box key={item.key} sx={{ display: 'flex' }}>
              <Button
                variant="outlined"
                fullWidth
                disabled={!isFullFilterSelected}
                onClick={() => onAnalysisClick(item.key)}
                sx={{
                  p: 2,
                  height: '100%',
                  minHeight: '100px',
                  borderRadius: 2,
                  borderColor: `${entityColor}40`,
                  backgroundColor: 'background.paper',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  textTransform: 'none',
                  transition: 'all 0.2s ease-in-out',
                  '&:hover:not(:disabled)': {
                    borderColor: entityColor,
                    backgroundColor: `${entityColor}08`,
                    transform: 'translateY(-2px)',
                    boxShadow: `0 8px 25px -5px ${entityColor}20`
                  },
                  '&:disabled': { opacity: 0.5, cursor: 'not-allowed' }
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 1, width: '100%' }}>
                  <IconComponent sx={{ mr: 1, fontSize: '1.2rem', color: entityColor }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, color: entityColor, fontSize: '0.9rem' }}>
                    {item.label}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem', lineHeight: 1.2 }}>
                  {item.description}
                </Typography>
              </Button>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}

// Comparison Section Component
interface ComparisonSectionProps {
  mapping: DynatraceEntityMapping;
  isFullFilterSelected: boolean;
  relatedTestRuns: RelatedTestRun[];
  selectedComparisonTestRun: RelatedTestRun | null;
  comparisonLoading: boolean;
  onComparisonTestRunChange: (value: RelatedTestRun | null) => void;
  onFetchRelatedTestRuns: () => void;
  onComparisonClick: (mapping: DynatraceEntityMapping, testRun: RelatedTestRun) => void;
}

function ComparisonSection({
  mapping,
  isFullFilterSelected,
  relatedTestRuns,
  selectedComparisonTestRun,
  comparisonLoading,
  onComparisonTestRunChange,
  onFetchRelatedTestRuns,
  onComparisonClick,
}: ComparisonSectionProps) {
  const entityColor = getEntityTypeColor(mapping.entityType);

  return (
    <Paper
      elevation={1}
      sx={{
        p: 4,
        borderRadius: 3,
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        transition: 'all 0.2s ease-in-out',
        '&:hover': { boxShadow: '0 8px 25px -5px rgba(0, 0, 0, 0.1)' }
      }}
    >
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
          Performance Comparison
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Compare performance metrics against baseline test runs
        </Typography>
        {!isFullFilterSelected && (
          <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
            Select Scenario, Transaction, and Sampler above to enable comparison
          </Typography>
        )}
      </Box>

      {comparisonLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
          <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
            Loading test runs...
          </Typography>
        </Box>
      ) : relatedTestRuns.length > 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Test Run Selection */}
          <Autocomplete
            options={relatedTestRuns}
            getOptionLabel={getTestRunDisplayText}
            value={selectedComparisonTestRun}
            onChange={(_, newValue) => onComparisonTestRunChange(newValue)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Select Test Run for Comparison"
                variant="outlined"
                fullWidth
                helperText={
                  selectedComparisonTestRun
                    ? `Comparing with: ${selectedComparisonTestRun.test_run_id}`
                    : `Select from ${relatedTestRuns.length} available test runs`
                }
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 2,
                    backgroundColor: 'background.paper',
                    '&:hover': { backgroundColor: 'rgba(255, 255, 255, 1)' }
                  }
                }}
              />
            )}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box component="li" key={key} {...otherProps}>
                  <Box sx={{ width: '100%' }}>
                    <Typography variant="body1" sx={{ fontWeight: 600 }}>
                      {option.test_run_id}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {new Date(option.start_time || option.created_at).toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {getTestRunSecondaryInfo(option)}
                    </Typography>
                  </Box>
                </Box>
              );
            }}
          />

          {/* Selected Test Run Details */}
          {selectedComparisonTestRun && (
            <Box sx={{
              p: 3,
              border: '1px solid',
              borderColor: entityColor,
              borderRadius: 2,
              backgroundColor: `${entityColor}04`
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Compare sx={{ mr: 1, color: entityColor, fontSize: '1.2rem' }} />
                <Typography variant="subtitle2" sx={{ color: entityColor, fontWeight: 600 }}>
                  Selected for Comparison
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                {selectedComparisonTestRun.test_run_id}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Started: {new Date(selectedComparisonTestRun.start_time || selectedComparisonTestRun.created_at).toLocaleString()}
              </Typography>
              {selectedComparisonTestRun.application_release && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Version: {selectedComparisonTestRun.application_release}
                </Typography>
              )}
              {selectedComparisonTestRun.annotations && selectedComparisonTestRun.annotations.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  Annotations: {selectedComparisonTestRun.annotations.join(', ')}
                </Typography>
              )}
            </Box>
          )}

          {/* Comparison Actions */}
          {selectedComparisonTestRun && (
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                disabled={!isFullFilterSelected}
                startIcon={<OpenInNew />}
                onClick={() => onComparisonClick(mapping, selectedComparisonTestRun)}
                sx={{
                  backgroundColor: entityColor,
                  '&:hover': {
                    backgroundColor: entityColor.replace('0.8', '0.9'),
                    transform: 'translateY(-1px)',
                    boxShadow: `0 6px 16px ${entityColor}30`
                  }
                }}
              >
                Compare in Dynatrace
              </Button>
              <Button
                variant="outlined"
                onClick={() => onComparisonTestRunChange(null)}
                sx={{
                  borderColor: 'text.secondary',
                  color: 'text.secondary',
                  '&:hover': { borderColor: 'text.primary', color: 'text.primary' }
                }}
              >
                Clear Selection
              </Button>
            </Box>
          )}
        </Box>
      ) : (
        <Box
          sx={{
            p: 3,
            borderRadius: 2,
            backgroundColor: 'action.hover',
            border: '1px dashed',
            borderColor: 'divider',
            textAlign: 'center'
          }}
        >
          <Compare sx={{ fontSize: '2rem', mb: 1, opacity: 0.5, color: 'text.secondary' }} />
          <Typography variant="body1" color="text.secondary" sx={{ mb: 1, fontWeight: 500 }}>
            No Related Test Runs
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No comparable test runs found. Test runs must share the same system, environment, and workload.
          </Typography>
          <Button
            variant="outlined"
            onClick={onFetchRelatedTestRuns}
            sx={{
              borderColor: `${entityColor}40`,
              color: entityColor,
              '&:hover': { borderColor: entityColor, backgroundColor: `${entityColor}08` }
            }}
          >
            Refresh
          </Button>
        </Box>
      )}
    </Paper>
  );
}
