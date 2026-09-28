'use client';

import { useState } from 'react';
import { IconButton, Menu } from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { OpenInCardMenuItems, dynatraceHostSeriesRef } from '../shared/metric-card-links';

/**
 * Open in Graphs / Compare / Trends for one Dynatrace host, from the hosts table and from the
 * host detail header. The link names no panel or metric: a host's panel ids are minted per
 * Dynatrace query, so it opens the whole "Dynatrace host metrics <host>" dashboard.
 */
export default function HostCardLinksMenu({ hostDisplayName }: { hostDisplayName: string }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const close = () => setAnchorEl(null);
  return (
    <>
      <IconButton
        size="small"
        aria-label={`Actions for ${hostDisplayName}`}
        // In the table this sits inside a clickable row, which must not drill down.
        onClick={(e) => { e.stopPropagation(); setAnchorEl(e.currentTarget); }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <OpenInCardMenuItems series={dynatraceHostSeriesRef(hostDisplayName)} onClose={close} />
      </Menu>
    </>
  );
}
