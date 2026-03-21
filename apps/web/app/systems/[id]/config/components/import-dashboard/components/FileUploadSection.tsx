'use client';

import { Box, Button, Typography, CircularProgress } from '@mui/material';
import { Upload as UploadIcon } from '@mui/icons-material';

interface FileUploadSectionProps {
  file: File | null;
  isAnalyzing: boolean;
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export function FileUploadSection({
  file,
  isAnalyzing,
  onFileSelect,
}: FileUploadSectionProps) {
  return (
    <Box sx={{ mb: 3 }}>
      <input
        type="file"
        accept=".json"
        onChange={onFileSelect}
        style={{ display: 'none' }}
        id="dashboard-file-input"
      />
      <label htmlFor="dashboard-file-input">
        <Button
          variant="outlined"
          component="span"
          startIcon={<UploadIcon />}
          sx={{ mb: 2 }}
        >
          Select Dashboard File
        </Button>
      </label>

      {file && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Selected: {file.name}
            {isAnalyzing && (
              <Box
                component="span"
                sx={{ ml: 1, display: 'inline-flex', alignItems: 'center' }}
              >
                <CircularProgress size={12} sx={{ mr: 0.5 }} />
                Analyzing...
              </Box>
            )}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
