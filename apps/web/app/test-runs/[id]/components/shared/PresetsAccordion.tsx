'use client';

import React from 'react';
import { Accordion, AccordionSummary, AccordionDetails, Typography } from '@mui/material';
import { ExpandMore } from '@mui/icons-material';

interface PresetsAccordionProps {
  /** Preset count shown in the summary; omitted while `loading`. */
  count: number;
  loading: boolean;
  children: React.ReactNode;
}

/**
 * "Saved presets (N)" accordion shared by the Compare, Trends and Graphs cards —
 * presets out of the way until you want one.
 */
export default function PresetsAccordion({ count, loading, children }: PresetsAccordionProps) {
  return (
    <Accordion
      disableGutters
      elevation={0}
      // unmountOnExit or "out of the way" is only visual: MUI's Accordion wraps children
      // in a Collapse that keeps them mounted, so every preset row would render into a
      // hidden height:0 subtree on each render of the card.
      slotProps={{ transition: { unmountOnExit: true } }}
      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, '&:before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Saved presets{loading ? '' : ` (${count})`}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  );
}
