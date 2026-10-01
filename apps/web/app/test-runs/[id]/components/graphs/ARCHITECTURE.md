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
       └─> Does the caller already OWN a preset with this name and scope?
           └─> yes: authenticatedFetch('/graph-presets/:id', PATCH)
           └─> no:  authenticatedFetch('/graph-presets', POST)
               └─> Backend API
                   └─> Response: GraphPreset
                       └─> Refetch presets
                           └─> Show success toast
```

The owner check is load-bearing: `findAll` returns other people's global presets, so a
name match alone would PATCH a row the caller does not own.

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
  "test_run_id": "required-test-run-id",
  "is_global": true
}
```

`test_run_id` is required: it is what the API derives the preset's owning system from.
`is_global: true` means **every run of that system and environment**, not every system —
a global preset is matched back to its system through its first series'
application dashboard. `test_run_id` cannot be changed by a PATCH.

### Update Preset Request
```json
PATCH /graph-presets/:id
{
  "name": "Response Time Analysis",
  "description": "Key response time metrics across services",
  "series_config": [...],
  "is_global": true
}
```

Every field is optional, and `test_run_id` is not accepted at all — the global
`ValidationPipe` strips it, so sending it is a silent no-op. A preset belongs to the
system it was saved from; re-scoping it is a delete and a re-save. `is_global: false`
is refused on a legacy preset that has no `test_run_id`, because such a preset would
then match no run and could not be widened again.

### Preset Response
```json
{
  "id": "preset-uuid",
  "name": "Response Time Analysis",
  "description": "Key response time metrics across services",
  "series_config": [...],
  "test_run_id": "the-run-it-was-saved-from",
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
- Users can only update or delete their own presets; global admins may do either to any
- Delete button hidden if `preset.user_id !== currentUserId`
- Backend enforces ownership check (403 on unauthorized update or delete)
- **Organization boundary first.** Every route resolves the caller's accessible
  organizations and a preset outside them answers **404**, not 403 — a 403 would confirm
  the id exists. `GET /graph-presets` without a `testRunId` is scoped to those
  organizations too; it previously returned every global preset in the database.
- The save flow upserts only over a preset the caller **owns**. `findAll` legitimately
  returns other people's global presets, so matching on name alone let a name collision
  overwrite someone else's row.
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
