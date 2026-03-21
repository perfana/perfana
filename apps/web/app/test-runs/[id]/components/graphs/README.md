# Graph Preset Components

This directory contains React components for managing graph presets in the Perfana platform.

## Components

### 1. GraphPresetsTable

A table component that displays saved graph presets with load and delete functionality.

**Props:**
```typescript
interface GraphPresetsTableProps {
  presets: GraphPreset[];           // Array of graph presets to display
  loading: boolean;                 // Loading state for the table
  currentUserId?: string;           // Current user ID for permission checks
  onSelectPreset: (preset: GraphPreset) => void;  // Handler when preset is selected
  onDeletePreset: (presetId: string) => void;     // Handler when preset is deleted
}
```

**Features:**
- Responsive table with name, description, series count, and creation date
- Load button to apply preset configuration
- Delete button (only visible to preset owner)
- Empty state with helpful instructions
- Confirmation dialog for deletions
- Hover effects and smooth transitions

**Example Usage:**
```typescript
import { GraphPresetsTable } from './components/graphs';

<GraphPresetsTable
  presets={savedPresets}
  loading={loadingPresets}
  currentUserId={user?.id}
  onSelectPreset={handleLoadPreset}
  onDeletePreset={handleDeletePreset}
/>
```

### 2. SaveGraphPresetModal

A modal dialog for creating new graph presets with auto-generated suggestions.

**Props:**
```typescript
interface SaveGraphPresetModalProps {
  open: boolean;                    // Controls modal visibility
  onClose: () => void;              // Handler when modal is closed
  onSave: (presetData: GraphPresetFormData) => Promise<void>;  // Handler for save action
  currentTestRunId?: string;        // Optional test run ID for test-specific presets
  currentSeriesConfig: SeriesConfig[];  // Current graph series configuration
  loading?: boolean;                // Loading state during save operation
}
```

**Features:**
- Auto-generated preset name based on series configuration
- Auto-generated description with dashboard and panel info
- Scope selection (global or test run-specific)
- Visual preview of series to be saved
- Validation for required fields
- Disabled state when no series configured

**Example Usage:**
```typescript
import { SaveGraphPresetModal } from './components/graphs';

const handleSavePreset = async (formData: GraphPresetFormData) => {
  try {
    const newPreset = await GraphPresetsAPI.create(formData);
    showToast('Preset saved successfully');
    setPresets(prev => [...prev, newPreset]);
  } catch (error) {
    showToast('Failed to save preset');
  }
};

<SaveGraphPresetModal
  open={saveModalOpen}
  onClose={() => setSaveModalOpen(false)}
  onSave={handleSavePreset}
  currentTestRunId={testRunId}
  currentSeriesConfig={currentSeries}
  loading={saving}
/>
```

## API Client

### GraphPresetsAPI

TypeScript API client for graph preset operations.

**Methods:**
```typescript
// Fetch all presets (optionally filtered by test run)
GraphPresetsAPI.getAll(testRunId?: string): Promise<GraphPreset[]>

// Fetch single preset by ID
GraphPresetsAPI.getById(id: string): Promise<GraphPreset>

// Create new preset
GraphPresetsAPI.create(preset: CreateGraphPresetRequest): Promise<GraphPreset>

// Update existing preset
GraphPresetsAPI.update(id: string, preset: UpdateGraphPresetRequest): Promise<GraphPreset>

// Delete preset
GraphPresetsAPI.delete(id: string): Promise<void>
```

**Example Usage:**
```typescript
import { GraphPresetsAPI } from '@/lib/graph-presets';

// Load presets for current test run
const presets = await GraphPresetsAPI.getAll(testRunId);

// Create new preset
const newPreset = await GraphPresetsAPI.create({
  name: 'Response Time Analysis',
  description: 'Key response time metrics',
  series_config: currentSeries,
  is_global: true
});

// Delete preset
await GraphPresetsAPI.delete(presetId);
```

## Utility Functions

### GraphPresetUtils

Helper functions for working with graph presets.

**Methods:**
```typescript
// Generate suggested preset name
GraphPresetUtils.generatePresetName(seriesConfig: SeriesConfig[]): string

// Generate suggested description
GraphPresetUtils.generateDescription(seriesConfig: SeriesConfig[]): string

// Check if user can modify preset
GraphPresetUtils.canModify(preset: GraphPreset, currentUserId: string): boolean

// Group presets by scope
GraphPresetUtils.groupPresets(presets: GraphPreset[], currentUserId: string)

// Get preset summary for tooltips
GraphPresetUtils.getSummary(preset: GraphPreset): string
```

## Data Types

### SeriesConfig

Represents a single metric series in the graph configuration.

```typescript
interface SeriesConfig {
  application_dashboard_id: string;  // Dashboard ID (Grafana or Dynatrace)
  panel_id: number;                  // Panel ID within the dashboard
  panel_title: string;               // Human-readable panel title
  series_name?: string;              // Optional series filter/search text
  source?: 'grafana' | 'dynatrace'; // Data source type
  dashboard_label?: string;          // Dashboard label for display
}
```

### GraphPreset

Complete graph preset entity from the API.

```typescript
interface GraphPreset {
  id: string;                        // Unique preset ID
  name: string;                      // Preset name
  description?: string;              // Optional description
  series_config: SeriesConfig[];     // Array of metric series
  test_run_id?: string;              // Optional test run ID (if test-specific)
  is_global: boolean;                // Global vs test-specific scope
  user_id: string;                   // Owner user ID
  created_at: string;                // Creation timestamp
  updated_at: string;                // Last update timestamp
}
```

## Complete Integration Example

```typescript
'use client';

import { useState, useEffect } from 'react';
import { Box, Button } from '@mui/material';
import { Save } from '@mui/icons-material';
import { GraphPresetsTable, SaveGraphPresetModal } from './components/graphs';
import { GraphPresetsAPI, type SeriesConfig, type GraphPreset } from '@/lib/graph-presets';

export default function CustomGraphCard({ testRunId }: { testRunId: string }) {
  const [currentSeries, setCurrentSeries] = useState<SeriesConfig[]>([]);
  const [presets, setPresets] = useState<GraphPreset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string>('');

  // Load presets on mount
  useEffect(() => {
    loadPresets();
  }, [testRunId]);

  const loadPresets = async () => {
    setLoadingPresets(true);
    try {
      const data = await GraphPresetsAPI.getAll(testRunId);
      setPresets(data);
    } catch (error) {
      console.error('Failed to load presets:', error);
    } finally {
      setLoadingPresets(false);
    }
  };

  const handleSavePreset = async (formData) => {
    setSaving(true);
    try {
      const newPreset = await GraphPresetsAPI.create(formData);
      setPresets(prev => [...prev, newPreset]);
      showToast('Preset saved successfully');
    } catch (error) {
      showToast('Failed to save preset');
    } finally {
      setSaving(false);
    }
  };

  const handleLoadPreset = (preset: GraphPreset) => {
    setCurrentSeries(preset.series_config);
    showToast(`Loaded preset: ${preset.name}`);
  };

  const handleDeletePreset = async (presetId: string) => {
    try {
      await GraphPresetsAPI.delete(presetId);
      setPresets(prev => prev.filter(p => p.id !== presetId));
      showToast('Preset deleted successfully');
    } catch (error) {
      showToast('Failed to delete preset');
    }
  };

  return (
    <Box>
      {/* Graph visualization */}
      {/* ... */}

      {/* Save Preset Button */}
      <Button
        variant="outlined"
        startIcon={<Save />}
        onClick={() => setSaveModalOpen(true)}
        disabled={currentSeries.length === 0}
      >
        Save Preset
      </Button>

      {/* Saved Presets Table */}
      <GraphPresetsTable
        presets={presets}
        loading={loadingPresets}
        currentUserId={userId}
        onSelectPreset={handleLoadPreset}
        onDeletePreset={handleDeletePreset}
      />

      {/* Save Preset Modal */}
      <SaveGraphPresetModal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        onSave={handleSavePreset}
        currentTestRunId={testRunId}
        currentSeriesConfig={currentSeries}
        loading={saving}
      />
    </Box>
  );
}
```

## Design Patterns

All components follow established Perfana frontend patterns:

1. **Authentication**: All API calls use `authenticatedFetch` with proper header handling
2. **Error Handling**: Safe error checking pattern for runtime safety
3. **Material-UI**: Consistent theming and styling with MUI components
4. **TypeScript**: Strict typing with comprehensive interfaces
5. **Accessibility**: ARIA labels, semantic HTML, keyboard navigation
6. **Performance**: Memoization where appropriate, efficient re-renders

## Testing

Recommended test coverage:

1. **Unit Tests**: Test utility functions and validation logic
2. **Component Tests**: Test user interactions and state management
3. **Integration Tests**: Test API client with mock responses
4. **E2E Tests**: Test complete preset save/load workflow

## Contributing

When modifying these components:

1. Maintain TypeScript strict mode compliance
2. Follow project coding rules (see CODING_RULES.md)
3. Update this README if adding new features
4. Ensure backward compatibility with existing presets
5. Add proper JSDoc comments for new functions
