'use client';

// "Import dashboard JSON" on the Splunk tab: paste or upload an exported Splunk Dashboard Studio
// definition, review the panels it converts to, and create the ticked ones for this workload.
// The conversion is lib/splunk-dashboard-import.ts; each panel is still created through
// POST /splunk/queries, which validates its filter, so a row can fail on its own.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { InfoOutlined as InfoIcon, UploadFile as UploadIcon } from '@mui/icons-material';
import { SplunkEntityMapping, SplunkQuery, SplunkScope, createSplunkQuery } from '@/lib/splunk';
import { ImportedSplunkPanel, SplunkDashboardImport, parseSplunkDashboardJson } from '@/lib/splunk-dashboard-import';
import { getErrorMessage } from '@/lib/errors';

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 };

interface Props {
  open: boolean;
  configId: string;
  scope: SplunkScope;
  /** Panels already on this workload: a panel with the same title starts unticked. */
  existing: SplunkQuery[];
  /** Sources mapped for this workload, to warn about indexes the dashboard reads that are not mapped. */
  mappings: SplunkEntityMapping[];
  onClose: () => void;
  /** Called after an import that created at least one panel. */
  onImported: (created: number) => void;
}

export default function ImportSplunkDashboardDialog({ open, configId, scope, existing, mappings, onClose, onImported }: Props) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<SplunkDashboardImport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dashboardLabel, setDashboardLabel] = useState('');
  const [importing, setImporting] = useState(false);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [showSkipped, setShowSkipped] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setText(''); setParsed(null); setParseError(null); setSelected(new Set());
    setDashboardLabel(''); setFailures({}); setShowSkipped(false); setImporting(false);
  }, [open]);

  const existingTitles = useMemo(() => new Set(existing.map((q) => q.panelTitle)), [existing]);

  const read = (json: string) => {
    setText(json);
    setFailures({});
    try {
      const result = parseSplunkDashboardJson(json);
      setParsed(result);
      setParseError(null);
      setDashboardLabel(result.title);
      setSelected(new Set(result.panels.filter((p) => !existingTitles.has(p.panelTitle)).map((p) => p.key)));
    } catch (err) {
      setParsed(null);
      setParseError(getErrorMessage(err));
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    read(await file.text());
  };

  const unmappedIndexes = useMemo(() => {
    if (!parsed) return [];
    const mapped = new Set(mappings.map((m) => m.indexName));
    const used = new Set(parsed.panels.filter((p) => selected.has(p.key)).flatMap((p) => p.indexes));
    return [...used].filter((i) => !mapped.has(i));
  }, [parsed, mappings, selected]);

  const toggle = (key: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const runImport = async () => {
    if (!parsed) return;
    setImporting(true);
    const failed: Record<string, string> = {};
    let created = 0;
    // One at a time: panel ids are assigned per dashboard as MAX + 1, so parallel creates collide.
    for (const p of parsed.panels.filter((x) => selected.has(x.key))) {
      try {
        await createSplunkQuery({
          ...scope,
          splunkConfigId: configId,
          dashboardLabel: dashboardLabel.trim() || undefined,
          panelTitle: p.panelTitle,
          spl: p.spl,
          splitBy: p.splitBy,
          aggregation: p.aggregation,
          ...(p.maxSeries ? { maxSeries: p.maxSeries } : {}),
        });
        created++;
      } catch (err) {
        failed[p.key] = getErrorMessage(err);
      }
    }
    setImporting(false);
    setFailures(failed);
    // Leave only the failed rows ticked, so a retry after a fix does not create the rest twice.
    setSelected(new Set(Object.keys(failed)));
    if (created > 0) onImported(created);
    if (Object.keys(failed).length === 0) onClose();
  };

  const selectedCount = parsed ? parsed.panels.filter((p) => selected.has(p.key)).length : 0;
  const allSelected = parsed !== null && parsed.panels.length > 0 && selectedCount === parsed.panels.length;

  return (
    <Dialog open={open} onClose={importing ? undefined : onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Import Splunk dashboard</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Paste or upload a Dashboard Studio definition (in Splunk: Edit, then Source). Each search becomes a panel:
          its <code>index=</code> is replaced by <code>$entities</code>, and its <code>timechart</code> or <code>stats</code>{' '}
          becomes the panel&apos;s aggregation. Perfana adds the run window and bucket size itself.
        </Typography>

        {!parsed && (
          <>
            <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
              <Button size="small" variant="outlined" startIcon={<UploadIcon />} onClick={() => fileInput.current?.click()}>
                Upload .json
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                hidden
                data-testid="splunk-dashboard-file"
                onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }}
              />
            </Box>
            <TextField
              fullWidth
              multiline
              minRows={8}
              maxRows={16}
              label="Dashboard JSON"
              value={text}
              onChange={(e) => setText(e.target.value)}
              slotProps={{ htmlInput: { style: MONO } }}
            />
            {parseError && <Alert severity="error" sx={{ mt: 2 }}>{parseError}</Alert>}
          </>
        )}

        {parsed && (
          <>
            <TextField
              size="small"
              label="Perfana dashboard"
              value={dashboardLabel}
              onChange={(e) => setDashboardLabel(e.target.value)}
              helperText="The panels are grouped under this name in graphs, SLOs and anomaly detection. It cannot be changed later."
              sx={{ mb: 2, minWidth: 360 }}
              slotProps={{ htmlInput: { maxLength: 255 } }}
            />
            {unmappedIndexes.length > 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                The dashboard reads {unmappedIndexes.map((i) => <code key={i}>index={i} </code>)}
                {unmappedIndexes.length === 1 ? 'which is' : 'which are'} not mapped as a source for this workload.
                Add {unmappedIndexes.length === 1 ? 'it' : 'them'} under Sources, or these panels collect nothing.
              </Alert>
            )}
            {parsed.panels.length === 0 ? (
              <Alert severity="info">No search in this dashboard can be converted. The reasons are listed below.</Alert>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={allSelected}
                        indeterminate={selectedCount > 0 && !allSelected}
                        inputProps={{ 'aria-label': 'Select all panels' }}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(parsed.panels.map((p) => p.key)))}
                      />
                    </TableCell>
                    <TableCell>Panel</TableCell>
                    <TableCell>Filter</TableCell>
                    <TableCell>Series</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {parsed.panels.map((p) => (
                    <PanelRow
                      key={p.key}
                      panel={p}
                      checked={selected.has(p.key)}
                      exists={existingTitles.has(p.panelTitle)}
                      failure={failures[p.key]}
                      onToggle={() => toggle(p.key)}
                    />
                  ))}
                </TableBody>
              </Table>
            )}

            {parsed.skipped.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Button size="small" onClick={() => setShowSkipped((v) => !v)}>
                  {showSkipped ? 'Hide' : 'Show'} {parsed.skipped.length} search(es) not imported
                </Button>
                <Collapse in={showSkipped}>
                  <Table size="small">
                    <TableBody>
                      {parsed.skipped.map((s) => (
                        <TableRow key={s.key}>
                          <TableCell sx={{ width: '30%' }}>{s.panelTitle}</TableCell>
                          <TableCell>
                            <Typography variant="body2">{s.reason}</Typography>
                            {s.sourceQuery && !/^Same search as/.test(s.reason) && (
                              <Typography variant="caption" color="text.secondary" sx={{ ...MONO, wordBreak: 'break-word' }}>{s.sourceQuery}</Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Collapse>
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        {parsed && !importing && <Button onClick={() => { setParsed(null); setFailures({}); }}>Back</Button>}
        <Button onClick={onClose} disabled={importing}>Cancel</Button>
        {parsed ? (
          <Button
            variant="contained"
            disabled={importing || selectedCount === 0}
            startIcon={importing ? <CircularProgress size={16} /> : undefined}
            onClick={() => void runImport()}
          >
            Import {selectedCount} panel{selectedCount === 1 ? '' : 's'}
          </Button>
        ) : (
          <Button variant="contained" disabled={!text.trim()} onClick={() => read(text)}>Review panels</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function PanelRow({ panel, checked, exists, failure, onToggle }: {
  panel: ImportedSplunkPanel; checked: boolean; exists: boolean; failure?: string; onToggle: () => void;
}) {
  return (
    <TableRow hover>
      <TableCell padding="checkbox">
        <Checkbox size="small" checked={checked} onChange={onToggle} inputProps={{ 'aria-label': `Import ${panel.panelTitle}` }} />
      </TableCell>
      <TableCell sx={{ maxWidth: 260 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <span>{panel.panelTitle}</span>
          {panel.notes.length > 0 && (
            <Tooltip title={<Box component="ul" sx={{ m: 0, pl: 2 }}>{panel.notes.map((n) => <li key={n}>{n}</li>)}</Box>}>
              <InfoIcon fontSize="inherit" color="action" aria-label={`Conversion notes for ${panel.panelTitle}`} />
            </Tooltip>
          )}
        </Box>
        {exists && <Typography variant="caption" color="text.secondary">A panel with this title already exists</Typography>}
        {failure && <Typography variant="caption" color="error" display="block">{failure}</Typography>}
      </TableCell>
      <TableCell sx={{ ...MONO, maxWidth: 420, wordBreak: 'break-word' }}>{panel.spl}</TableCell>
      <TableCell sx={{ ...MONO, whiteSpace: 'nowrap' }}>{panel.aggregation}{panel.splitBy ? ` by ${panel.splitBy}` : ''}</TableCell>
    </TableRow>
  );
}
