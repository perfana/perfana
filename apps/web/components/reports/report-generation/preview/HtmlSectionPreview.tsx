'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, Alert, Typography } from '@mui/material';
import { previewSection, type ReportSectionType } from '@/lib/api/reports';

interface HtmlSectionPreviewProps {
  testRunId?: string;
  /** API section type, e.g. 'slo', 'trends' */
  sectionType: ReportSectionType;
  /** Section config — section config only; accompanying text is a separate prop */
  config: Record<string, unknown>;
  /** Accompanying text, sent at the section level */
  text?: string;
}

/**
 * Strip HTML tags and truncate overly long error dumps (e.g. an HTML error
 * page returned by the backend) so the error Alert stays readable.
 */
function sanitizeErrorMessage(message: string, maxLength = 200): string {
  const stripped = message.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped.length > maxLength ? `${stripped.slice(0, maxLength)}…` : stripped;
}

/**
 * Generic preview renderer for report sections.
 * Fetches the actual HTML that will appear in the generated report via the
 * backend preview endpoint and renders it in a sandboxed iframe.
 */
export default function HtmlSectionPreview({ testRunId, sectionType, config, text }: HtmlSectionPreviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string>('');

  // Key the fetch on the config's CONTENT, not its object identity — callers
  // may pass a structurally identical but freshly created object on every
  // render, which must not retrigger the fetch. The latest config is read
  // through a ref inside the effect.
  const configRef = useRef(config);
  configRef.current = config;
  const configKey = JSON.stringify(config ?? {});

  useEffect(() => {
    const controller = new AbortController();

    async function fetchPreview() {
      try {
        setLoading(true);
        setError(null);

        const html = await previewSection(
          {
            type: sectionType,
            order: 0,
            text,
            config: configRef.current ?? {},
          },
          testRunId,
          undefined,
          controller.signal
        );

        if (!controller.signal.aborted) {
          setHtmlContent(html);
          setLoading(false);
        }
      } catch (err) {
        // An aborted request is not an error — the component unmounted or a
        // newer request superseded this one. Swallow it silently.
        const isAbort =
          controller.signal.aborted ||
          (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'AbortError');
        if (isAbort) {
          return;
        }
        const errorMessage =
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to load preview';
        setError(sanitizeErrorMessage(errorMessage));
        setLoading(false);
      }
    }

    fetchPreview();

    return () => {
      controller.abort();
    };
  }, [testRunId, sectionType, configKey, text]);

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
          Adjust the section configuration or select a test run, then reopen the preview.
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
          sandbox=""
          title="Section Preview"
        />
      </Box>
    </Box>
  );
}
