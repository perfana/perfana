'use client';

import React, { useState } from 'react';
import {
  Dialog,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Box,
  Button,
  Paper,
  Divider,
  Chip,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import VisibilityIcon from '@mui/icons-material/Visibility';
import NotesIcon from '@mui/icons-material/Notes';
import { MarkdownField } from './MarkdownField';
import { REPORT_LIMITS } from '@/lib/api/reports';

export interface SectionPreviewModalProps {
  open: boolean;
  onClose: () => void;
  sectionTitle: string;
  sectionType: string;
  children: React.ReactNode; // The preview content (section-specific renderer)
  initialText?: string;
  onSaveText?: (text: string) => void;
  testRunId?: string;
}

/**
 * Generic modal for previewing a report section and editing its accompanying text
 *
 * Usage:
 * <SectionPreviewModal
 *   open={previewOpen}
 *   onClose={() => setPreviewOpen(false)}
 *   sectionTitle="Apdex Score"
 *   sectionType="Apdex"
 *   initialText={text}
 *   onSaveText={onTextChange}
 * >
 *   <ApdexSectionPreview testRunId={testRunId} config={config} />
 * </SectionPreviewModal>
 */
export default function SectionPreviewModal({
  open,
  onClose,
  sectionTitle,
  sectionType,
  children,
  initialText = '',
  onSaveText,
  testRunId: _testRunId,
}: SectionPreviewModalProps) {
  const [text, setText] = useState(initialText);
  const [hasChanges, setHasChanges] = useState(false);

  // MarkdownField hands back the string, not a change event.
  const handleTextChange = (value: string) => {
    setText(value);
    setHasChanges(value !== initialText);
  };

  const handleSave = () => {
    if (onSaveText) {
      onSaveText(text);
    }
    setHasChanges(false);
    onClose();
  };

  const handleClose = () => {
    // Reset to the initial value if not saved
    setText(initialText);
    setHasChanges(false);
    onClose();
  };

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={handleClose}
      TransitionProps={{
        onEnter: () => {
          // Reset state when modal opens
          setText(initialText);
          setHasChanges(false);
        },
      }}
    >
      <AppBar sx={{ position: 'relative', background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)' }}>
        <Toolbar>
          <VisibilityIcon sx={{ mr: 2 }} />
          <Typography sx={{ flex: 1 }} variant="h6" component="div">
            Preview: {sectionTitle}
          </Typography>
          <Chip
            label={sectionType}
            size="small"
            sx={{
              mr: 2,
              bgcolor: 'rgba(255, 255, 255, 0.2)',
              color: 'white',
              fontWeight: 600,
            }}
          />
          <IconButton
            edge="end"
            color="inherit"
            onClick={handleClose}
            aria-label="close"
          >
            <CloseIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        {/* Preview Content Area */}
        <Box
          sx={{
            flex: 1,
            overflow: 'auto',
            bgcolor: '#f5f5f5',
            p: 3,
          }}
        >
          <Paper
            elevation={2}
            sx={{
              p: 3,
              mb: 3,
              borderRadius: 2,
            }}
          >
            {children}
          </Paper>

          {/* Accompanying Text — omitted entirely when the caller has no way
              to save it (e.g. text_block sections, whose Content field
              already is the text). Rendering a read-only editor here would
              let users type into it and silently lose the input on save. */}
          {onSaveText && (
            <Paper
              elevation={2}
              sx={{
                p: 3,
                borderRadius: 2,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <NotesIcon sx={{ mr: 1, color: '#1976d2' }} />
                <Typography variant="h6" component="div">
                  Text
                </Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Add text based on what you see in the preview above. It is saved with the
                section configuration and rendered above this section in the report.
              </Typography>
              <MarkdownField
                label="Text"
                value={text}
                onChange={handleTextChange}
                placeholder="Write the text that accompanies this section, or use the buttons above to format it"
                rows={6}
                maxLength={REPORT_LIMITS.MAX_SECTION_TEXT_LENGTH}
                helperText={`${text.length} / ${REPORT_LIMITS.MAX_SECTION_TEXT_LENGTH} characters`}
              />
            </Paper>
          )}
        </Box>

        {/* Action Bar */}
        <Paper
          elevation={4}
          sx={{
            p: 2,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid rgba(0, 0, 0, 0.12)',
          }}
        >
          <Box>
            {hasChanges && (
              <Chip
                label="Unsaved changes"
                size="small"
                color="warning"
                sx={{ fontWeight: 600 }}
              />
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="outlined"
              onClick={handleClose}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
              }}
            >
              Cancel
            </Button>
            {onSaveText && (
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={!hasChanges && text === initialText}
                sx={{
                  textTransform: 'none',
                  fontWeight: 600,
                  background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)',
                  '&:hover': {
                    background: 'linear-gradient(135deg, #1565c0 0%, #0d47a1 100%)',
                  },
                }}
              >
                Save Text
              </Button>
            )}
          </Box>
        </Paper>
      </Box>
    </Dialog>
  );
}
