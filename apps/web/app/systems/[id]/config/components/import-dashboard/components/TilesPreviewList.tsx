'use client';

import {
  Box,
  Typography,
  Button,
  List,
  ListItem,
  ListItemText,
  Divider,
  Chip,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import { DashboardTile } from '../types';

interface TilesPreviewListProps {
  tiles: DashboardTile[];
  onTileSelection: (tileId: string, selected: boolean) => void;
  onSelectAll: (selected: boolean) => void;
}

export function TilesPreviewList({
  tiles,
  onTileSelection,
  onSelectAll,
}: TilesPreviewListProps) {
  if (tiles.length === 0) {
    return null;
  }

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
        }}
      >
        <Typography variant="h6">Available Tiles ({tiles.length})</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" onClick={() => onSelectAll(true)} variant="outlined">
            Select All
          </Button>
          <Button size="small" onClick={() => onSelectAll(false)} variant="outlined">
            Clear All
          </Button>
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Select which metric queries to import:
      </Typography>

      <List
        sx={{
          maxHeight: 300,
          overflow: 'auto',
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
        }}
      >
        {tiles.map((tile, index) => (
          <Box key={tile.id}>
            <ListItem>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={tile.selected || false}
                    onChange={e => onTileSelection(tile.id, e.target.checked)}
                  />
                }
                label=""
                sx={{ mr: 1 }}
              />
              <ListItemText
                primaryTypographyProps={{ component: 'div' }}
                secondaryTypographyProps={{ component: 'div' }}
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="subtitle2" fontWeight="medium">
                      {tile.title}
                    </Typography>
                    <Chip
                      label={tile.visualization}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                  </Box>
                }
                secondary={
                  <Box component="div">
                    <Box
                      component="div"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        bgcolor: 'action.hover',
                        p: 1,
                        borderRadius: 1,
                        mb: 1,
                        maxHeight: 60,
                        overflow: 'auto',
                      }}
                    >
                      {tile.query}
                    </Box>
                    {tile.variables.length > 0 && (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {tile.variables.map(variable => (
                          <Chip
                            key={variable}
                            label={`$${variable}`}
                            size="small"
                            color="secondary"
                            variant="outlined"
                          />
                        ))}
                      </Box>
                    )}
                  </Box>
                }
              />
            </ListItem>
            {index < tiles.length - 1 && <Divider />}
          </Box>
        ))}
      </List>
    </Box>
  );
}
