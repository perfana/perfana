'use client';

import React, { useEffect, useState } from 'react';
import { Box, CircularProgress, Alert, Typography } from '@mui/material';
import { previewSection, type ReportSectionType } from '@/lib/api/reports';

interface HtmlSectionPreviewProps {
  testRunId?: string;
  /** API section type, e.g. 'slo', 'trends' */
  sectionType: ReportSectionType;
  /** Current section config (a `comment` key, if present, is lifted to the section level) */
  config: Record<string, unknown>;
}

/**
 * Generic preview renderer for report sections.
 * Fetches the actual HTML that will appear in the generated report via the
 * backend preview endpoint and renders it in a sandboxed iframe.
 */
export default function HtmlSectionPreview({ testRunId, sectionType, config }: HtmlSectionPreviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    async function fetchPreview() {
      try {
        setLoading(true);
        setError(null);

        // Lift the comment out of the config — it lives at the section level
        const { comment, ...sectionConfig } = config;

        const html = await previewSection(
          {
            type: sectionType,
            order: 0,
            comment: typeof comment === 'string' ? comment : undefined,
            config: sectionConfig,
          },
          testRunId
        );

        if (!cancelled) {
          setHtmlContent(html);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          const errorMessage =
            err && typeof err === 'object' && 'message' in err
              ? (err as Error).message
              : 'Failed to load preview';
          setError(errorMessage);
          setLoading(false);
        }
      }
    }

    fetchPreview();

    return () => {
      cancelled = true;
    };
  }, [testRunId, sectionType, config]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress size={40} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Loading preview from backend...
          </Typography>
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 2 }}>
        <Typography variant="body2" gutterBottom>
          <strong>Error loading preview:</strong>
        </Typography>
        <Typography variant="body2">{error}</Typography>
        <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
          This is the exact HTML that will appear in your report. The preview is generated using the same backend
          rendering code as the final report.
        </Typography>
      </Alert>
    );
  }

  return (
    <Box>
      {/* Info Alert */}
      <Alert severity="info" sx={{ mb: 3 }}>
        <Typography variant="body2">
          <strong>Live Preview:</strong> This is the exact HTML that will appear in your generated report, rendered
          using the backend report engine with {testRunId ? 'real test data' : 'sample data'}.
        </Typography>
      </Alert>

      {/* Iframe to display HTML */}
      <Box
        sx={{
          border: '1px solid rgba(0, 0, 0, 0.12)',
          borderRadius: 1,
          overflow: 'hidden',
          minHeight: 400,
        }}
      >
        <iframe
          srcDoc={htmlContent}
          style={{
            width: '100%',
            height: '600px',
            border: 'none',
            display: 'block',
          }}
          sandbox="allow-same-origin"
          title="Section Preview"
        />
      </Box>
    </Box>
  );
}
