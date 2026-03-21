import {
  Box,
  TextField,
  Button,
  IconButton,
  Typography,
  Chip,
  useTheme
} from '@mui/material';
import {
  Add as AddIcon,
  Close
} from '@mui/icons-material';

interface FilterBarProps {
  searchText: string;
  onSearchChange: (text: string) => void;
  selectedTags: string[];
  availableTags: string[];
  onTagToggle: (tag: string) => void;
  onClearTags: () => void;
  showAddButton?: boolean;
  onAddClick?: () => void;
  addButtonText?: string;
  placeholder?: string;
}

export default function FilterBar({
  searchText,
  onSearchChange,
  selectedTags,
  availableTags,
  onTagToggle,
  onClearTags,
  showAddButton = false,
  onAddClick,
  addButtonText = 'Add Item',
  placeholder = 'Search...'
}: FilterBarProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return (
    <>
      {/* Search and Add Button */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2 }}>
        <TextField
          size="small"
          placeholder={placeholder}
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          sx={{ flexGrow: 1, maxWidth: '400px' }}
          InputProps={{
            endAdornment: searchText && (
              <IconButton
                size="small"
                onClick={() => onSearchChange('')}
                sx={{ mr: -1 }}
              >
                <Close fontSize="small" />
              </IconButton>
            )
          }}
        />
        {showAddButton && onAddClick && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={onAddClick}
            size="small"
          >
            {addButtonText}
          </Button>
        )}
      </Box>

      {/* Tags Filter */}
      {availableTags.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 600 }}>
            Filter by Tags
          </Typography>
          <Box display="flex" flexWrap="wrap" gap={1.5}>
            {availableTags.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                clickable
                onClick={() => onTagToggle(tag)}
                sx={{
                  height: '32px',
                  fontWeight: 600,
                  backdropFilter: 'blur(8px)',
                  transition: 'all 0.2s ease',
                  background: selectedTags.includes(tag)
                    ? (isDark
                      ? 'linear-gradient(135deg, rgba(56, 142, 232, 0.18) 0%, rgba(56, 142, 232, 0.28) 100%)'
                      : 'linear-gradient(135deg, rgba(25, 118, 210, 0.08) 0%, rgba(30, 136, 229, 0.12) 100%)')
                    : (isDark
                      ? 'linear-gradient(135deg, rgba(186, 104, 200, 0.18) 0%, rgba(186, 104, 200, 0.28) 100%)'
                      : 'linear-gradient(135deg, rgba(156, 39, 176, 0.08) 0%, rgba(171, 71, 188, 0.12) 100%)'),
                  border: selectedTags.includes(tag)
                    ? (isDark ? '1px solid rgba(56, 142, 232, 0.5)' : '1px solid rgba(25, 118, 210, 0.3)')
                    : (isDark ? '1px solid rgba(186, 104, 200, 0.5)' : '1px solid rgba(156, 39, 176, 0.3)'),
                  color: selectedTags.includes(tag)
                    ? (isDark ? '#90caf9' : 'primary.dark')
                    : (isDark ? '#ce93d8' : '#9c27b0'),
                  '&:hover': {
                    transform: 'translateY(-1px)',
                    boxShadow: selectedTags.includes(tag)
                      ? (isDark ? '0 4px 12px rgba(56, 142, 232, 0.3)' : '0 4px 12px rgba(25, 118, 210, 0.2)')
                      : (isDark ? '0 4px 12px rgba(186, 104, 200, 0.3)' : '0 4px 12px rgba(156, 39, 176, 0.2)'),
                    border: selectedTags.includes(tag)
                      ? (isDark ? '1px solid rgba(56, 142, 232, 0.7)' : '1px solid rgba(25, 118, 210, 0.5)')
                      : (isDark ? '1px solid rgba(186, 104, 200, 0.7)' : '1px solid rgba(156, 39, 176, 0.5)'),
                  },
                  '& .MuiChip-label': {
                    px: 1.5,
                    py: 0,
                    fontSize: '0.8rem'
                  }
                }}
              />
            ))}
          </Box>
          {selectedTags.length > 0 && (
            <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Filtering by {selectedTags.length} tag{selectedTags.length === 1 ? '' : 's'}
              </Typography>
              <Button 
                size="small" 
                onClick={onClearTags} 
                sx={{ textTransform: 'none', fontSize: '0.75rem' }}
              >
                Clear all
              </Button>
            </Box>
          )}
        </Box>
      )}
    </>
  );
}