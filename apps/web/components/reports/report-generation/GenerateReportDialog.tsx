'use client';

/**
 * Generate Report Dialog - Redesigned
 *
 * Modern UI for building custom reports with template support
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  CircularProgress,
  Switch,
  FormControlLabel,
  IconButton,
  Chip,
  Collapse,
  TextField,
} from '@mui/material';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Description as DescriptionIcon,
  Info as InfoIcon,
  DragIndicator as DragIcon,
  Delete as DeleteIcon,
  TextFields as TextIcon,
  Assignment as AssignmentIcon,
  Speed as SpeedIcon,
  TrendingUp as TrendingIcon,
  CompareArrows as CompareIcon,
  ShowChart as GraphIcon,
  Warning as WarningIcon,
  Storage as StorageIcon,
  Settings as SettingsIcon,
  ExpandMore as ExpandMoreIcon,
  Star as StarIcon,
  FormatListNumbered as ListNumberedIcon,
} from '@mui/icons-material';
import {
  generateAdHocReport,
  getTemplateSummaries,
  getTemplate,
  type TemplateSummary,
  type TemplateDetail,
  type ReportSectionConfig,
  type ReportSectionType,
  type ReportStyling,
  REPORT_SECTION_TYPES,
} from '@/lib/api/reports';
import {
  HeaderConfigForm,
  TextBlockConfigForm,
  SloConfigForm,
  ApdexConfigForm,
  TransactionResponseTimesConfigForm,
  RegressionsConfigForm,
  GraphsConfigForm,
  AwrConfigForm,
  TrendsConfigForm,
  ComparisonsConfigForm,
  Top10ListsConfigForm,
} from './SectionConfigs';
import { BaselineRunSelect, useBaselineCandidates, type BaselineCandidate } from './BaselineRunSelect';
import { sectionSummary } from './section-summary';

// ==================== Types ====================

/** @public */
export interface ReportScope {
  systemId: string;
  testEnvironment: string;
  workload: string;
}

/** @public */
export interface GenerateReportDialogProps {
  open: boolean;
  onClose: () => void;
  testRunId?: string; // Optional for template builder mode
  scope: ReportScope;
  onSuccess?: (reportId: string, jobId: string) => void;
  onError?: (error: string) => void;
  // Template builder mode
  mode?: 'report' | 'template-builder';
  initialSections?: ReportSectionConfig[];
  initialStyling?: ReportStyling;
  onTemplateBuilt?: (sections: ReportSectionConfig[], styling?: ReportStyling) => void;
}

// ==================== Section Configuration ====================

const SECTION_CONFIG: Record<ReportSectionType, { icon: React.ReactNode; label: string; description: string; color: string }> = {
  header: {
    icon: <TextIcon />,
    label: 'Header',
    description: 'Section heading with configurable level (H1-H6)',
    color: '#2196f3',
  },
  text_block: {
    icon: <AssignmentIcon />,
    label: 'Text Block',
    description: 'Free-form text content with markdown support',
    color: '#607d8b',
  },
  slo: {
    icon: <AssignmentIcon sx={{ transform: 'rotate(180deg)' }} />,
    label: 'SLO Summary',
    description: 'Service Level Objective results and compliance',
    color: '#4caf50',
  },
  apdex: {
    icon: <SpeedIcon />,
    label: 'Apdex Scores',
    description: 'Application Performance Index scores by transaction',
    color: '#66bb6a',
  },
  transaction_response_times: {
    icon: <TrendingIcon />,
    label: 'Response Times',
    description: 'Transaction response time metrics and percentiles',
    color: '#2196f3',
  },
  regressions: {
    icon: <WarningIcon />,
    label: 'Performance Regressions',
    description: 'Detected performance regressions and anomalies',
    color: '#f44336',
  },
  awr: {
    icon: <StorageIcon />,
    label: 'AWR Analysis',
    description: 'Automatic Workload Repository (Oracle) report',
    color: '#9c27b0',
  },
  trends: {
    icon: <TrendingIcon />,
    label: 'Trend Charts',
    description: 'Historical performance trends over multiple test runs',
    color: '#ff9800',
  },
  comparisons: {
    icon: <CompareIcon />,
    label: 'Test Comparisons',
    description: 'Side-by-side comparison with baseline test runs',
    color: '#795548',
  },
  graphs: {
    icon: <GraphIcon />,
    label: 'Custom Graphs',
    description: 'Performance metrics visualizations',
    color: '#00bcd4',
  },
  top_10_lists: {
    icon: <ListNumberedIcon />,
    label: 'Top 10 Lists',
    description: 'Ranked top-10 lists (slowest, throughput, impact, error rate) for transactions, requests, or URLs',
    color: '#ff9800',
  },
};

// ==================== Main Component ====================

export function GenerateReportDialog({
  open,
  onClose,
  testRunId,
  scope,
  onSuccess,
  onError,
  mode = 'report',
  initialSections = [],
  initialStyling,
  onTemplateBuilt,
}: GenerateReportDialogProps) {
  const isTemplateBuilder = mode === 'template-builder';

  // Template state
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDetail | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(!isTemplateBuilder);

  // Report builder state
  const [sections, setSections] = useState<ReportSectionConfig[]>(initialSections);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Report generation state (polling handled by parent component)
  const [generationStatus, setGenerationStatus] = useState<string>('');

  // Template-level baseline: sections that compare against a baseline test run
  // can all be pointed at one run from a single dropdown.
  const isBaselineSection = (s: ReportSectionConfig) =>
    s.type === 'comparisons' &&
    (s.config as Record<string, unknown> | undefined)?.comparisonMode === 'baseline_run';
  const baselineSections = sections.filter(isBaselineSection);
  const baselineSectionCount = baselineSections.length;
  const baselineIds = new Set(
    baselineSections
      .map((s) => (s.config as Record<string, unknown> | undefined)?.baselineTestRunId)
      .filter((v): v is string => typeof v === 'string' && v.length > 0),
  );
  // One shared value when all baseline sections agree; undefined otherwise
  const sharedBaselineId = baselineIds.size === 1 ? [...baselineIds][0] : undefined;
  const baselineCandidates = useBaselineCandidates(
    scope.systemId,
    testRunId,
    open && !isTemplateBuilder && baselineSectionCount > 0,
  );
  // "Save as template" name conflict: template summaries are scoped to the
  // same (system, environment, workload) as the DB unique constraint, so a
  // client-side match means the server would reject it.
  const templateNameTaken = saveAsTemplate &&
    templates.some((t) => t.name.trim() === templateName.trim() && templateName.trim() !== '');

  const handleSharedBaselineChange = (candidate: BaselineCandidate | null) => {
    setSections(sections.map((s) =>
      isBaselineSection(s)
        ? { ...s, config: { ...(s.config ?? {}), baselineTestRunId: candidate?.test_run_id } }
        : s,
    ));
  };

  // Load templates on open (skip in template-builder mode)
  useEffect(() => {
    if (!open || isTemplateBuilder) return;

    const fetchTemplates = async () => {
      setTemplatesLoading(true);
      setError(null);

      try {
        const summaries = await getTemplateSummaries(
          scope.systemId,
          scope.testEnvironment,
          scope.workload
        );

        setTemplates(summaries);

        // Don't auto-load template - let user choose
        setShowTemplateSelector(true);
      } catch (err) {
        console.error('[GenerateReportDialog] Failed to fetch templates:', err);
        setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to load templates');
      } finally {
        setTemplatesLoading(false);
      }
    };

    fetchTemplates();
  }, [open, scope, isTemplateBuilder]);

  // Note: Report generation polling is now handled by parent component (page.tsx)
  // This dialog just initiates the generation and returns the report ID immediately

  // Handle section reorder
  const handleReorder = (fromIndex: number, toIndex: number) => {
    const newSections = [...sections];
    const [removed] = newSections.splice(fromIndex, 1);
    newSections.splice(toIndex, 0, removed);

    // Update order values
    const reordered = newSections.map((section, index) => ({
      ...section,
      order: index,
    }));
    setSections(reordered);
  };

  // Handle drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = sections.findIndex((_, i) => i.toString() === active.id);
      const newIndex = sections.findIndex((_, i) => i.toString() === over.id);

      const newSections = arrayMove(sections, oldIndex, newIndex);
      const reordered = newSections.map((section, index) => ({
        ...section,
        order: index,
      }));
      setSections(reordered);
    }
  };

  // Handle section delete
  const handleDelete = (index: number) => {
    const newSections = sections.filter((_, i) => i !== index);
    const reordered = newSections.map((section, i) => ({
      ...section,
      order: i,
    }));
    setSections(reordered);
  };

  // Handle section config change
  const handleConfigChange = (index: number, config: Record<string, unknown>) => {
    const newSections = [...sections];

    // Extract comment from config (if present) and store as separate field
    const { comment, ...restConfig } = config;

    newSections[index] = {
      ...newSections[index],
      config: restConfig,
      ...(comment !== undefined && { comment: comment as string }), // Only set comment if present
    };
    setSections(newSections);
  };

  // Handle add section
  const handleAddSection = (type: ReportSectionType) => {
    const newSection: ReportSectionConfig = {
      type,
      order: sections.length,
      title: SECTION_CONFIG[type].label,
    };
    setSections([...sections, newSection]);
  };

  // Handle template selection and loading
  const handleLoadTemplate = async (templateId: string) => {
    try {
      setTemplatesLoading(true);
      setError(null);
      const detail = await getTemplate(templateId);
      setSelectedTemplate(detail);
      setSections(detail.sections || []);
      setShowTemplateSelector(false);
    } catch (err) {
      setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to load template');
    } finally {
      setTemplatesLoading(false);
    }
  };

  // Handle starting from scratch (no template)
  const handleStartFromScratch = () => {
    setSelectedTemplate(null);
    setSections([]);
    setShowTemplateSelector(false);
  };

  // Handle generate or save template
  const handleGenerate = async () => {
    setIsSubmitting(true);
    setError(null);

    // Template builder mode - just return sections and styling
    if (isTemplateBuilder) {
      try {
        onTemplateBuilt?.(sections, initialStyling);
        onClose();
        setIsSubmitting(false);
      } catch (err) {
        const errorMsg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to save template configuration';
        setError(errorMsg);
        setIsSubmitting(false);
      }
      return;
    }

    // Report generation mode
    setGenerationStatus('Starting...');

    try {
      if (!testRunId) {
        throw new Error('Test run ID is required for report generation');
      }

      const result = await generateAdHocReport({
        test_run_id: testRunId,
        // Name after the source template (the meaningful differentiator) so the
        // report list is recognizable; timestamp keeps repeat runs unique. Cap
        // the template portion at 200 chars — report name is varchar(255) with a
        // @Length(1,255) DTO guard, and template names can be up to 255.
        name: `${(selectedTemplate?.name ?? 'Ad-hoc report').slice(0, 200)} - ${new Date().toLocaleString()}`,
        sections,
        styling: {},
        save_as_template: saveAsTemplate,
        template_name: saveAsTemplate ? templateName.trim() : undefined,
      });

      // Report generation started - parent component will handle polling
      onSuccess?.(result.report_id, result.job_id);
      onClose();

      // Reset state
      setIsSubmitting(false);
      setGenerationStatus('');
    } catch (err) {
      const errorMsg = err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to generate report';
      setError(errorMsg);
      onError?.(errorMsg);
      setIsSubmitting(false);
      setGenerationStatus('');
    }
  };

  // All section types are always available (can add multiple of same type)
  const availableSections = REPORT_SECTION_TYPES;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          height: '90vh',
          maxHeight: 900,
        },
      }}
    >
      {/* Title */}
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 2, px: 3 }}>
        <DescriptionIcon sx={{ color: 'primary.main', fontSize: 28 }} />
        <Typography variant="h6" component="div" fontWeight={500}>
          {isTemplateBuilder ? 'Configure Template Sections' : 'Generate Report'}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top Section: Banner and Toggle */}
        <Box sx={{ flexShrink: 0 }}>
          {/* Template Info Banner */}
          {!isTemplateBuilder && selectedTemplate && !showTemplateSelector && (
            <Alert
              severity="info"
              icon={<InfoIcon />}
              sx={{ mx: 3, mt: 2, borderRadius: 2 }}
              action={
                <Button
                  size="small"
                  onClick={() => setShowTemplateSelector(true)}
                >
                  Back to Template
                </Button>
              }
            >
              <Typography variant="body2" fontWeight={600}>
                Based on Template: &quot;{selectedTemplate.name}&quot;
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Modifying a copy of the selected template. Changes will not affect the original template.
              </Typography>
            </Alert>
          )}

          {/* Save as Template Toggle - only in report mode */}
          {!isTemplateBuilder && (
            <Box sx={{ mx: 3, mt: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={saveAsTemplate}
                    onChange={(e) => {
                      setSaveAsTemplate(e.target.checked);
                      if (!e.target.checked) {
                        setTemplateName(''); // Clear template name when switch is turned off
                      }
                    }}
                  />
                }
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <AssignmentIcon fontSize="small" />
                    <Typography variant="body2">Save as template for future use</Typography>
                  </Box>
                }
              />
              {saveAsTemplate && (
                <TextField
                  fullWidth
                  label="Template Name"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Enter template name..."
                  required
                  error={(saveAsTemplate && !templateName.trim()) || templateNameTaken}
                  helperText={
                    saveAsTemplate && !templateName.trim()
                      ? 'Template name is required'
                      : templateNameTaken
                        ? 'A template with this name already exists — choose a different name'
                        : ''
                  }
                  sx={{ mt: 2 }}
                />
              )}
            </Box>
          )}

          {/* Template-level baseline picker: one place to set the baseline run for
              every comparison section in this report (sections can still override
              it individually in their own configuration). */}
          {!isTemplateBuilder && !showTemplateSelector && baselineSectionCount > 0 && (
            <Box sx={{ mx: 3, mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                Baseline Test Run
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                {baselineSectionCount} section{baselineSectionCount !== 1 ? 's' : ''} in this report compare{baselineSectionCount === 1 ? 's' : ''} against a baseline run — set it once here.
              </Typography>
              <BaselineRunSelect
                candidates={baselineCandidates}
                value={sharedBaselineId}
                onChange={handleSharedBaselineChange}
                helperText={
                  sharedBaselineId
                    ? `Applied to all ${baselineSectionCount} comparison section${baselineSectionCount !== 1 ? 's' : ''}`
                    : sharedBaselineId === undefined && baselineSectionCount > 1
                      ? 'Sections currently use different baselines — selecting one here overrides them all'
                      : `Select from ${baselineCandidates.length} available test runs`
                }
              />
            </Box>
          )}
        </Box>

        {/* Template Selector View */}
        {!isTemplateBuilder && showTemplateSelector && (
          <Box sx={{ px: 3, py: 2, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Typography variant="h6" gutterBottom>
              Choose a Starting Point
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Select a template to use as a starting point, or start from scratch
            </Typography>

            {templatesLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {/* Start from Scratch Option */}
                <Box
                  onClick={handleStartFromScratch}
                  sx={{
                    p: 3,
                    border: '2px solid',
                    borderColor: 'divider',
                    borderRadius: 2,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    '&:hover': {
                      borderColor: 'primary.main',
                      bgcolor: 'action.hover',
                    },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box
                      sx={{
                        width: 48,
                        height: 48,
                        borderRadius: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: 'primary.light',
                        color: 'primary.contrastText',
                      }}
                    >
                      <DescriptionIcon />
                    </Box>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="subtitle1" fontWeight={600}>
                        Start from Scratch
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Build a custom report from an empty canvas
                      </Typography>
                    </Box>
                  </Box>
                </Box>

                {/* Available Templates */}
                {templates.length > 0 && (
                  <>
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 2 }}>
                      Available Templates ({templates.length})
                    </Typography>
                    {templates.map((template) => (
                      <Box
                        key={template.id}
                        onClick={() => handleLoadTemplate(template.id)}
                        sx={{
                          p: 3,
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 2,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          '&:hover': {
                            borderColor: 'primary.main',
                            bgcolor: 'action.hover',
                          },
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Box
                            sx={{
                              width: 48,
                              height: 48,
                              borderRadius: 1,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              bgcolor: template.is_default ? 'warning.light' : 'action.selected',
                            }}
                          >
                            {template.is_default ? <StarIcon /> : <AssignmentIcon />}
                          </Box>
                          <Box sx={{ flex: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="subtitle1" fontWeight={600}>
                                {template.name}
                              </Typography>
                              {template.is_default && (
                                <Chip label="Default" size="small" color="primary" />
                              )}
                            </Box>
                            <Typography variant="body2" color="text.secondary">
                              {template.section_count} section{template.section_count !== 1 ? 's' : ''}
                            </Typography>
                          </Box>
                        </Box>
                      </Box>
                    ))}
                  </>
                )}

                {templates.length === 0 && (
                  <Alert severity="info" sx={{ mt: 2 }}>
                    No templates available for this system/environment/workload combination.
                    You can start from scratch and save your report as a template for future use.
                  </Alert>
                )}
              </Box>
            )}
          </Box>
        )}

        {/* Main Content - Report Builder */}
        {!showTemplateSelector && (
          <Box sx={{ display: 'flex', gap: 3, px: 3, py: 2, flex: 1, minHeight: 0 }}>
            {/* Left Column: Available Sections */}
            <Box sx={{ flex: '0 0 340px', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Available Sections
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Drag sections to the canvas to build your report
                </Typography>
              </Box>

              <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {availableSections.map((type) => (
                  <SectionCard
                    key={type}
                    type={type}
                    onClick={() => handleAddSection(type)}
                  />
                ))}
              </Box>
            </Box>

            {/* Right Column: Report Layout */}
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Report Layout
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Drag to reorder sections
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                {sections.length} sections / 20 max
              </Typography>
            </Box>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sections.map((_, index) => index.toString())}
                strategy={verticalListSortingStrategy}
              >
                <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {sections.map((section, index) => (
                    <LayoutSectionCard
                      key={index.toString()}
                      id={index.toString()}
                      section={section}
                      index={index}
                      onDelete={() => handleDelete(index)}
                      onConfigChange={(config) => handleConfigChange(index, config)}
                      onMoveUp={index > 0 ? () => handleReorder(index, index - 1) : undefined}
                      onMoveDown={index < sections.length - 1 ? () => handleReorder(index, index + 1) : undefined}
                      testRunId={testRunId}
                      systemUnderTestId={scope.systemId}
                      testEnvironment={scope.testEnvironment}
                      workload={scope.workload}
                    />
                  ))}

                  {sections.length === 0 && (
                    <Box
                      sx={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '2px dashed',
                        borderColor: 'divider',
                        borderRadius: 2,
                        p: 4,
                      }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        No sections added yet. Click sections from the left to add them.
                      </Typography>
                    </Box>
                  )}
                </Box>
              </SortableContext>
            </DndContext>
          </Box>
          </Box>
        )}

        {/* Bottom Section: Error Display */}
        {error && (
          <Box sx={{ flexShrink: 0 }}>
            <Alert severity="error" sx={{ mx: 3, mt: 2, mb: 2 }}>
              {error}
            </Alert>
          </Box>
        )}
      </DialogContent>

      {/* Actions */}
      <DialogActions sx={{ px: 3, py: 2, borderTop: '1px solid', borderColor: 'divider', flexDirection: 'column', alignItems: 'stretch', gap: 1 }}>
        {/* Generation Status */}
        {isSubmitting && generationStatus && !isTemplateBuilder && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2 }}>
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">
              {generationStatus}
            </Typography>
          </Box>
        )}

        {/* Action Buttons */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button onClick={onClose} disabled={isSubmitting} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          {!showTemplateSelector && (
            <Button
              variant="contained"
              onClick={handleGenerate}
              disabled={isSubmitting || sections.length === 0 || (saveAsTemplate && !templateName.trim()) || templateNameTaken}
              startIcon={isSubmitting ? <CircularProgress size={16} color="inherit" /> : <DescriptionIcon />}
              sx={{
                textTransform: 'none',
                fontWeight: 500,
              }}
            >
              {isSubmitting
                ? (isTemplateBuilder ? 'Saving...' : generationStatus || 'Generating...')
                : (isTemplateBuilder ? 'Save Configuration' : 'Generate Report')
              }
            </Button>
          )}
        </Box>
      </DialogActions>
    </Dialog>
  );
}

// ==================== Section Card (Available) ====================

interface SectionCardProps {
  type: ReportSectionType;
  onClick: () => void;
}

function SectionCard({ type, onClick }: SectionCardProps) {
  const config = SECTION_CONFIG[type];

  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 2,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        cursor: 'pointer',
        bgcolor: 'background.paper',
        transition: 'border-color 0.2s',
        '&:hover': {
          borderColor: 'text.primary',
        },
      }}
    >
      <DragIcon sx={{ color: 'text.secondary' }} />
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: `${config.color}15`,
          color: config.color,
        }}
      >
        {config.icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600} noWrap>
          {config.label}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {config.description}
        </Typography>
      </Box>
    </Box>
  );
}

// ==================== Layout Section Card ====================

interface LayoutSectionCardProps {
  id: string;
  section: ReportSectionConfig;
  index: number;
  onDelete: () => void;
  onConfigChange: (config: Record<string, unknown>) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  testRunId?: string;
  systemUnderTestId?: string;
  testEnvironment?: string;
  workload?: string;
}

function LayoutSectionCard({ id, section, index, onDelete, onConfigChange, onMoveUp: _onMoveUp, onMoveDown: _onMoveDown, testRunId, systemUnderTestId, testEnvironment, workload }: LayoutSectionCardProps) {
  // DB-stored templates can carry section types this build doesn't know about
  const config = SECTION_CONFIG[section.type] ?? { icon: null, label: section.type, description: '', color: '#9e9e9e' };
  const [expanded, setExpanded] = useState(false);

  // Setup drag and drop
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Render the appropriate config form
  const renderConfigForm = () => {
    // Merge config with comment for forms that support comments
    const sectionConfig = {
      ...(section.config || {}),
      ...(section.comment !== undefined && { comment: section.comment }),
    } as Record<string, unknown>;

    switch (section.type) {
      case 'header':
        return <HeaderConfigForm config={sectionConfig} onChange={onConfigChange} testRunId={testRunId} />;
      case 'text_block':
        return <TextBlockConfigForm config={sectionConfig} onChange={onConfigChange} testRunId={testRunId} />;
      case 'slo':
        return <SloConfigForm config={sectionConfig} onChange={onConfigChange} testRunId={testRunId} />;
      case 'apdex':
        return <ApdexConfigForm config={sectionConfig} onChange={onConfigChange} testRunId={testRunId} />;
      case 'transaction_response_times':
        return <TransactionResponseTimesConfigForm config={sectionConfig} onChange={onConfigChange} testRunId={testRunId} />;
      case 'regressions':
        return <RegressionsConfigForm config={sectionConfig} onChange={onConfigChange} testRunId={testRunId} />;
      case 'graphs':
        return <GraphsConfigForm config={sectionConfig} onChange={onConfigChange} testRunId={testRunId} />;
      case 'awr':
        return <AwrConfigForm config={sectionConfig} onChange={onConfigChange} testRunId={testRunId} />;
      case 'trends':
        return <TrendsConfigForm config={sectionConfig} onChange={onConfigChange} testRunId={testRunId} />;
      case 'comparisons':
        return <ComparisonsConfigForm config={sectionConfig} onChange={onConfigChange} testRunId={testRunId} systemUnderTestId={systemUnderTestId} testEnvironment={testEnvironment} workload={workload} />;
      case 'top_10_lists':
        return <Top10ListsConfigForm config={sectionConfig} onChange={onConfigChange} testRunId={testRunId} />;
      default:
        return null;
    }
  };

  return (
    <Box
      ref={setNodeRef}
      style={style}
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
        ...(isDragging && {
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          opacity: 0.5,
        }),
      }}
    >
      {/* Header */}
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          p: 2,
          cursor: 'pointer',
          transition: 'background-color 0.2s',
          '&:hover': {
            bgcolor: 'action.hover',
          },
        }}
      >
        <Box
          {...attributes}
          {...listeners}
          sx={{
            display: 'flex',
            alignItems: 'center',
            cursor: 'grab',
            '&:active': { cursor: 'grabbing' },
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <DragIcon sx={{ color: 'text.secondary' }} />
        </Box>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: `${config.color}15`,
            color: config.color,
          }}
        >
          {config.icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600}>
            {section.title || config.label}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {sectionSummary(section) ?? config.description}
          </Typography>
        </Box>

        {/* Order Badge */}
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: config.color,
            color: '#fff',
            fontWeight: 700,
            fontSize: '0.875rem',
          }}
        >
          {index + 1}
        </Box>

        {/* Configure Button */}
        <IconButton
          size="small"
          sx={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
            pointerEvents: 'none',
          }}
        >
          <ExpandMoreIcon />
        </IconButton>

        {/* Delete */}
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          sx={{
            color: 'text.secondary',
            '&:hover': {
              color: 'error.main',
            },
          }}
        >
          <DeleteIcon />
        </IconButton>
      </Box>

      {/* Expandable Configuration Panel */}
      <Collapse in={expanded}>
        <Box
          sx={{
            p: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.default',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              mb: 2,
            }}
          >
            <SettingsIcon fontSize="small" sx={{ color: 'text.secondary' }} />
            <Typography variant="caption" fontWeight={600} textTransform="uppercase">
              Section Configuration
            </Typography>
          </Box>
          {renderConfigForm()}
        </Box>
      </Collapse>
    </Box>
  );
}

export default GenerateReportDialog;
