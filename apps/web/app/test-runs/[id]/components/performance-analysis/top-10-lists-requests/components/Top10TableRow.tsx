'use client';

import {
  TableRow,
  TableCell,
  Chip,
  IconButton,
} from '@mui/material';
import { MoreVert as MoreVertIcon } from '@mui/icons-material';
import { Top10Item, Top10Dimension } from '../types';
import { getRankingChipStyles } from '../utils';

export interface Top10TableRowProps {
  item: Top10Item;
  index: number;
  dimension: Top10Dimension;
  showUrl: boolean;
  hasDrillDownOptions: boolean;
  showErrorCount?: boolean;
  onOpenActionMenu: (event: React.MouseEvent<HTMLElement>, item: Top10Item) => void;
}

export function Top10TableRow({
  item,
  index,
  dimension,
  showUrl,
  hasDrillDownOptions,
  showErrorCount,
  onOpenActionMenu,
}: Top10TableRowProps) {
  const chipStyles = getRankingChipStyles(index);

  return (
    <TableRow
      sx={{
        '&:hover': {
          backgroundColor: 'action.hover',
        },
      }}
    >
      <TableCell>
        <Chip
          label={index + 1}
          size="small"
          sx={{
            fontWeight: 700,
            backgroundColor: chipStyles.backgroundColor,
            color: chipStyles.color,
          }}
        />
      </TableCell>
      <TableCell
        sx={{
          fontSize: '0.85rem',
          maxWidth: 150,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={item.scenarioName}
      >
        {item.scenarioName || '-'}
      </TableCell>
      <TableCell
        sx={{
          fontFamily: 'monospace',
          fontSize: '0.85rem',
          wordBreak: 'break-all',
        }}
      >
        {item.transactionName}
      </TableCell>
      <TableCell
        sx={{
          fontFamily: 'monospace',
          fontSize: '0.85rem',
          wordBreak: 'break-all',
        }}
      >
        {showUrl ? item.url : item.requestName}
      </TableCell>
      {showErrorCount && (
        <TableCell
          sx={{
            textAlign: 'right',
            fontFamily: 'monospace',
            fontWeight: 600,
          }}
        >
          {item.errorCount.toLocaleString()}
        </TableCell>
      )}
      <TableCell
        sx={{
          textAlign: 'right',
          fontWeight: 600,
          color: dimension.color,
          fontFamily: 'monospace',
        }}
      >
        {dimension.valueFormatter(item[dimension.valueField] as number)}
      </TableCell>
      {hasDrillDownOptions && (
        <TableCell sx={{ textAlign: 'center', p: 0.5 }}>
          <IconButton
            size="small"
            onClick={(e) => onOpenActionMenu(e, item)}
            aria-label="actions"
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </TableCell>
      )}
    </TableRow>
  );
}
