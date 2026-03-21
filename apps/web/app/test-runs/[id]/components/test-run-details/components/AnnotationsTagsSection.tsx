'use client';

import {
  Box,
  Typography,
  IconButton,
  TextField,
  Chip,
  Autocomplete,
  CircularProgress,
  useTheme,
} from '@mui/material';
import { Edit, Save, Cancel } from '@mui/icons-material';
import { TestRun } from '@/types/test-runs';

interface AnnotationsTagsSectionProps {
  testRun: TestRun;
  isEditingAnnotations: boolean;
  editingAnnotations: string;
  annotationsSaving: boolean;
  isEditingTags: boolean;
  editingTags: string[];
  tagsSaving: boolean;
  allAvailableTags: string[];
  onAnnotationsEdit: () => void;
  onAnnotationsCancel: () => void;
  onAnnotationsSave: () => void;
  onAnnotationsChange: (value: string) => void;
  onTagsEdit: () => void;
  onTagsCancel: () => void;
  onTagsSave: () => void;
  onTagsChange: (value: string[]) => void;
}

export function AnnotationsTagsSection({
  testRun,
  isEditingAnnotations,
  editingAnnotations,
  annotationsSaving,
  isEditingTags,
  editingTags,
  tagsSaving,
  allAvailableTags,
  onAnnotationsEdit,
  onAnnotationsCancel,
  onAnnotationsSave,
  onAnnotationsChange,
  onTagsEdit,
  onTagsCancel,
  onTagsSave,
  onTagsChange,
}: AnnotationsTagsSectionProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  return (
    <Box sx={{
      p: 3,
      backgroundColor: isDark ? 'rgba(255, 152, 0, 0.04)' : 'rgba(255, 255, 255, 0.7)',
      backdropFilter: 'blur(10px)',
      border: isDark ? '1px solid rgba(255, 152, 0, 0.15)' : '1px solid rgba(255, 152, 0, 0.08)',
      borderRadius: 3,
      borderLeft: '4px solid',
      borderLeftColor: isDark ? '#ffb74d' : '#ff9800',
      boxShadow: isDark ? '0 2px 8px rgba(0, 0, 0, 0.2)' : '0 2px 8px rgba(0, 0, 0, 0.04)',
      transition: 'all 0.2s ease',
      '&:hover': {
        boxShadow: isDark ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 4px 12px rgba(0, 0, 0, 0.08)',
        borderLeftColor: isDark ? '#ffcc80' : '#f57c00',
      }
    }}>
      <Typography
        variant="overline"
        sx={{
          display: 'block',
          fontSize: '0.875rem',
          fontWeight: 700,
          letterSpacing: '0.5px',
          color: '#ff9800',
          mb: 2.5,
        }}
      >
        Annotations & Tags
      </Typography>

      {/* Annotations */}
      <Box sx={{ mb: 3 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.75}>
          <Typography
            variant="caption"
            sx={{
              fontSize: '0.75rem',
              fontWeight: 500,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: 'text.secondary',
              opacity: 0.8,
            }}
          >
            Annotations
          </Typography>
          {!isEditingAnnotations ? (
            <IconButton
              size="small"
              onClick={onAnnotationsEdit}
              title="Edit annotations"
              sx={{
                width: 28,
                height: 28,
                color: '#ff9800',
                '&:hover': {
                  backgroundColor: 'rgba(255, 152, 0, 0.08)',
                }
              }}
            >
              <Edit sx={{ fontSize: '1rem' }} />
            </IconButton>
          ) : (
            <Box display="flex" gap={0.5}>
              <IconButton
                size="small"
                onClick={onAnnotationsSave}
                disabled={annotationsSaving}
                title="Save annotations"
                sx={{
                  width: 28,
                  height: 28,
                  color: 'success.main',
                  '&:hover': {
                    backgroundColor: 'rgba(76, 175, 80, 0.08)',
                  }
                }}
              >
                {annotationsSaving ? <CircularProgress size={14} /> : <Save sx={{ fontSize: '1rem' }} />}
              </IconButton>
              <IconButton
                size="small"
                onClick={onAnnotationsCancel}
                disabled={annotationsSaving}
                title="Cancel editing"
                sx={{
                  width: 28,
                  height: 28,
                  color: 'text.secondary',
                  '&:hover': {
                    backgroundColor: 'action.hover',
                  }
                }}
              >
                <Cancel sx={{ fontSize: '1rem' }} />
              </IconButton>
            </Box>
          )}
        </Box>

        {!isEditingAnnotations ? (
          <Box sx={{
            mt: 1,
            p: 2,
            backgroundColor: isDark ? 'rgba(255, 152, 0, 0.06)' : 'rgba(255, 152, 0, 0.03)',
            borderRadius: 2,
            border: isDark ? '1px solid rgba(255, 152, 0, 0.15)' : '1px solid rgba(255, 152, 0, 0.1)',
            minHeight: '80px',
          }}>
            {testRun.annotations && testRun.annotations.length > 0 ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {testRun.annotations.map((annotation, idx) => (
                  <Box
                    key={idx}
                    sx={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 1,
                    }}
                  >
                    <Box sx={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      backgroundColor: '#ff9800',
                      mt: 0.75,
                      flexShrink: 0,
                    }} />
                    <Typography
                      variant="body2"
                      sx={{
                        fontSize: '0.875rem',
                        color: 'text.primary',
                        lineHeight: 1.6,
                      }}
                    >
                      {annotation}
                    </Typography>
                  </Box>
                ))}
              </Box>
            ) : (
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                  fontStyle: 'italic',
                  fontSize: '0.875rem',
                  opacity: 0.6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                }}
              >
                No annotations added
              </Typography>
            )}
          </Box>
        ) : (
          <TextField
            multiline
            rows={4}
            value={editingAnnotations}
            onChange={(e) => onAnnotationsChange(e.target.value)}
            placeholder="Add annotations (one per line)..."
            size="small"
            fullWidth
            helperText="Enter each annotation on a separate line"
            sx={{
              mt: 1,
              '& .MuiOutlinedInput-root': {
                backgroundColor: 'white',
              }
            }}
          />
        )}
      </Box>

      {/* Tags */}
      <Box>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.75}>
          <Typography
            variant="caption"
            sx={{
              fontSize: '0.75rem',
              fontWeight: 500,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: 'text.secondary',
              opacity: 0.8,
            }}
          >
            Tags
          </Typography>
          {!isEditingTags ? (
            <IconButton
              size="small"
              onClick={onTagsEdit}
              title="Edit tags"
              sx={{
                width: 28,
                height: 28,
                color: '#ff9800',
                '&:hover': {
                  backgroundColor: 'rgba(255, 152, 0, 0.08)',
                }
              }}
            >
              <Edit sx={{ fontSize: '1rem' }} />
            </IconButton>
          ) : (
            <Box display="flex" gap={0.5}>
              <IconButton
                size="small"
                onClick={onTagsSave}
                disabled={tagsSaving}
                title="Save tags"
                sx={{
                  width: 28,
                  height: 28,
                  color: 'success.main',
                  '&:hover': {
                    backgroundColor: 'rgba(76, 175, 80, 0.08)',
                  }
                }}
              >
                {tagsSaving ? <CircularProgress size={14} /> : <Save sx={{ fontSize: '1rem' }} />}
              </IconButton>
              <IconButton
                size="small"
                onClick={onTagsCancel}
                disabled={tagsSaving}
                title="Cancel editing"
                sx={{
                  width: 28,
                  height: 28,
                  color: 'text.secondary',
                  '&:hover': {
                    backgroundColor: 'action.hover',
                  }
                }}
              >
                <Cancel sx={{ fontSize: '1rem' }} />
              </IconButton>
            </Box>
          )}
        </Box>

        {!isEditingTags ? (
          <Box display="flex" gap={1} flexWrap="wrap" mt={1}>
            {testRun.tags && testRun.tags.length > 0 ? (
              testRun.tags.map((tag, index) => (
                <Chip
                  key={index}
                  label={tag}
                  size="small"
                  sx={{
                    height: '28px',
                    backgroundColor: 'rgba(255, 152, 0, 0.08)',
                    border: '1px solid rgba(255, 152, 0, 0.2)',
                    color: '#f57c00',
                    fontWeight: 500,
                    fontSize: '0.8125rem',
                  }}
                />
              ))
            ) : (
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                  fontStyle: 'italic',
                  fontSize: '0.875rem',
                  opacity: 0.6,
                }}
              >
                No tags assigned
              </Typography>
            )}
          </Box>
        ) : (
          <Autocomplete
            multiple
            freeSolo
            options={allAvailableTags}
            value={editingTags}
            onChange={(_, newValue) => onTagsChange(newValue)}
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Add tags..."
                size="small"
                helperText="Type to add new tags or select from existing ones"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'white',
                  }
                }}
              />
            )}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip
                  {...getTagProps({ index })}
                  key={index}
                  label={option}
                  size="small"
                  sx={{
                    backgroundColor: 'rgba(255, 152, 0, 0.08)',
                    border: '1px solid rgba(255, 152, 0, 0.2)',
                  }}
                />
              ))
            }
          />
        )}
      </Box>
    </Box>
  );
}
