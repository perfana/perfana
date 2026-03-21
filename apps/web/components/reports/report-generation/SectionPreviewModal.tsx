'use client';

import React, { useState } from 'react';
import {
  Dialog,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Box,
  TextField,
  Button,
  Paper,
  Divider,
  Chip,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CommentIcon from '@mui/icons-material/Comment';

export interface SectionPreviewModalProps {
  open: boolean;
  onClose: () => void;
  sectionTitle: string;
  sectionType: string;
  children: React.ReactNode; // The preview content (section-specific renderer)
  initialComment?: string;
  onSaveComment?: (comment: string) => void;
  testRunId?: string;
}

/**
 * Generic modal for previewing report sections with comment capability
 *
 * Usage:
 * <SectionPreviewModal
 *   open={previewOpen}
 *   onClose={() => setPreviewOpen(false)}
 *   sectionTitle="Apdex Score"
 *   sectionType="Apdex"
 *   initialComment={config.comment}
 *   onSaveComment={(comment) => onChange({ ...config, comment })}
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
  initialComment = '',
  onSaveComment,
  testRunId,
}: SectionPreviewModalProps) {
  const [comment, setComment] = useState(initialComment);
  const [hasChanges, setHasChanges] = useState(false);

  const handleCommentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setComment(event.target.value);
    setHasChanges(event.target.value !== initialComment);
  };

  const handleSave = () => {
    if (onSaveComment) {
      onSaveComment(comment);
    }
    setHasChanges(false);
    onClose();
  };

  const handleClose = () => {
    // Reset comment to initial value if not saved
    setComment(initialComment);
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
          setComment(initialComment);
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

          {/* Comment Section */}
          <Paper
            elevation={2}
            sx={{
              p: 3,
              borderRadius: 2,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <CommentIcon sx={{ mr: 1, color: '#1976d2' }} />
              <Typography variant="h6" component="div">
                Section Comments
              </Typography>
            </Box>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Add comments or observations based on what you see in the preview above.
              These comments will be saved with the section configuration.
            </Typography>
            <TextField
              fullWidth
              multiline
              rows={6}
              value={comment}
              onChange={handleCommentChange}
              placeholder="Enter your comments about this section..."
              variant="outlined"
              helperText={`${comment.length} / 2000 characters`}
              inputProps={{
                maxLength: 2000,
              }}
              sx={{
                '& .MuiOutlinedInput-root': {
                  '&:hover fieldset': {
                    borderColor: '#1976d2',
                  },
                },
              }}
            />
          </Paper>
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
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={!hasChanges && comment === initialComment}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)',
                '&:hover': {
                  background: 'linear-gradient(135deg, #1565c0 0%, #0d47a1 100%)',
                },
              }}
            >
              Save Comment
            </Button>
          </Box>
        </Paper>
      </Box>
    </Dialog>
  );
}
