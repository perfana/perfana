'use client';

/**
 * AWR Upload Zone Component
 *
 * A drag & drop file upload zone for AWR (Automatic Workload Repository) reports.
 * Supports both drag & drop and file browser selection with validation,
 * progress indication, and error handling.
 *
 * Features:
 * - Drag & drop file upload
 * - File browser selection
 * - URL-based upload (optional)
 * - File validation (type, size)
 * - Upload progress indication
 * - Error handling with snackbar notifications
 * - Accessible with keyboard navigation
 *
 * @example
 * ```tsx
 * <AwrUploadZone
 *   testRunId={testRun.id}
 *   onUploadSuccess={(report) => console.log('Uploaded:', report.id)}
 *   onSnackbar={(message, severity) => showSnackbar(message, severity)}
 * />
 * ```
 */

import { useState, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  CircularProgress,
  Button,
  TextField,
  Collapse,
  Link,
  InputAdornment,
  IconButton,
  alpha,
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  InsertDriveFile as FileIcon,
  Link as LinkIcon,
  Close as CloseIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import type { AwrUploadZoneProps, SnackbarSeverity } from './types';
import type { UploadAwrReportResponse } from '@/lib/api/awr-reports';
import {
  useUploadAwrReport,
  validateAwrFile,
  validateAwrUrl,
  ACCEPTED_AWR_FILE_TYPES,
  MAX_AWR_FILE_SIZE,
} from './hooks/useUploadAwrReport';

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * AWR Upload Zone Component
 *
 * Provides drag & drop and file browser upload functionality for AWR reports.
 */
export default function AwrUploadZone({
  testRunId,
  onUploadSuccess,
  onUploadError,
  onSnackbar,
  disabled = false,
  className,
  compact = false,
}: AwrUploadZoneProps): JSX.Element {
  // Local state
  const [isDragActive, setIsDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [urlInputVisible, setUrlInputVisible] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  /**
   * Handle successful upload
   */
  const handleUploadSuccess = useCallback(
    (response: UploadAwrReportResponse): void => {
      setSelectedFile(null);
      setUrlValue('');
      setUrlInputVisible(false);
      onUploadSuccess?.(response);
    },
    [onUploadSuccess]
  );

  /**
   * Handle upload error
   */
  const handleUploadError = useCallback(
    (error: Error): void => {
      onUploadError?.(error);
    },
    [onUploadError]
  );

  // Upload hook
  const {
    uploadFile,
    uploadByUrl,
    isUploading,
    isUploadingByUrl,
    isAnyUploading,
    uploadError,
    uploadByUrlError,
    reset,
    resetUrlMutation,
  } = useUploadAwrReport(testRunId, {
    onSuccess: handleUploadSuccess,
    onError: handleUploadError,
    onSnackbar: onSnackbar as (message: string, severity?: SnackbarSeverity) => void,
  });

  /**
   * Handle file selection from input or drop
   */
  const handleFileSelect = useCallback(
    (file: File): void => {
      // Validate file
      const validation = validateAwrFile(file);
      if (!validation.valid) {
        onSnackbar?.(validation.error || 'Invalid file', 'error');
        return;
      }

      setSelectedFile(file);
      reset();

      // Auto-upload on selection
      uploadFile(file);
    },
    [onSnackbar, reset, uploadFile]
  );

  /**
   * Handle drag events
   */
  const handleDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>): void => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled && !isAnyUploading) {
        setIsDragActive(true);
      }
    },
    [disabled, isAnyUploading]
  );

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    // Only deactivate if leaving the drop zone entirely
    if (e.currentTarget === e.target) {
      setIsDragActive(false);
    }
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>): void => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled && !isAnyUploading) {
        e.dataTransfer.dropEffect = 'copy';
      }
    },
    [disabled, isAnyUploading]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>): void => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragActive(false);

      if (disabled || isAnyUploading) {
        return;
      }

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file) {
          handleFileSelect(file);
        }
      }
    },
    [disabled, isAnyUploading, handleFileSelect]
  );

  /**
   * Handle file input change
   */
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      const files = e.target.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file) {
          handleFileSelect(file);
        }
      }
      // Reset input so same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [handleFileSelect]
  );

  /**
   * Open file browser
   */
  const handleBrowseClick = useCallback((): void => {
    if (!disabled && !isAnyUploading && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [disabled, isAnyUploading]);

  /**
   * Handle URL upload
   */
  const handleUrlSubmit = useCallback((): void => {
    const validation = validateAwrUrl(urlValue);
    if (!validation.valid) {
      setUrlError(validation.error || 'Invalid URL');
      return;
    }

    setUrlError(null);
    resetUrlMutation();
    uploadByUrl(urlValue);
  }, [urlValue, resetUrlMutation, uploadByUrl]);

  /**
   * Handle URL input key press
   */
  const handleUrlKeyPress = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === 'Enter' && !disabled && !isUploadingByUrl) {
        handleUrlSubmit();
      }
    },
    [disabled, isUploadingByUrl, handleUrlSubmit]
  );

  /**
   * Clear URL input
   */
  const handleClearUrl = useCallback((): void => {
    setUrlValue('');
    setUrlError(null);
    resetUrlMutation();
  }, [resetUrlMutation]);

  /**
   * Toggle URL input visibility
   */
  const handleToggleUrlInput = useCallback((): void => {
    setUrlInputVisible((prev) => !prev);
    if (urlInputVisible) {
      handleClearUrl();
    }
  }, [urlInputVisible, handleClearUrl]);

  // Determine border color based on state
  const getBorderColor = (): string => {
    if (uploadError || uploadByUrlError) {
      return '#f44336'; // error
    }
    if (isDragActive) {
      return '#1976d2'; // primary
    }
    if (isAnyUploading) {
      return '#ff9800'; // warning
    }
    return '#e0e0e0'; // default
  };

  // Determine background color based on state
  const getBackgroundColor = (): string => {
    if (isDragActive) {
      return alpha('#1976d2', 0.08);
    }
    if (isAnyUploading) {
      return alpha('#ff9800', 0.04);
    }
    return '#fafafa';
  };

  // Compact mode renders minimal UI
  if (compact) {
    return (
      <Box className={className}>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_AWR_FILE_TYPES.join(',')}
          onChange={handleInputChange}
          style={{ display: 'none' }}
          id={`awr-file-input-${testRunId}`}
          disabled={disabled || isAnyUploading}
          aria-label="Upload AWR report file"
        />
        <Button
          variant="outlined"
          size="small"
          startIcon={isAnyUploading ? <CircularProgress size={16} /> : <UploadIcon />}
          onClick={handleBrowseClick}
          disabled={disabled || isAnyUploading}
          sx={{ textTransform: 'none' }}
        >
          {isAnyUploading ? 'Uploading...' : 'Upload AWR Report'}
        </Button>
      </Box>
    );
  }

  return (
    <Box className={className}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_AWR_FILE_TYPES.join(',')}
        onChange={handleInputChange}
        style={{ display: 'none' }}
        id={`awr-file-input-${testRunId}`}
        disabled={disabled || isAnyUploading}
        aria-label="Upload AWR report file"
      />

      {/* Drop Zone */}
      <Box
        ref={dropZoneRef}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleBrowseClick}
        role="button"
        tabIndex={disabled || isAnyUploading ? -1 : 0}
        aria-label="Upload AWR report. Drag and drop or click to browse"
        aria-disabled={disabled || isAnyUploading}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled && !isAnyUploading) {
            e.preventDefault();
            handleBrowseClick();
          }
        }}
        sx={{
          border: `2px dashed ${getBorderColor()}`,
          borderRadius: 2,
          p: 4,
          textAlign: 'center',
          cursor: disabled || isAnyUploading ? 'not-allowed' : 'pointer',
          backgroundColor: getBackgroundColor(),
          transition: 'all 0.2s ease-in-out',
          opacity: disabled ? 0.6 : 1,
          '&:hover': {
            borderColor: disabled || isAnyUploading ? undefined : '#1976d2',
            backgroundColor: disabled || isAnyUploading ? undefined : alpha('#1976d2', 0.04),
          },
          '&:focus': {
            outline: 'none',
            borderColor: '#1976d2',
            boxShadow: `0 0 0 3px ${alpha('#1976d2', 0.2)}`,
          },
        }}
      >
        {/* Uploading state */}
        {isAnyUploading && (
          <Box>
            <CircularProgress size={48} sx={{ mb: 2 }} />
            <Typography variant="body1" color="text.primary" sx={{ fontWeight: 500 }}>
              {isUploading ? 'Uploading file...' : 'Uploading from URL...'}
            </Typography>
            {selectedFile && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {selectedFile.name} ({formatFileSize(selectedFile.size)})
              </Typography>
            )}
          </Box>
        )}

        {/* Error state */}
        {!isAnyUploading && (uploadError || uploadByUrlError) && (
          <Box>
            <ErrorIcon sx={{ fontSize: 48, color: 'error.main', mb: 2 }} />
            <Typography variant="body1" color="error.main" sx={{ fontWeight: 500 }}>
              Upload failed
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {uploadError?.message || uploadByUrlError?.message || 'An error occurred'}
            </Typography>
            <Button
              variant="text"
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                reset();
                resetUrlMutation();
                setSelectedFile(null);
              }}
              sx={{ mt: 2, textTransform: 'none' }}
            >
              Try again
            </Button>
          </Box>
        )}

        {/* Default/drag state */}
        {!isAnyUploading && !uploadError && !uploadByUrlError && (
          <Box>
            {isDragActive ? (
              <SuccessIcon sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
            ) : (
              <UploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            )}
            <Typography variant="body1" color="text.primary" sx={{ fontWeight: 500 }}>
              {isDragActive ? 'Drop your AWR report here' : 'Drag & drop your AWR report here'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              or{' '}
              <Link
                component="span"
                sx={{ cursor: 'pointer', fontWeight: 500 }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleBrowseClick();
                }}
              >
                browse files
              </Link>
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
              Accepted formats: HTML (.html, .htm) | Max size: {formatFileSize(MAX_AWR_FILE_SIZE)}
            </Typography>
          </Box>
        )}
      </Box>

      {/* URL Upload Section */}
      <Box sx={{ mt: 2 }}>
        <Button
          variant="text"
          size="small"
          startIcon={<LinkIcon />}
          onClick={handleToggleUrlInput}
          disabled={disabled || isUploading}
          sx={{ textTransform: 'none', color: 'text.secondary' }}
        >
          {urlInputVisible ? 'Hide URL upload' : 'Upload from URL'}
        </Button>

        <Collapse in={urlInputVisible}>
          <Box sx={{ mt: 2 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="https://example.com/awr-report.html"
              value={urlValue}
              onChange={(e) => {
                setUrlValue(e.target.value);
                setUrlError(null);
              }}
              onKeyDown={handleUrlKeyPress}
              disabled={disabled || isUploadingByUrl}
              error={!!urlError}
              helperText={urlError}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <LinkIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
                endAdornment: urlValue && (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={handleClearUrl}
                      disabled={isUploadingByUrl}
                      aria-label="Clear URL"
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              aria-label="AWR report URL"
            />
            <Button
              variant="contained"
              size="small"
              onClick={handleUrlSubmit}
              disabled={disabled || isUploadingByUrl || !urlValue.trim()}
              startIcon={isUploadingByUrl ? <CircularProgress size={16} /> : <UploadIcon />}
              sx={{ mt: 1, textTransform: 'none' }}
            >
              {isUploadingByUrl ? 'Uploading...' : 'Upload from URL'}
            </Button>
          </Box>
        </Collapse>
      </Box>

      {/* Selected file info (when file is selected but not yet uploading) */}
      {selectedFile && !isAnyUploading && !uploadError && (
        <Box
          sx={{
            mt: 2,
            p: 2,
            borderRadius: 1,
            backgroundColor: alpha('#4caf50', 0.08),
            border: `1px solid ${alpha('#4caf50', 0.3)}`,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <FileIcon sx={{ color: '#4caf50' }} />
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {selectedFile.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatFileSize(selectedFile.size)}
            </Typography>
          </Box>
          <SuccessIcon sx={{ color: '#4caf50' }} />
        </Box>
      )}
    </Box>
  );
}

// Named export for flexibility
export { AwrUploadZone };
