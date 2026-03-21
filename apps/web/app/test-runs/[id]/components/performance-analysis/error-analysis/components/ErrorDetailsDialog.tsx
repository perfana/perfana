'use client';

import {
  Box,
  Typography,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  useTheme,
} from '@mui/material';
import {
  Error as ErrorIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import FancyChip from '../../../shared/FancyChip';
import { ErrorDetail } from '../types';
import { formatJson } from '../utils/error-formatters';

interface ErrorDetailsDialogProps {
  open: boolean;
  onClose: () => void;
  selectedError: ErrorDetail | null;
}

interface DetailLabelProps {
  label: string;
}

function DetailLabel({ label }: DetailLabelProps) {
  return (
    <Typography
      variant="caption"
      sx={{
        display: 'block',
        fontSize: '0.7rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        color: 'text.secondary',
        mb: 0.5,
      }}
    >
      {label}
    </Typography>
  );
}

interface CodeBlockProps {
  content: string;
  backgroundColor?: string;
  borderColor?: string;
  maxHeight?: string | number;
  formatAsJson?: boolean;
}

function CodeBlock({
  content,
  backgroundColor,
  borderColor,
  maxHeight = '150px',
  formatAsJson = false,
}: CodeBlockProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const displayContent = formatAsJson ? formatJson(content) : content;

  const resolvedBg = backgroundColor ?? (isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)');
  const resolvedBorder = borderColor ?? (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)');

  return (
    <Box
      sx={{
        p: 1.5,
        mb: 2,
        backgroundColor: resolvedBg,
        border: `1px solid ${resolvedBorder}`,
        borderRadius: 1,
        fontFamily: 'monospace',
        fontSize: maxHeight === 'none' ? '0.8rem' : '0.75rem',
        maxHeight,
        overflowY: 'auto',
        overflowX: 'auto',
        wordBreak: maxHeight === 'none' ? 'break-all' : 'normal',
      }}
    >
      {maxHeight === 'none' ? (
        displayContent
      ) : (
        <pre style={{ margin: 0 }}>{displayContent}</pre>
      )}
    </Box>
  );
}

export function ErrorDetailsDialog({
  open,
  onClose,
  selectedError,
}: ErrorDetailsDialogProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  if (!selectedError) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          maxHeight: '80vh',
          borderRadius: 3,
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid',
          borderColor: 'divider',
          pb: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <ErrorIcon sx={{ mr: 1.5, color: 'error.main', fontSize: 28 }} />
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Error Details
          </Typography>
        </Box>
        <IconButton
          onClick={onClose}
          size="small"
          sx={{
            color: 'text.secondary',
            '&:hover': {
              backgroundColor: 'action.hover',
            },
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 3 }}>
        <Box>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <DetailLabel label="Transaction" />
              <Typography variant="body1" sx={{ fontWeight: 600, mb: 2 }}>
                {selectedError.transactionName}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <DetailLabel label="Sampler" />
              <Typography variant="body1" sx={{ fontWeight: 600, mb: 2 }}>
                {selectedError.samplerName}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <DetailLabel label="Response Code" />
              <FancyChip
                label={selectedError.responseCode}
                colorTheme="red"
                sx={{ mb: 2 }}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <DetailLabel label="Response Time" />
              <Typography
                variant="body1"
                sx={{
                  fontFamily: 'monospace',
                  fontWeight: 600,
                  mb: 2,
                }}
              >
                {selectedError.responseTime} ms
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <DetailLabel label="Timestamp" />
              <Typography
                variant="body1"
                sx={{
                  fontFamily: 'monospace',
                  mb: 2,
                }}
              >
                {new Date(selectedError.time).toLocaleString()}
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <DetailLabel label="URL" />
              <CodeBlock
                content={selectedError.url}
                backgroundColor={isDark ? 'rgba(56, 142, 232, 0.1)' : 'rgba(25, 118, 210, 0.04)'}
                borderColor={isDark ? 'rgba(56, 142, 232, 0.3)' : 'rgba(25, 118, 210, 0.12)'}
                maxHeight="none"
              />
            </Grid>
            {selectedError.responseMessage && (
              <Grid item xs={12}>
                <DetailLabel label="Response Message" />
                <CodeBlock
                  content={selectedError.responseMessage}
                  backgroundColor={isDark ? 'rgba(239, 83, 80, 0.1)' : 'rgba(244, 67, 54, 0.04)'}
                  borderColor={isDark ? 'rgba(239, 83, 80, 0.3)' : 'rgba(244, 67, 54, 0.12)'}
                  maxHeight="none"
                />
              </Grid>
            )}
            {selectedError.responseData && (
              <Grid item xs={12}>
                <DetailLabel label="Response Data" />
                <CodeBlock
                  content={selectedError.responseData}
                  maxHeight="200px"
                  formatAsJson
                />
              </Grid>
            )}
            {selectedError.requestHeaders && (
              <Grid item xs={12}>
                <DetailLabel label="Request Headers" />
                <CodeBlock content={selectedError.requestHeaders} />
              </Grid>
            )}
            {selectedError.responseHeaders && (
              <Grid item xs={12}>
                <DetailLabel label="Response Headers" />
                <CodeBlock content={selectedError.responseHeaders} />
              </Grid>
            )}
          </Grid>
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <Button
          onClick={onClose}
          variant="contained"
          sx={{
            borderRadius: 2,
            textTransform: 'none',
            fontWeight: 600,
            px: 3,
          }}
        >
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ErrorDetailsDialog;
