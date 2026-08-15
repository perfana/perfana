'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  TextField,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
} from '@mui/material';
import {
  Description as DescriptionIcon,
  Save as SaveIcon,
} from '@mui/icons-material';
import {
  getTemplate,
  type TemplateListItem,
  type ReportSectionConfig,
  type ReportStyling,
} from '@/lib/api/reports';
import { GenerateReportDialog } from '@/components/reports/report-generation';

export interface TemplateManagementDialogProps {
  open: boolean;
  onClose: () => void;
  template: TemplateListItem | null;
  systemId: string;
  systemName: string;
  testEnvironment: string;
  workload: string;
  isEdit: boolean;
  onSubmit: (
    name: string,
    description: string | undefined,
    sections: ReportSectionConfig[],
    styling: ReportStyling | undefined,
    isDefault: boolean
  ) => Promise<void>;
  loading: boolean;
}

export function TemplateManagementDialog({
  open,
  onClose,
  template,
  systemId,
  systemName: _systemName,
  testEnvironment,
  workload,
  isEdit,
  onSubmit,
  loading,
}: TemplateManagementDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [sections, setSections] = useState<ReportSectionConfig[]>([]);
  const [styling, setStyling] = useState<ReportStyling | undefined>(undefined);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSectionBuilder, setShowSectionBuilder] = useState(false);

  // Load template details when editing
  useEffect(() => {
    if (open && isEdit && template) {
      const loadTemplate = async () => {
        try {
          setTemplateLoading(true);
          const detail = await getTemplate(template.id);
          setName(detail.name);
          setDescription(detail.description || '');
          setIsDefault(detail.is_default);
          setSections(detail.sections || []);
          setStyling(detail.styling);
        } catch (err) {
          setError(
            err && typeof err === 'object' && 'message' in err
              ? (err as Error).message
              : 'Failed to load template'
          );
        } finally {
          setTemplateLoading(false);
        }
      };
      loadTemplate();
    } else if (open && !isEdit) {
      // Reset for new template
      setName('');
      setDescription('');
      setIsDefault(false);
      setSections([]);
      setStyling(undefined);
    }
  }, [open, isEdit, template]);

  // Clear error when dialog closes
  useEffect(() => {
    if (!open) {
      setError(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Template name is required');
      return;
    }

    try {
      setError(null);
      await onSubmit(name.trim(), description.trim() || undefined, sections, styling, isDefault);
      onClose();
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to save template'
      );
    }
  };

  const handleOpenSectionBuilder = () => {
    setShowSectionBuilder(true);
  };

  const handleSectionBuilderClose = () => {
    setShowSectionBuilder(false);
  };

  const handleSectionsConfigured = (configuredSections: ReportSectionConfig[], configuredStyling?: ReportStyling) => {
    setSections(configuredSections);
    if (configuredStyling) {
      setStyling(configuredStyling);
    }
    setShowSectionBuilder(false);
  };

  return (
    <>
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <DescriptionIcon color="primary" />
        <Typography variant="h6" component="span">
          {isEdit ? 'Edit Template' : 'Create Template'}
        </Typography>
      </DialogTitle>

      <DialogContent>
        {templateLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

            <Box
              sx={{
                p: 2,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                bgcolor: 'background.default',
              }}
            >
              <Typography variant="subtitle2" gutterBottom>
                Template Sections
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {sections.length > 0
                  ? `${sections.length} section(s) configured`
                  : 'No sections configured yet'}
              </Typography>
              {sections.length > 0 && (
                <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {sections.map((section, index) => (
                    <Typography
                      key={index}
                      variant="caption"
                      sx={{
                        px: 1,
                        py: 0.25,
                        bgcolor: 'action.hover',
                        borderRadius: 0.5,
                      }}
                    >
                      {section.type}
                    </Typography>
                  ))}
                </Box>
              )}
              <Button
                variant="outlined"
                size="small"
                onClick={handleOpenSectionBuilder}
                disabled={loading}
                sx={{ mt: 1.5 }}
              >
                {sections.length > 0 ? 'Edit Sections' : 'Configure Sections'}
              </Button>
            </Box>

            <TextField
              label="Template Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
              required
              disabled={loading}
            />

            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              multiline
              rows={3}
              disabled={loading}
              helperText="Optional description to help identify this template"
            />

            <FormControlLabel
              control={
                <Switch
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  disabled={loading}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">Set as default template</Typography>
                  <Typography variant="caption" color="text.secondary">
                    This template will be pre-selected when generating reports
                  </Typography>
                </Box>
              }
            />
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={loading || templateLoading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={loading || templateLoading || !name.trim()}
          startIcon={loading ? <CircularProgress size={16} /> : <SaveIcon />}
        >
          {loading ? 'Saving...' : isEdit ? 'Update' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>

    {/* Section Builder Dialog */}
    {showSectionBuilder && (
      <GenerateReportDialog
        open={showSectionBuilder}
        onClose={handleSectionBuilderClose}
        scope={{
          systemId,
          testEnvironment,
          workload,
        }}
        mode="template-builder"
        initialSections={sections}
        initialStyling={styling}
        onTemplateBuilt={handleSectionsConfigured}
      />
    )}
    </>
  );
}

export default TemplateManagementDialog;
