'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Card,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Terminal as TerminalIcon,
  Search as SearchIcon,
  Close as CloseIcon,
  DeleteSweep as DeleteSweepIcon,
  Download as DownloadIcon,
  FiberManualRecord as DotIcon,
} from '@mui/icons-material';
import { authenticatedFetch } from '@/lib/api';
import { parseSseChunk } from './sse';

interface LogContainer {
  id: string;
  name: string;
  service: string;
  state: string;
}

const TAIL_OPTIONS = [100, 500, 1000] as const;

export default function LogsPage() {
  const [containers, setContainers] = useState<LogContainer[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [tail, setTail] = useState<number>(100);
  const [follow, setFollow] = useState(true);
  const [filter, setFilter] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [connecting, setConnecting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    authenticatedFetch('/logs/containers')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: LogContainer[]) => setContainers(Array.isArray(data) ? data : []))
      .catch(() => setContainers([]))
      .finally(() => setLoadingContainers(false));
  }, []);

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    if (!selected) return;
    stopStream();
    setLines([]);
    setConnecting(true);
    const ac = new AbortController();
    abortRef.current = ac;
    (async () => {
      const res = await authenticatedFetch(
        `/logs/containers/${selected}/stream?tail=${tail}&follow=${follow}`,
        { signal: ac.signal },
      );
      if (!res.ok) return;
      const reader = res.body?.getReader();
      if (!reader) return;
      setConnecting(false);
      const decoder = new TextDecoder();
      let buffer = '';
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (ac.signal.aborted) break;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { lines: newLines, rest } = parseSseChunk(buffer);
        buffer = rest;
        if (newLines.length) setLines((prev) => [...prev, ...newLines].slice(-5000));
      }
    })().catch((err) => {
      // AbortError is expected on unmount / container switch; surface anything else.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.error('[log-viewer] stream error', err);
      }
    });
    return stopStream;
  }, [selected, tail, follow, stopStream]);

  const visible = useMemo(
    () => (filter ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase())) : lines),
    [lines, filter],
  );

  // Auto-scroll to newest line while following.
  useEffect(() => {
    if (follow && paneRef.current) {
      paneRef.current.scrollTop = paneRef.current.scrollHeight;
    }
  }, [visible, follow]);

  const selectedContainer = containers.find((c) => c.id === selected) ?? null;

  const download = () => {
    const blob = new Blob([visible.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedContainer?.service || selectedContainer?.name || 'logs'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ py: 4, px: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
          <TerminalIcon sx={{ color: 'primary.main' }} />
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700, color: 'text.primary' }}>
            Log Viewer
          </Typography>
        </Stack>
        <Typography variant="body1" color="text.secondary">
          Live logs streamed from the running Perfana containers
        </Typography>
      </Box>

      <Card
        variant="outlined"
        sx={{
          display: 'flex',
          height: 'calc(100vh - 220px)',
          minHeight: 420,
          overflow: 'hidden',
          borderRadius: 2,
        }}
      >
        {/* Component list */}
        <Box
          sx={{
            width: 260,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.default',
          }}
        >
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ fontWeight: 600, letterSpacing: 0.5 }}
            >
              Components{containers.length ? ` (${containers.length})` : ''}
            </Typography>
          </Box>
          <Divider />
          {loadingContainers ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={22} />
            </Box>
          ) : containers.length === 0 ? (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                No containers found.
              </Typography>
            </Box>
          ) : (
            <List dense sx={{ overflow: 'auto', flex: 1, py: 0 }}>
              {containers.map((c) => {
                const running = c.state === 'running';
                return (
                  <ListItemButton
                    key={c.id}
                    selected={selected === c.id}
                    onClick={() => setSelected(c.id)}
                    sx={{ px: 2 }}
                  >
                    <DotIcon
                      sx={{
                        fontSize: 10,
                        mr: 1.25,
                        color: running ? 'success.main' : 'text.disabled',
                      }}
                    />
                    <ListItemText
                      primary={c.service || c.name}
                      secondary={running ? undefined : c.state}
                      primaryTypographyProps={{
                        variant: 'body2',
                        fontWeight: selected === c.id ? 700 : 500,
                        noWrap: true,
                      }}
                      secondaryTypographyProps={{ variant: 'caption' }}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          )}
        </Box>

        <Divider orientation="vertical" flexItem />

        {/* Log pane */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Toolbar */}
          <Stack
            direction="row"
            spacing={1.5}
            alignItems="center"
            sx={{ px: 2, py: 1.25, flexWrap: 'wrap', rowGap: 1 }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700, minWidth: 0, mr: 'auto' }} noWrap>
              {selectedContainer
                ? selectedContainer.service || selectedContainer.name
                : 'No component selected'}
            </Typography>

            <FormControl size="small" sx={{ minWidth: 96 }}>
              <InputLabel id="tail-label">Lines</InputLabel>
              <Select
                labelId="tail-label"
                label="Lines"
                value={tail}
                onChange={(e) => setTail(Number(e.target.value))}
              >
                {TAIL_OPTIONS.map((n) => (
                  <MenuItem key={n} value={n}>
                    {n}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControlLabel
              control={
                <Switch size="small" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
              }
              label="Follow"
              sx={{ mr: 0, '& .MuiFormControlLabel-label': { fontSize: 14 } }}
            />

            <TextField
              size="small"
              placeholder="Filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              sx={{ width: 200 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: filter ? (
                  <InputAdornment position="end">
                    <IconButton size="small" edge="end" onClick={() => setFilter('')}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              }}
            />

            <Tooltip title="Clear">
              <span>
                <IconButton size="small" onClick={() => setLines([])} disabled={!lines.length}>
                  <DeleteSweepIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Download visible lines">
              <span>
                <IconButton size="small" onClick={download} disabled={!visible.length}>
                  <DownloadIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>

          <Divider />

          {/* Status strip */}
          {selectedContainer && (
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ px: 2, py: 0.75, bgcolor: 'background.default' }}
            >
              <Chip
                size="small"
                variant="outlined"
                color={follow ? 'success' : 'default'}
                icon={<DotIcon sx={{ fontSize: '12px !important' }} />}
                label={follow ? 'Streaming' : 'Paused'}
                sx={{ height: 22 }}
              />
              <Typography variant="caption" color="text.secondary">
                {visible.length.toLocaleString()}
                {filter ? ` / ${lines.length.toLocaleString()}` : ''} lines
              </Typography>
            </Stack>
          )}

          {/* Log body */}
          <Box
            ref={paneRef}
            sx={{
              flex: 1,
              overflow: 'auto',
              bgcolor: '#0b0e14',
              color: '#c9d1d9',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              fontSize: 12.5,
              lineHeight: 1.6,
            }}
          >
            {!selected ? (
              <Box
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 1,
                }}
              >
                <TerminalIcon sx={{ fontSize: 40, color: 'grey.700' }} />
                <Typography variant="body2" sx={{ color: 'grey.500' }}>
                  Select a component to view its logs
                </Typography>
              </Box>
            ) : connecting ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 2 }}>
                <CircularProgress size={16} sx={{ color: 'grey.500' }} />
                <Typography variant="body2" sx={{ color: 'grey.500' }}>
                  Connecting…
                </Typography>
              </Box>
            ) : visible.length === 0 ? (
              <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: 'grey.600' }}>
                  {filter ? 'No lines match the filter.' : 'Waiting for log output…'}
                </Typography>
              </Box>
            ) : (
              <Box component="pre" sx={{ m: 0, p: 2, whiteSpace: 'pre', minWidth: 'max-content' }}>
                {visible.join('\n')}
              </Box>
            )}
          </Box>
        </Box>
      </Card>
    </Box>
  );
}
