'use client';

import {
  TableRow,
  TableCell,
  Chip,
  IconButton,
  Box,
  Typography,
} from '@mui/material';
import { MoreVert as MoreVertIcon } from '@mui/icons-material';
import { Top10Item, Top10Dimension } from '../types';
import { getRankingChipStyles } from '../utils';
import { ClippedUrl, URL_CELL_MAX_WIDTH_SX } from '@/components/ui/clipped-url';
import RowCommentButton from '../../../comments/RowCommentButton';
import type { CommentItemCounts } from '@/lib/test-run-comments';
import { commentItemLabel, ROW_COMMENT_HOVER_SX, top10ItemKey } from '../../utils/comment-item-keys';

export interface Top10TableRowProps {
  item: Top10Item;
  index: number;
  dimension: Top10Dimension;
  hasDrillDownOptions: boolean;
  showErrorCount?: boolean;
  onOpenActionMenu: (event: React.MouseEvent<HTMLElement>, item: Top10Item) => void;
  commentCounts: CommentItemCounts;
}

export function Top10TableRow({
  item,
  index,
  dimension,
  hasDrillDownOptions,
  showErrorCount,
  onOpenActionMenu,
  commentCounts,
}: Top10TableRowProps) {
  const chipStyles = getRankingChipStyles(index);
  const commentKey = top10ItemKey('requests', dimension.title, item.scenarioName, item.transactionName, item.requestName, item.url);

  return (
    <TableRow
      data-comment-item={commentKey}
      sx={{
        ...ROW_COMMENT_HOVER_SX,
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
      <TableCell sx={{ wordBreak: 'break-all', ...URL_CELL_MAX_WIDTH_SX }}>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body2" fontFamily="monospace" sx={{ fontSize: '0.85rem', flex: 1, minWidth: 0 }}>
              {item.requestName}
            </Typography>
            <RowCommentButton
              card="performance"
              itemKey={commentKey}
              itemLabel={commentItemLabel(dimension.title, item.transactionName, item.requestName)}
              counts={commentCounts}
            />
          </Box>
          {item.url && item.url !== item.requestName && (
            <Box sx={{ mt: 0.5 }}>
              <ClippedUrl url={item.url} />
            </Box>
          )}
        </Box>
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
