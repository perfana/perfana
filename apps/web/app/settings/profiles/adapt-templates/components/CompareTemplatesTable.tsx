'use client';

import {
  Box,
  Chip,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { ContentCopy, Delete, Edit, Lock, Visibility } from '@mui/icons-material';
import type { CompareTemplate } from '@/lib/compare-templates';
import { classificationText, dashboardText, forcedFields, metricText, panelIsPattern, panelText } from '../template-display';

interface CompareTemplatesTableProps {
  templates: CompareTemplate[];
  canWrite: boolean;
  canCopy: boolean;
  onEdit: (template: CompareTemplate) => void;
  onView: (template: CompareTemplate) => void;
  onCopy: (template: CompareTemplate) => void;
  onDelete: (template: CompareTemplate) => void;
}

const header = (label: string) => (
  <TableCell>
    <Typography variant="subtitle2" fontWeight={600}>{label}</Typography>
  </TableCell>
);

const PatternChip = () => (
  <Tooltip title="Regular expression">
    <Chip label="regex" size="small" variant="outlined" sx={{ ml: 0.5, height: 20, fontSize: '0.7rem' }} />
  </Tooltip>
);

/** The templates of one scope, in the order the YAML export writes them. Provisioned rows are locked. */
export function CompareTemplatesTable({ templates, canWrite, canCopy, onEdit, onView, onCopy, onDelete }: CompareTemplatesTableProps) {
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" aria-label="ADAPT templates">
        <TableHead>
          <TableRow>
            {header('Dashboard')}
            {header('Panel')}
            {header('Metric')}
            {header('Classification')}
            {header('Forces')}
            <TableCell align="right">
              <Typography variant="subtitle2" fontWeight={600}>Actions</Typography>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {templates.map((t) => {
            const d = t.definition;
            const forced = forcedFields(d);
            const editable = canWrite && !t.readOnly;
            return (
              <TableRow key={t.id} hover data-testid="compare-template-row" data-read-only={t.readOnly ? 'true' : 'false'}>
                <TableCell>
                  <Box display="flex" alignItems="center" gap={0.5}>
                    {t.readOnly && (
                      <Tooltip title="Provisioned from template_ds_compare_configs.yaml: change it in the file">
                        <Lock fontSize="small" color="action" aria-label="Provisioned" />
                      </Tooltip>
                    )}
                    <Typography variant="body2" sx={{ fontFamily: d.dashboardUid ? 'monospace' : undefined, color: d.dashboardUid ? undefined : 'text.secondary' }}>
                      {dashboardText(d)}
                    </Typography>
                    {d.regex && d.dashboardUid && <PatternChip />}
                  </Box>
                  {d.dashboardLabel && (
                    <Typography variant="caption" color="text.secondary">{d.dashboardLabel}</Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Typography variant="body2" component="span">{panelText(d)}</Typography>
                  {panelIsPattern(d) && <PatternChip />}
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color={d.metricName ? undefined : 'text.secondary'} sx={d.metricName ? undefined : { whiteSpace: 'nowrap' }}>
                    {metricText(d)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{classificationText(d)}</Typography>
                </TableCell>
                <TableCell>
                  {forced.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">Classification only</Typography>
                  ) : (
                    <Box display="flex" gap={0.5} flexWrap="wrap">
                      {forced.map((f) => (
                        <Chip key={f} label={f} size="small" sx={{ height: 22, fontSize: '0.72rem' }} />
                      ))}
                    </Box>
                  )}
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  {editable ? (
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => onEdit(t)} aria-label="Edit template">
                        <Edit fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ) : (
                    <Tooltip title={t.readOnly ? 'View (provisioned)' : 'View'}>
                      <IconButton size="small" onClick={() => onView(t)} aria-label="View template">
                        <Visibility fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  {canCopy && (
                    <Tooltip title="Copy to another scope">
                      <IconButton size="small" onClick={() => onCopy(t)} aria-label="Copy template to another scope">
                        <ContentCopy fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  {editable && (
                    <Tooltip title="Delete">
                      <IconButton size="small" onClick={() => onDelete(t)} aria-label="Delete template">
                        <Delete fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
