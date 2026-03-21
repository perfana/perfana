# Graph Preset Components Architecture

## Component Hierarchy

```
CustomGraphCard (parent component - to be implemented)
│
├── GraphPresetsTable
│   ├── Table Header (Name, Description, Series Count, Created, Actions)
│   ├── Preset Rows (map over presets)
│   │   ├── Load Button (PlayArrow icon)
│   │   └── Delete Button (Delete icon, owner only)
│   ├── Empty State (when no presets)
│   ├── Loading State (CircularProgress)
│   └── Delete Confirmation Dialog
│
└── SaveGraphPresetModal
    ├── Dialog Header (Save icon + title)
    ├── Dialog Content
    │   ├── Warning Alert (if no series)
    │   ├── Basic Information Section
    │   │   ├── Name TextField (auto-generated)
    │   │   └── Description TextField (auto-generated)
    │   ├── Preset Scope Section
    │   │   ├── Global Radio Button
    │   │   └── Test Run Specific Radio Button
    │   └── Configuration Preview Section
    │       ├── Series Count Display
    │       └── Series List (color-coded chips)
    └── Dialog Actions
        ├── Cancel Button
        └── Save Button (disabled when invalid)
```

## Data Flow

### Loading Presets
```
1. Component Mount
   └─> GraphPresetsAPI.getAll(testRunId?)
       └─> authenticatedFetch('/graph-presets?testRunId=...')
           └─> Backend API
               └─> Response: GraphPreset[]
                   └─> setState(presets)
                       └─> GraphPresetsTable renders
```

### Saving Preset
```
1. User configures graph series
   └─> currentSeriesConfig: SeriesConfig[]

2. User clicks "Save Preset"
   └─> SaveGraphPresetModal opens
       └─> Auto-generates name & description
           └─> GraphPresetUtils.generatePresetName()
           └─> GraphPresetUtils.generateDescription()

3. User reviews/edits preset data
   └─> Validates form
       └─> Name required
       └─> At least 1 series required

4. User clicks "Save"
   └─> onSave(formData: GraphPresetFormData)
       └─> GraphPresetsAPI.create(formData)
           └─> authenticatedFetch('/graph-presets', POST)
               └─> Backend API
                   └─> Response: GraphPreset
                       └─> Add to presets array
                           └─> Show success toast
```

### Loading Preset
```
1. User clicks Load button in table
   └─> onSelectPreset(preset: GraphPreset)
       └─> setCurrentSeriesConfig(preset.series_config)
           └─> Graph component re-renders with new series
               └─> Show success toast
```

### Deleting Preset
```
1. User clicks Delete button (if owner)
   └─> Confirmation dialog opens
       └─> User confirms deletion
           └─> onDeletePreset(presetId)
               └─> GraphPresetsAPI.delete(presetId)
                   └─> authenticatedFetch('/graph-presets/:id', DELETE)
                       └─> Backend API
                           └─> Response: 204 No Content
                               └─> Remove from presets array
                                   └─> Show success toast
```

## State Management

### Parent Component State
```typescript
const [currentSeries, setCurrentSeries] = useState<SeriesConfig[]>([]);
const [presets, setPresets] = useState<GraphPreset[]>([]);
const [loadingPresets, setLoadingPresets] = useState(false);
const [saveModalOpen, setSaveModalOpen] = useState(false);
const [saving, setSaving] = useState(false);
```

### GraphPresetsTable Internal State
```typescript
const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
const [presetToDelete, setPresetToDelete] = useState<GraphPreset | null>(null);
```

### SaveGraphPresetModal Internal State
```typescript
const [formData, setFormData] = useState<GraphPresetFormData>({
  name: '',
  description: '',
  series_config: [],
  test_run_id: undefined,
  is_global: true
});
const [errors, setErrors] = useState<{[key: string]: string}>({});
```

## API Contract

### SeriesConfig Structure
```json
{
  "application_dashboard_id": "uuid-or-dashboard-id",
  "panel_id": 123,
  "panel_title": "Response Time",
  "series_name": "p95",
  "source": "grafana",
  "dashboard_label": "System Performance"
}
```

### Create Preset Request
```json
POST /graph-presets
{
  "name": "Response Time Analysis",
  "description": "Key response time metrics across services",
  "series_config": [
    {
      "application_dashboard_id": "...",
      "panel_id": 123,
      "panel_title": "Response Time",
      "source": "grafana"
    }
  ],
  "test_run_id": "optional-test-run-id",
  "is_global": true
}
```

### Preset Response
```json
{
  "id": "preset-uuid",
  "name": "Response Time Analysis",
  "description": "Key response time metrics across services",
  "series_config": [...],
  "test_run_id": null,
  "is_global": true,
  "user_id": "user-uuid",
  "created_at": "2024-12-06T17:00:00Z",
  "updated_at": "2024-12-06T17:00:00Z"
}
```

## Security & Permissions

### Authentication
- All API calls use `authenticatedFetch`
- Automatically includes `Authorization: Bearer {token}` header
- Supports both Keycloak JWT and API Key authentication
- Automatic token refresh on 401 responses

### Authorization
- Users can only delete their own presets
- Delete button hidden if `preset.user_id !== currentUserId`
- Backend enforces ownership check (403 on unauthorized delete)
- Global presets visible to all users
- Test run-specific presets filtered by test run access

## Performance Considerations

### Optimizations
- Lazy loading of presets (only fetch when needed)
- Memoized utility functions (name/description generation)
- Efficient table rendering with key props
- Debounced search (if implemented in future)

### Network Efficiency
- Single API call to load all presets
- Optimistic UI updates (update state before API response)
- Error recovery with user feedback

## Accessibility

### Keyboard Navigation
- All interactive elements are keyboard accessible
- Tab order follows visual hierarchy
- Escape key closes modals
- Enter key submits forms

### Screen Readers
- ARIA labels on all icon buttons
- Semantic HTML structure
- Role attributes where appropriate
- Alert messages for validation errors

### Visual Accessibility
- High contrast colors (WCAG AA compliant)
- Focus indicators on interactive elements
- Clear visual hierarchy
- Responsive text sizing

## Error Handling

### Validation Errors
- Required field validation (name)
- Series count validation (at least 1)
- Inline error messages
- Disabled submit button when invalid

### API Errors
```typescript
try {
  await GraphPresetsAPI.create(formData);
} catch (err) {
  // Safe error handling pattern
  const message = err && typeof err === 'object' && 'message' in err
    ? (err as Error).message
    : 'Failed to save preset';
  showToast(message);
}
```

### Network Errors
- 401: Token refresh, retry, or redirect to login
- 403: Permission denied message
- 404: Preset not found message
- 500: Generic error message with retry option

## Future Enhancements

### Potential Features
1. **Search/Filter Presets**: Search by name or description
2. **Preset Categories**: Group presets by type or purpose
3. **Preset Sharing**: Share presets with team members
4. **Preset Templates**: Pre-built templates for common use cases
5. **Preset Versioning**: Track changes to presets over time
6. **Preset Import/Export**: JSON import/export for backup/migration
7. **Preset Duplication**: Clone existing presets for quick creation
8. **Preset Favoriting**: Mark frequently used presets as favorites

### Extensibility Points
- Custom validation rules via props
- Custom series renderers
- Plugin system for additional metadata
- Event hooks for analytics tracking
