'use client';

import {
  Box,
  Typography,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  InputAdornment,
  Tooltip,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
} from '@mui/icons-material';
import { BaselinePreviewItem, ApdexScope } from '../types/apdex-thresholds.types';
import { getThemedApdexColor } from '../utils/apdex-utils';

type SortField = keyof BaselinePreviewItem;
type SortDirection = 'asc' | 'desc';

interface ApdexTransactionTableProps {
  items: BaselinePreviewItem[];
  scope: ApdexScope;
  sortBy: SortField;
  sortDirection: SortDirection;
  thresholdOverrides: Record<string, number | null>;
  onSort: (field: SortField) => void;
  onThresholdOverride: (transactionName: string, value: string) => void;
  getGroupedItems: (items: BaselinePreviewItem[]) => Record<string, BaselinePreviewItem[]>;
  getScenarioNames: (items: BaselinePreviewItem[]) => string[];
}

export function ApdexTransactionTable({
  items,
  scope,
  sortBy,
  sortDirection,
  thresholdOverrides,
  onSort,
  onThresholdOverride,
  getGroupedItems,
  getScenarioNames,
}: ApdexTransactionTableProps) {
  const scenarioNames = getScenarioNames(items);
  const groupedItems = getGroupedItems(items);

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Transaction Details
      </Typography>

      {scenarioNames.map((scenarioName) => {
        const scenarioItems = groupedItems[scenarioName] || [];
        const displayName = scenarioName === 'default' ? 'Default Scenario' : scenarioName;

        return (
          <Accordion key={scenarioName} defaultExpanded sx={{ mb: 1 }}>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              sx={{ bgcolor: 'action.hover' }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
                <Typography variant="subtitle1" fontWeight={500}>
                  {displayName}
                </Typography>
                <Chip
                  label={`${scenarioItems.length} transaction${scenarioItems.length !== 1 ? 's' : ''}`}
                  size="small"
                  variant="outlined"
                />
                <Chip
                  label={`${scenarioItems.filter(i => i.achievable).length} achievable`}
                  size="small"
                  color={scenarioItems.filter(i => i.achievable).length === scenarioItems.length ? 'success' : 'warning'}
                />
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              <TableContainer sx={{ maxHeight: 300 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>
                        <TableSortLabel
                          active={sortBy === 'transaction_name'}
                          direction={sortBy === 'transaction_name' ? sortDirection : 'asc'}
                          onClick={() => onSort('transaction_name')}
                        >
                          Transaction
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="right">
                        <TableSortLabel
                          active={sortBy === 'current_threshold'}
                          direction={sortBy === 'current_threshold' ? sortDirection : 'asc'}
                          onClick={() => onSort('current_threshold')}
                        >
                          Current (ms)
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="right">
                        <TableSortLabel
                          active={sortBy === 'calculated_threshold'}
                          direction={sortBy === 'calculated_threshold' ? sortDirection : 'asc'}
                          onClick={() => onSort('calculated_threshold')}
                        >
                          {scope === 'transaction' ? 'Threshold (ms)' : 'Calculated (ms)'}
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="center">Current Apdex</TableCell>
                      <TableCell align="center">Projected Apdex</TableCell>
                      <TableCell align="center">Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {scenarioItems.map((item, index) => (
                      <TransactionRow
                        key={`${item.transaction_name}-${index}`}
                        item={item}
                        scope={scope}
                        thresholdOverride={thresholdOverrides[item.transaction_name]}
                        onThresholdOverride={onThresholdOverride}
                      />
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Box>
  );
}

interface TransactionRowProps {
  item: BaselinePreviewItem;
  scope: ApdexScope;
  thresholdOverride: number | null | undefined;
  onThresholdOverride: (transactionName: string, value: string) => void;
}

function TransactionRow({
  item,
  scope,
  thresholdOverride,
  onThresholdOverride,
}: TransactionRowProps) {
  const theme = useTheme();

  return (
    <TableRow
      hover
      sx={{
        backgroundColor: !item.achievable ? alpha(theme.palette.warning.main, 0.05) : undefined,
      }}
    >
      <TableCell>
        <Typography variant="body2" fontWeight={500}>
          {item.transaction_name}
        </Typography>
      </TableCell>
      <TableCell align="right">
        <Typography variant="body2" fontFamily="monospace">
          {item.current_threshold ?? '-'}
        </Typography>
      </TableCell>
      <TableCell align="right">
        {scope === 'transaction' && item.achievable ? (
          <Tooltip
            title={thresholdOverride !== undefined ? `Original: ${item.calculated_threshold}ms` : 'Click to edit'}
            placement="top"
          >
            <TextField
              type="number"
              size="small"
              value={thresholdOverride ?? item.calculated_threshold ?? ''}
              onChange={(e) => onThresholdOverride(item.transaction_name, e.target.value)}
              InputProps={{
                endAdornment: <InputAdornment position="end">ms</InputAdornment>,
              }}
              inputProps={{ min: 1, max: 60000, step: 1 }}
              sx={{
                width: 110,
                '& .MuiOutlinedInput-root': {
                  backgroundColor: thresholdOverride !== undefined ? alpha(theme.palette.warning.light, 0.15) : undefined,
                },
                '& .MuiInputBase-input': {
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  py: 0.5,
                },
              }}
            />
          </Tooltip>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
            <Typography
              variant="body2"
              fontFamily="monospace"
              color={item.achievable ? 'primary' : 'text.secondary'}
              fontWeight={item.achievable ? 600 : 400}
            >
              {item.calculated_threshold ?? '-'}
            </Typography>
            {item.calculated_threshold !== null && item.current_threshold !== null && (
              item.calculated_threshold > item.current_threshold ? (
                <TrendingUpIcon color="warning" sx={{ fontSize: 16 }} />
              ) : item.calculated_threshold < item.current_threshold ? (
                <TrendingDownIcon color="success" sx={{ fontSize: 16 }} />
              ) : null
            )}
          </Box>
        )}
      </TableCell>
      <TableCell align="center">
        <Chip
          label={item.current_apdex?.toFixed(3) ?? '-'}
          size="small"
          sx={{
            backgroundColor: getThemedApdexColor(item.current_apdex, theme),
            color: theme.palette.common.white,
            minWidth: 65,
          }}
        />
      </TableCell>
      <TableCell align="center">
        {item.projected_apdex !== null ? (
          <Chip
            label={item.projected_apdex.toFixed(3)}
            size="small"
            sx={{
              backgroundColor: getThemedApdexColor(item.projected_apdex, theme),
              color: theme.palette.common.white,
              minWidth: 65,
            }}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">-</Typography>
        )}
      </TableCell>
      <TableCell align="center">
        <Chip
          label={item.achievable ? 'Achievable' : 'Not Achievable'}
          size="small"
          color={item.achievable ? 'success' : 'warning'}
          variant={item.achievable ? 'filled' : 'outlined'}
        />
      </TableCell>
    </TableRow>
  );
}

export default ApdexTransactionTable;
