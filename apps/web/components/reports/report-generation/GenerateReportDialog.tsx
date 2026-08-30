'use client';

/**
 * Generate Report Dialog - Redesigned
 *
 * Modern UI for building custom reports with template support
 */

import { useState, useEffect, useMemo } from 'react';
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
  useMediaQuery,
  Tooltip,
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
  Assignment as AssignmentIcon,
  Description as DescriptionIcon,
  DragIndicator as DragIcon,
  Delete as DeleteIcon,
  Settings as SettingsIcon,
  ExpandMore as ExpandMoreIcon,
  Star as StarIcon,
  WarningAmber as WarningAmberIcon,
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
  getSectionText,
} from '@/lib/api/reports';
import { MAX_REPORT_SECTIONS, SECTION_RENDER_TITLES } from '@perfana/shared/types';
import { SECTION_CONFIG } from './section-config';
import { SectionPalette } from './SectionPalette';
import { ReportVariablesProvider } from './ReportVariablesProvider';
import { SectionTitleProvider } from './SectionTitleContext';
import {
  HeaderConfigForm,
  IndexConfigForm,
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
  ErrorAnalysisConfigForm,
  findSectionAnchorWarnings,
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


const MAX_SECTIONS = MAX_REPORT_SECTIONS;

/** Below this many sections the count is noise, so the label stays hidden. */
const SECTION_COUNT_VISIBLE_FROM = MAX_SECTIONS - 5;

/**
 * Layouts offered on the empty canvas. A blank page is the hardest place to start, and these are
 * the two shapes almost every report takes; anything can be added or removed afterwards.
 */
const STARTER_LAYOUTS: ReadonlyArray<{ name: string; description: string; sections: ReportSectionType[] }> = [
  {
    name: 'Executive summary',
    description: 'Did it pass, and what stands out',
    sections: ['header', 'slo', 'apdex', 'regressions'],
  },
  {
    name: 'Full analysis',
    description: 'The complete picture, section by section',
    sections: ['header', 'slo', 'apdex', 'transaction_response_times', 'error_analysis', 'top_10_lists', 'regressions', 'trends'],
  },
];

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
  // Collapsing the catalogue hands its width to the canvas, for narrow windows and long reports.
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);

  // The builder had a ~662px hard floor: 380 (canvas) + 210 (palette) + gaps, inside a
  // DialogContent that clipped rather than scrolled, so below it part of the palette or
  // canvas was simply unreachable. Collapse the palette automatically on a narrow window —
  // the control already exists, it just defaulted to expanded and had to be found.
  const isNarrowDialog = useMediaQuery('(max-width:900px)');
  useEffect(() => {
    if (isNarrowDialog) setPaletteCollapsed(true);
  }, [isNarrowDialog]);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Report generation state (polling handled by parent component)
  const [generationStatus, setGenerationStatus] = useState<string>('');

  // Template-level baseline: sections that compare against a baseline test run
  // can all be pointed at one run from a single dropdown.
  // Every comparisons section is a baseline-run comparison — the old control-group mode is gone.
  const isBaselineSection = (s: ReportSectionConfig) => s.type === 'comparisons';
  const baselineSections = sections.filter(isBaselineSection);
  const baselineSectionCount = baselineSections.length;
  const baselineIds = new Set(
    baselineSections
      .map((s) => (s.config as Record<string, unknown> | undefined)?.baselineTestRunId)
      .filter((v): v is string => typeof v === 'string' && v.length > 0),
  );
  // One shared value when all baseline sections agree; undefined otherwise
  const sharedBaselineId = baselineIds.size === 1 ? [...baselineIds][0] : undefined;
  // Unset baselines are filtered out of the set above, so "no shared value" covers two very
  // different states: nobody has picked one yet (size 0), and they disagree (size > 1). Only
  // the second is an override.
  const baselinesDiffer = baselineIds.size > 1;
  const baselineCandidates = useBaselineCandidates(
    scope.systemId,
    testRunId,
    open && !isTemplateBuilder && baselineSectionCount > 0,
  );
  // A comparisons section with no baseline renders one empty state and nothing else, so
  // generating the report is a wasted round trip. Templates are configured without a test
  // run in hand, so they are exempt — a template may legitimately be saved unpinned.
  //
  // The block is "no baseline SELECTED", never "no candidate to pin". The picker always
  // offers the resolved-per-report sentinels, so a run with no earlier run of its own can
  // still be given a perfectly good baseline; an empty candidate list is also what a failed
  // fetch produces. Gating on the list disabled Generate on both. Same rule as the section's
  // own preview button — see previewDisabled in SectionConfigs.tsx.
  const baselineBlockReason = isTemplateBuilder || baselineSectionCount === 0
    ? null
    : baselineSections.some((s) => !(s.config as Record<string, unknown> | undefined)?.baselineTestRunId)
      ? 'Select a baseline run for every comparison section before generating the report.'
      : null;

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
    newSections[index] = { ...newSections[index], config };
    setSections(newSections);
  };

  // Handle section text change — a section-level field, never part of config
  const handleTextChange = (index: number, text: string) => {
    const newSections = [...sections];
    newSections[index] = { ...newSections[index], text };
    setSections(newSections);
  };

  // Handle section title change — a section-level field, like text above.
  // Whitespace-only input stores undefined, not '': the effective-title
  // fallback (`section.title || SECTION_RENDER_TITLES[type]`) treats '' as
  // falsy already, but leaving '' in state would still make two blanked
  // sections compare as "both titled ''" instead of "both defaulted", and
  // would round-trip to the API as an explicit empty string. Non-blank input
  // is stored as typed — trimming it here on every keystroke would strip a
  // trailing space the instant it's typed, which fights a controlled input.
  const handleTitleChange = (index: number, title: string) => {
    const newSections = [...sections];
    newSections[index] = { ...newSections[index], title: title.trim() === '' ? undefined : title };
    setSections(newSections);
  };

  // Handle add section
  const handleAddSection = (type: ReportSectionType) => {
    if (sections.length >= MAX_SECTIONS) {
      return;
    }
    // No `title` stamped here — leaving it undefined lets the card fall back to
    // config.label for display and the renderer fall back to SECTION_RENDER_TITLES
    // for the heading/anchor, which is what "leave the title blank to use the
    // default" means. Stamping the palette label here used to disagree with that
    // default for `index` (palette label "Section Index" vs rendered heading
    // "Index"), and it made every section of the same type start life
    // indistinguishable, which is exactly the setup for the duplicate-title/anchor
    // problem the title field below exists to let authors fix.
    const newSection: ReportSectionConfig = {
      type,
      order: sections.length,
    };
    setSections([...sections, newSection]);
  };

  /** Fills an empty canvas with a starting shape the reader can then edit. */
  const handleApplyStarterLayout = (types: readonly ReportSectionType[]) => {
    setSections(
      types.slice(0, MAX_SECTIONS).map((type, order) => ({
        type,
        order,
      })),
    );
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


  return (
    <ReportVariablesProvider testRunId={testRunId} enabled={open}>
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
      {/* component="div": MUI renders DialogTitle as an <h2>, and this row carries a
          chip and a button. Nesting a control inside a heading also folded their text
          into the heading's accessible name ("Generate Report Based on X Back to
          Template"), so the heading moves to the Typography below and the rest are
          its siblings. flexWrap because the chip label is an unbounded template name. */}
      <DialogTitle
        component="div"
        sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, py: 2, px: 3 }}
      >
        <DescriptionIcon sx={{ color: 'primary.main', fontSize: 28 }} />
        <Typography variant="h6" component="h2" fontWeight={500} noWrap sx={{ m: 0 }}>
          {isTemplateBuilder ? 'Configure Template Sections' : 'Generate Report'}
        </Typography>
        {/* Provenance rides on the title row rather than a banner of its own: it is
            a fact to glance at once, and a full-width Alert above the form pushed the
            section list — the thing being worked on — most of the way off screen. */}
        {!isTemplateBuilder && selectedTemplate && !showTemplateSelector && (
          <>
            <Tooltip
              title="You are editing a copy. Changes will not affect the original template."
              arrow
            >
              {/* "Copy of" carries the reassurance in the label itself. As a tooltip
                  alone it was unreachable: a Chip with no onClick gets no tabIndex, so
                  keyboard users never focused it and touch users never hovered it, and
                  the only thing left for them was a name with no reassurance attached.
                  maxWidth so an unbounded template name ellipsizes instead of pushing
                  the Back to Template button off the row. */}
              <Chip
                size="small"
                variant="outlined"
                icon={<AssignmentIcon />}
                label={`Copy of "${selectedTemplate.name}"`}
                sx={{ maxWidth: 280, minWidth: 0 }}
              />
            </Tooltip>
            <Button size="small" sx={{ ml: 'auto' }} onClick={() => setShowTemplateSelector(true)}>
              Back to Template
            </Button>
          </>
        )}
      </DialogTitle>

      {/* auto, not hidden: clipping made overflow unreachable instead of scrollable. */}
      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        {/* Top Section: Banner and Toggle */}
        <Box sx={{ flexShrink: 0 }}>
          {/* Save as Template Toggle - only in report mode.
              Switch and name share one row: stacked, an off switch still reserved
              the height of a full-width field plus its helper text, above the
              section list that is the actual work surface. */}
          {!isTemplateBuilder && (
            <Box sx={{ mx: 3, mt: 1.5, display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
              <FormControlLabel
                sx={{ mr: 0, flexShrink: 0, height: 40 }}
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
                    <Typography variant="body2">Save as template</Typography>
                  </Box>
                }
              />
              {saveAsTemplate && (
                <TextField
                  size="small"
                  label="Template Name"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Enter template name..."
                  required
                  error={(saveAsTemplate && !templateName.trim()) || templateNameTaken}
                  // Kept as visible helper text, not a tooltip: the Generate Report
                  // button disables on both of these and says nothing about why, so
                  // this is the only place the reason is written down. It costs a
                  // line of height, and only in the error state.
                  helperText={
                    !templateName.trim()
                      ? 'Template name is required'
                      : templateNameTaken
                        ? 'A template with this name already exists — choose a different name'
                        : ''
                  }
                  // minWidth so the field drops to its own line on a narrow dialog
                  // instead of collapsing below the width of its own floating label.
                  sx={{ flex: 1, minWidth: 240 }}
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
                    : baselinesDiffer
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
            {/* Left Column: the section catalogue, which yields space to the canvas */}
            <SectionPalette
              collapsed={paletteCollapsed}
              onToggleCollapsed={() => setPaletteCollapsed((c) => !c)}
              onAdd={handleAddSection}
              disabled={sections.length >= MAX_SECTIONS}
            />

            {/* Right Column: Report Layout */}
            {/* ponytail: minWidth:0 lets this flex child shrink; without it wide Selects overflow the dialog */}
            {/* minWidth is the point of this whole change: the editing surface never shrinks below
                a usable width, so a narrow window costs the catalogue its space rather than the
                forms the reader is actually filling in. */}
            <Box sx={{ flex: '1 1 auto', minWidth: 380, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
              <Box>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Report Layout
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Drag to reorder sections
                </Typography>
              </Box>
              {sections.length >= SECTION_COUNT_VISIBLE_FROM && (
                <Typography
                  variant="body2"
                  color={sections.length >= MAX_SECTIONS ? 'error.main' : 'text.secondary'}
                >
                  {sections.length} / {MAX_SECTIONS} sections
                </Typography>
              )}
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
                      onTextChange={(text) => handleTextChange(index, text)}
                      onTitleChange={(title) => handleTitleChange(index, title)}
                      onMoveUp={index > 0 ? () => handleReorder(index, index - 1) : undefined}
                      onMoveDown={index < sections.length - 1 ? () => handleReorder(index, index + 1) : undefined}
                      testRunId={testRunId}
                      systemUnderTestId={scope.systemId}
                      testEnvironment={scope.testEnvironment}
                      workload={scope.workload}
                      allSections={sections}
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
                      <Box sx={{ textAlign: 'center', maxWidth: 420 }}>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          {paletteCollapsed
                            ? 'No sections yet. Use + to add one, or start from a layout:'
                            : 'No sections yet. Pick one from the left, or start from a layout:'}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap', mt: 2 }}>
                          {STARTER_LAYOUTS.map((layout) => (
                            <Button
                              key={layout.name}
                              size="small"
                              variant="outlined"
                              onClick={() => handleApplyStarterLayout(layout.sections)}
                            >
                              <Box sx={{ textAlign: 'left' }}>
                                <Typography variant="body2" fontWeight={600}>
                                  {layout.name}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'none' }}>
                                  {layout.description}
                                </Typography>
                              </Box>
                            </Button>
                          ))}
                        </Box>
                      </Box>
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
        {baselineBlockReason && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right', mb: 1 }}>
            {baselineBlockReason}
          </Typography>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button onClick={onClose} disabled={isSubmitting} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          {!showTemplateSelector && (
            <Button
              variant="contained"
              onClick={handleGenerate}
              disabled={isSubmitting || sections.length === 0 || (saveAsTemplate && !templateName.trim()) || templateNameTaken || baselineBlockReason !== null}
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
    </ReportVariablesProvider>
  );
}

// ==================== Layout Section Card ====================

interface LayoutSectionCardProps {
  id: string;
  section: ReportSectionConfig;
  index: number;
  onDelete: () => void;
  onConfigChange: (config: Record<string, unknown>) => void;
  onTextChange: (text: string) => void;
  onTitleChange: (title: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  testRunId?: string;
  systemUnderTestId?: string;
  testEnvironment?: string;
  workload?: string;
  /** The builder's full, ordered section list — feeds the link-target picker in each MarkdownField. */
  allSections?: ReportSectionConfig[];
}

function LayoutSectionCard({ id, section, index, onDelete, onConfigChange, onTextChange, onTitleChange, onMoveUp: _onMoveUp, onMoveDown: _onMoveDown, testRunId, systemUnderTestId, testEnvironment, workload, allSections }: LayoutSectionCardProps) {
  // DB-stored templates can carry section types this build doesn't know about
  const config = SECTION_CONFIG[section.type] ?? { icon: null, label: section.type, description: '', color: '#9e9e9e' };
  const [expanded, setExpanded] = useState(false);

  // Keyed by section object identity, which holds because `allSections` is the
  // very array this card's `section` came from. O(n) per card is fine — the
  // section list is a handful of entries, never a large collection.
  const anchorWarning = useMemo(
    () => findSectionAnchorWarnings(allSections).get(section),
    [allSections, section],
  );

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

  // Render the appropriate config form. Section text is a section-level field
  // passed as its own prop — it is deliberately NOT merged into config, which
  // would collide with HeaderConfig's own `text`.
  const renderConfigForm = () => {
    const sectionConfig = (section.config || {}) as Record<string, unknown>;
    const text = getSectionText(section);

    // Each *ConfigForm declares its own concrete config type, while this dispatcher
    // is deliberately type-erased and hands the same callback to all eleven. Under
    // strictFunctionTypes those narrower parameter types are contravariant, so the
    // erasure is stated once here instead of cast at eleven call sites.
    const handleChange = <T extends object>(config: T) =>
      onConfigChange(config as Record<string, unknown>);

    switch (section.type) {
      case 'header':
        return <HeaderConfigForm config={sectionConfig} onChange={handleChange} text={text} onTextChange={onTextChange} testRunId={testRunId} allSections={allSections} />;
      case 'index':
        return <IndexConfigForm text={text} onTextChange={onTextChange} testRunId={testRunId} allSections={allSections} />;
      case 'text_block':
        return <TextBlockConfigForm config={sectionConfig} onChange={handleChange} testRunId={testRunId} allSections={allSections} />;
      case 'slo':
        return <SloConfigForm config={sectionConfig} onChange={handleChange} text={text} onTextChange={onTextChange} testRunId={testRunId} allSections={allSections} />;
      case 'apdex':
        return <ApdexConfigForm config={sectionConfig} onChange={handleChange} text={text} onTextChange={onTextChange} testRunId={testRunId} allSections={allSections} />;
      case 'transaction_response_times':
        return <TransactionResponseTimesConfigForm config={sectionConfig} onChange={handleChange} text={text} onTextChange={onTextChange} testRunId={testRunId} allSections={allSections} />;
      case 'regressions':
        return <RegressionsConfigForm config={sectionConfig} onChange={handleChange} text={text} onTextChange={onTextChange} testRunId={testRunId} allSections={allSections} />;
      case 'graphs':
        return <GraphsConfigForm config={sectionConfig} onChange={handleChange} text={text} onTextChange={onTextChange} testRunId={testRunId} allSections={allSections} />;
      case 'awr':
        return <AwrConfigForm config={sectionConfig} onChange={handleChange} text={text} onTextChange={onTextChange} testRunId={testRunId} allSections={allSections} />;
      case 'trends':
        return <TrendsConfigForm config={sectionConfig} onChange={handleChange} text={text} onTextChange={onTextChange} testRunId={testRunId} systemUnderTestId={systemUnderTestId} testEnvironment={testEnvironment} workload={workload} allSections={allSections} />;
      case 'comparisons':
        return <ComparisonsConfigForm config={sectionConfig} onChange={handleChange} text={text} onTextChange={onTextChange} testRunId={testRunId} systemUnderTestId={systemUnderTestId} testEnvironment={testEnvironment} workload={workload} allSections={allSections} />;
      case 'top_10_lists':
        return <Top10ListsConfigForm config={sectionConfig} onChange={handleChange} text={text} onTextChange={onTextChange} testRunId={testRunId} allSections={allSections} />;
      case 'error_analysis':
        return <ErrorAnalysisConfigForm config={sectionConfig} onChange={handleChange} text={text} onTextChange={onTextChange} testRunId={testRunId} allSections={allSections} />;
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
          {/*
            Deliberately `config.label` (the palette label, e.g. "Header"),
            NOT `SECTION_RENDER_TITLES[type]` (the rendered heading, e.g.
            "Report Header") used by the title field's placeholder below. This
            card is the builder's own chrome — it names the section the way
            the palette does — while the placeholder previews what the report
            will actually show. They intentionally diverge for `header` and
            `index`; see the `SECTION_RENDER_TITLES` doc comment in
            packages/shared/src/types/reports.types.ts. Do not "fix" this to
            match the placeholder — that breaks the placeholder's job instead.
          */}
          <Typography variant="body2" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {section.title || config.label}
            {/* The title field carrying the full explanation lives inside the
                collapsed body, so without this the warning is invisible until
                the author happens to expand the very card that has the problem. */}
            {anchorWarning && (
              <Tooltip title={anchorWarning}>
                <WarningAmberIcon
                  fontSize="inherit"
                  color="error"
                  aria-label="Link target problem"
                  sx={{ flexShrink: 0 }}
                />
              </Tooltip>
            )}
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
          {/* Section title — the only place an author can give a section a
              distinct title, which is what makes duplicate-title anchors
              (e.g. two "Custom Graphs" sections) avoidable rather than just
              flagged. Blank means "use the default heading", so the
              placeholder shows exactly that default. */}
          <TextField
            label="Section Title"
            value={section.title ?? ''}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder={SECTION_RENDER_TITLES[section.type] ?? config.label}
            error={Boolean(anchorWarning)}
            helperText={
              anchorWarning ??
              'Shown as the section heading and used to build its link anchor. Leave blank to use the default.'
            }
            fullWidth
            size="small"
            sx={{ mb: 2 }}
          />
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
          <SectionTitleProvider value={section.title}>{renderConfigForm()}</SectionTitleProvider>
        </Box>
      </Collapse>
    </Box>
  );
}

export default GenerateReportDialog;
