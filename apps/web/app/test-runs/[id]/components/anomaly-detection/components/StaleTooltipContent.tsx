'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { StaleTooltipContentProps, ConfigSetting } from './types';

export default function StaleTooltipContent({
  row,
  _testRunId,
  _drawerData,
  _rowIndex
}: StaleTooltipContentProps) {
  const [configSettings, setConfigSettings] = useState<ConfigSetting[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadConfigSettings = useCallback(async () => {
    if (loaded || loading) return;

    setLoading(true);
    try {
      const settings: ConfigSetting[] = [];

      console.log('=== Config Settings Debug ===');
      console.log('Using row compare_config data:', row.compare_config);

      // Use the compare_config data available in the row
      const currentConfig = row.compare_config;

      if (currentConfig) {
        const thresholds = currentConfig.thresholds || {};
        const classification = currentConfig.metricClassification || {};

        // Show current settings that affect analysis
        if (thresholds.percentageThreshold !== undefined) {
          settings.push({
            key: 'Percentage Threshold',
            value: `${(thresholds.percentageThreshold * 100).toFixed(1)}%`,
            description: 'Currently configured'
          });
        }

        if (thresholds.absoluteThreshold !== undefined && thresholds.absoluteThreshold !== null) {
          settings.push({
            key: 'Absolute Threshold',
            value: thresholds.absoluteThreshold.toString(),
            description: 'Currently configured'
          });
        }

        if (thresholds.iqrThreshold !== undefined) {
          settings.push({
            key: 'IQR Threshold',
            value: thresholds.iqrThreshold.toString(),
            description: 'Currently configured'
          });
        }

        if (thresholds.aggregation) {
          settings.push({
            key: 'Aggregation Method',
            value: thresholds.aggregation,
            description: 'Currently configured'
          });
        }

        if (classification.classification) {
          settings.push({
            key: 'Classification',
            value: classification.classification,
            description: 'Currently configured'
          });
        }

        if (classification.higherIsBetter !== undefined) {
          settings.push({
            key: 'Higher Is Better',
            value: classification.higherIsBetter ? 'Yes' : 'No',
            description: 'Currently configured'
          });
        }

        console.log('Current config settings:', settings);
      } else {
        console.log('No compare_config available in row data');
      }

      setConfigSettings(settings);
      setLoaded(true);
    } catch (error) {
      console.error('Failed to load config settings:', error);
      setConfigSettings([]);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, [loaded, loading, row]);

  useEffect(() => {
    loadConfigSettings();
  }, [loadConfigSettings]);

  return (
    <Box sx={{ p: 1 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1, color: 'white' }}>
        OUTDATED ANALYSIS
      </Typography>
      <Typography variant="body2" sx={{ mb: 1, color: 'white' }}>
        {row.stale_reason || 'Configuration changed'}
      </Typography>

      {loading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, my: 1 }}>
          <CircularProgress size={12} />
          <Typography variant="caption" sx={{ color: 'white' }}>Loading differences...</Typography>
        </Box>
      ) : configSettings.length > 0 ? (
        <Box sx={{ mt: 1, mb: 1 }}>
          <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5, color: 'white' }}>
            Current Configuration:
          </Typography>
          {configSettings.map((setting, index) => (
            <Box key={index} sx={{ mb: 0.5 }}>
              <Typography variant="caption" sx={{
                display: 'block',
                color: 'white',
                fontWeight: 500
              }}>
                {setting.key}
              </Typography>
              <Typography variant="caption" sx={{
                display: 'block',
                pl: 2,
                fontSize: '0.65rem',
                color: '#c8e6c9'
              }}>
                {setting.value}
              </Typography>
            </Box>
          ))}
          <Typography variant="caption" sx={{
            display: 'block',
            color: 'rgba(255,255,255,0.7)',
            fontSize: '0.6rem',
            mt: 1,
            fontStyle: 'italic'
          }}>
            Analysis used different settings at time of execution
          </Typography>
        </Box>
      ) : (
        <Typography variant="caption" sx={{ display: 'block', color: 'white', mb: 1 }}>
          Configuration may have changed since analysis was performed.
        </Typography>
      )}

      {row.config_hash_used && (
        <Typography variant="caption" sx={{ display: 'block', color: 'rgba(255,255,255,0.8)', mb: 1 }}>
          Analysis used config: {row.config_hash_used.substring(0, 8)}...
        </Typography>
      )}

      <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic', color: 'white' }}>
        Click to re-analyze with current configuration
      </Typography>
    </Box>
  );
}
