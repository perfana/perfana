# Reporting Templates - Batch Delete Feature

## Overview

Added batch delete functionality to the Reporting Templates section in System Config, allowing users to select multiple templates with checkboxes and delete them in a single operation. This feature follows the same pattern as the Grafana Dashboards configuration.

## User Experience

### Selecting Templates

1. Navigate to **Systems → [System Name] → Config → Reporting Templates**
2. **Checkboxes appear** in the leftmost column of the table
3. Click individual checkboxes to select specific templates
4. Click the **header checkbox** to select/deselect all visible templates
5. Selected rows are highlighted with a background color

### Batch Delete Action

1. After selecting one or more templates, a **blue toolbar** appears above the table
2. Toolbar shows: **"X template(s) selected"**
3. Two action buttons are available:
   - **Delete (trash icon)** - Delete all selected templates
   - **Clear selection (X icon)** - Deselect all templates
4. Click **Delete** button
5. Confirmation dialog appears: **"Delete Multiple Templates"**
6. Confirm or cancel the operation
7. On confirm, all selected templates are deleted
8. Selection is cleared automatically

## UI Components

### Toolbar

Appears when one or more templates are selected:

```
┌─────────────────────────────────────────────────┐
│  3 templates selected          🗑️  ✕           │
│                              Delete  Clear       │
└─────────────────────────────────────────────────┘
```

**Styling:**
- Background: `rgba(25, 118, 210, 0.08)` (light blue)
- Text color: Primary blue
- Icons: Delete (red), Clear (default)

### Table Checkboxes

**Header Checkbox:**
- **Checked**: All visible templates selected
- **Indeterminate**: Some (but not all) templates selected
- **Unchecked**: No templates selected

**Row Checkboxes:**
- Click to toggle selection for individual template
- Prevents row click event from firing (stops propagation)

**Selected Row:**
- Background highlight via Material-UI `selected` prop
- Visual distinction from unselected rows

### Confirmation Dialog

```
┌─────────────────────────────────────────────────┐
│ Delete Multiple Templates                  ✕    │
├─────────────────────────────────────────────────┤
│                                                 │
│ Are you sure you want to delete X templates?   │
│ This action cannot be undone.                   │
│                                                 │
├─────────────────────────────────────────────────┤
│                          [Cancel]  [Delete]     │
└─────────────────────────────────────────────────┘
```

**Features:**
- Clear warning message
- Dynamic count of templates to be deleted
- Red "Delete" button for destructive action
- Loading state during deletion

## Implementation Details

### 1. ReportingTemplatesSection Component

**File**: `apps/web/app/systems/[id]/config/components/ReportingTemplatesSection.tsx`

#### Added State
```typescript
const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());
const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
const [batchDeleteLoading, setBatchDeleteLoading] = useState(false);
```

#### Added Handlers
```typescript
// Get filtered templates (respects search)
const getFilteredTemplates = () => { ... };

// Select all visible templates
const handleSelectAll = () => {
  if (selectedTemplateIds.size === filteredTemplates.length) {
    setSelectedTemplateIds(new Set());
  } else {
    setSelectedTemplateIds(new Set(filteredTemplates.map((t) => t.id)));
  }
};

// Toggle selection for single template
const handleSelectOne = (id: string) => {
  const newSelected = new Set(selectedTemplateIds);
  if (newSelected.has(id)) {
    newSelected.delete(id);
  } else {
    newSelected.add(id);
  }
  setSelectedTemplateIds(newSelected);
};

// Clear all selections
const handleClearSelection = () => {
  setSelectedTemplateIds(new Set());
};

// Initiate batch delete
const handleBatchDeleteClick = () => {
  setBatchDeleteDialogOpen(true);
};

// Confirm and execute batch delete
const handleBatchDeleteConfirm = async () => {
  const idsToDelete = Array.from(selectedTemplateIds);
  try {
    setBatchDeleteLoading(true);
    await onBatchDelete(idsToDelete);
    setBatchDeleteDialogOpen(false);
    handleClearSelection();
  } catch (err) {
    // Error handled by parent
  } finally {
    setBatchDeleteLoading(false);
  }
};
```

#### Added Props
```typescript
interface ReportingTemplatesSectionProps {
  // ... existing props
  onBatchDelete: (ids: string[]) => Promise<void>;
}
```

#### Added UI Elements

**Toolbar** (shown when templates are selected):
```tsx
{selectedTemplateIds.size > 0 && (
  <Paper sx={{ mb: 2 }} elevation={0} variant="outlined">
    <Toolbar sx={{ bgcolor: 'rgba(25, 118, 210, 0.08)' }}>
      <Typography color="primary" variant="subtitle1">
        {selectedTemplateIds.size} template{selectedTemplateIds.size > 1 ? 's' : ''} selected
      </Typography>
      <Tooltip title="Delete selected">
        <IconButton onClick={handleBatchDeleteClick} color="error">
          <DeleteIcon />
        </IconButton>
      </Tooltip>
      <Tooltip title="Clear selection">
        <IconButton onClick={handleClearSelection}>
          <CloseIcon />
        </IconButton>
      </Tooltip>
    </Toolbar>
  </Paper>
)}
```

**Confirmation Dialog**:
```tsx
<Dialog open={batchDeleteDialogOpen} onClose={handleBatchDeleteCancel}>
  <DialogTitle>Delete Multiple Templates</DialogTitle>
  <DialogContent>
    <DialogContentText>
      Are you sure you want to delete {selectedTemplateIds.size} template
      {selectedTemplateIds.size > 1 ? 's' : ''}? This action cannot be undone.
    </DialogContentText>
  </DialogContent>
  <DialogActions>
    <Button onClick={handleBatchDeleteCancel} disabled={batchDeleteLoading}>
      Cancel
    </Button>
    <Button
      onClick={handleBatchDeleteConfirm}
      color="error"
      variant="contained"
      disabled={batchDeleteLoading}
    >
      {batchDeleteLoading ? <CircularProgress size={20} /> : 'Delete'}
    </Button>
  </DialogActions>
</Dialog>
```

### 2. TemplateTable Component

**File**: `apps/web/app/systems/[id]/config/components/TemplateTable.tsx`

#### Added Props
```typescript
interface TemplateTableProps {
  // ... existing props
  selectedTemplateIds: Set<string>;
  onSelectAll: () => void;
  onSelectOne: (id: string) => void;
}
```

#### Added Checkbox Column

**Header:**
```tsx
<TableCell padding="checkbox">
  <Checkbox
    checked={
      selectedTemplateIds.size > 0 &&
      selectedTemplateIds.size === filteredTemplates.length
    }
    indeterminate={
      selectedTemplateIds.size > 0 &&
      selectedTemplateIds.size < filteredTemplates.length
    }
    onChange={onSelectAll}
    inputProps={{ 'aria-label': 'Select all templates' }}
  />
</TableCell>
```

**Row:**
```tsx
<TableRow selected={selectedTemplateIds.has(template.id)}>
  <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
    <Checkbox
      checked={selectedTemplateIds.has(template.id)}
      onChange={() => onSelectOne(template.id)}
      inputProps={{ 'aria-label': `Select template ${template.name}` }}
    />
  </TableCell>
  {/* ... other cells */}
</TableRow>
```

**Updated Column Span** (for empty state):
```tsx
<TableCell colSpan={8}> {/* Changed from 7 to 8 */}
```

### 3. useReportingTemplateManagement Hook

**File**: `apps/web/app/systems/[id]/config/hooks/useReportingTemplateManagement.ts`

#### Added Handler
```typescript
const handleBatchDelete = useCallback(async (ids: string[]) => {
  try {
    // Delete all templates in parallel
    await Promise.all(ids.map((id) => deleteTemplate(id)));
    // Remove deleted templates from state
    setTemplates((prev) => prev.filter((t) => !ids.includes(t.id)));
  } catch (err) {
    throw err;
  }
}, []);
```

#### Updated Interface
```typescript
interface UseReportingTemplateManagementReturn {
  // ... existing properties
  handleBatchDelete: (ids: string[]) => Promise<void>;
}
```

#### Updated Return
```typescript
return {
  // ... existing returns
  handleBatchDelete,
};
```

### 4. System Config Page

**File**: `apps/web/app/systems/[id]/config/page.tsx`

#### Connected Batch Delete
```tsx
<ReportingTemplatesSection
  {/* ... other props */}
  onBatchDelete={async (ids) => {
    await template.handleBatchDelete(ids);
  }}
/>
```

## Behavior Details

### Selection Logic

**Select All:**
- Checks if all filtered templates are selected
- If yes: deselects all
- If no: selects all filtered templates
- Only affects **visible** templates (respects search filter)

**Select One:**
- Toggles selection for individual template
- Stops click propagation to prevent row click

**Clear Selection:**
- Deselects all templates
- Can be triggered by clicking X icon or after successful deletion

### Filtering Interaction

**Search Filter:**
- Selection state is **preserved** when search changes
- "Select All" only selects **visible** templates
- Selected templates may not be visible if filtered out
- Selection count in toolbar shows all selected (visible + hidden)

**Example:**
1. User has 10 templates
2. Selects 5 templates
3. Applies search filter → only 2 of the 5 selected templates visible
4. Toolbar shows: "5 templates selected" (not 2)
5. "Select All" would select only the 2 visible templates

### Error Handling

**Deletion Errors:**
- Individual delete failures don't stop other deletions
- Uses `Promise.all()` for parallel deletion
- If any deletion fails, error is thrown
- Parent component handles error display
- Loading state resets even on error

**Empty Selection:**
- Toolbar only appears when selection count > 0
- Delete button only clickable when templates are selected

### Performance

**Parallel Deletion:**
- All selected templates deleted simultaneously
- Uses `Promise.all()` for optimal performance
- Network requests sent in parallel

**State Updates:**
- Single state update after all deletions complete
- Efficient filtering using `Set` for O(1) lookup
- No unnecessary re-renders

## User Flows

### Flow 1: Delete Multiple Templates

1. User navigates to Reporting Templates tab
2. Sees list of 10 templates
3. Clicks checkboxes for 3 templates
4. Blue toolbar appears: "3 templates selected"
5. Clicks delete icon
6. Confirmation dialog: "Delete 3 templates?"
7. Clicks "Delete" button
8. Loading spinner appears
9. All 3 templates deleted
10. Selection cleared
11. Toolbar disappears
12. Template count updates

### Flow 2: Select All and Delete

1. User has 5 templates visible
2. Clicks header checkbox (select all)
3. All 5 templates selected
4. Toolbar: "5 templates selected"
5. Clicks delete icon
6. Confirms deletion
7. All templates deleted
8. Empty state message appears

### Flow 3: Search and Partial Delete

1. User has 20 templates total
2. Applies search filter → 5 templates visible
3. Selects 3 of the visible templates
4. Clears search → all 20 templates visible again
5. Toolbar: "3 templates selected" (original selection preserved)
6. Deletes the 3 selected templates
7. 17 templates remain

### Flow 4: Cancel Operation

1. User selects multiple templates
2. Clicks delete icon
3. Confirmation dialog appears
4. Clicks "Cancel"
5. Dialog closes
6. Templates remain selected
7. Toolbar still visible
8. Can click X to clear selection

## Comparison with Grafana Dashboards

### Similarities

✅ Checkbox selection in table
✅ Select all / select one functionality
✅ Blue toolbar when items selected
✅ Delete and clear selection buttons
✅ Confirmation dialog before deletion
✅ Parallel deletion for performance
✅ Selection state preserved during filtering

### Differences

❌ **No Grafana-specific features:**
  - No "orphaned dashboard" detection
  - No "delete from Grafana" checkbox
  - Simpler confirmation dialog

✅ **Simpler implementation:**
  - Templates only exist in Perfana database
  - No external service coordination needed
  - Straightforward delete operation

## Testing

### Manual Testing Steps

1. **Basic Selection**
   - Select individual templates with checkboxes
   - Verify toolbar appears
   - Verify correct count displayed
   - Verify selected rows highlighted

2. **Select All**
   - Click header checkbox
   - Verify all visible templates selected
   - Click again to deselect all
   - Verify toolbar disappears

3. **Batch Delete**
   - Select multiple templates
   - Click delete button
   - Verify confirmation dialog
   - Confirm deletion
   - Verify templates deleted
   - Verify selection cleared

4. **Cancel Delete**
   - Select templates
   - Click delete
   - Click cancel
   - Verify templates still exist
   - Verify selection preserved

5. **Clear Selection**
   - Select templates
   - Click X icon
   - Verify selection cleared
   - Verify toolbar disappears

6. **Search Interaction**
   - Select templates
   - Apply search filter
   - Verify selection preserved
   - Clear search
   - Verify selection still intact

7. **Edge Cases**
   - Try to delete with no selection (should not be possible)
   - Delete all templates
   - Delete default template
   - Delete while another operation is in progress

### Test Data

Create test templates:

```typescript
// Template 1: Default template
{
  name: "Executive Summary",
  is_default: true,
  section_count: 5
}

// Template 2-5: Regular templates
{
  name: "Performance Report",
  is_default: false,
  section_count: 8
}

// Template 6-10: Templates with search terms
{
  name: "Load Test Analysis",
  description: "Detailed analysis for load testing",
  created_by: "admin@example.com"
}
```

## Accessibility

- **Keyboard Navigation**: All checkboxes keyboard accessible
- **Screen Readers**:
  - Checkboxes have descriptive aria-labels
  - Header checkbox: "Select all templates"
  - Row checkboxes: "Select template [name]"
- **Focus States**: Clear focus indicators on checkboxes
- **Color Contrast**: Selected row background meets WCAG AA

## Future Enhancements

1. **Undo Delete**: Add ability to undo batch delete
2. **Bulk Actions**: Add more batch operations (duplicate, export, tag)
3. **Selection Stats**: Show section count total for selected templates
4. **Keyboard Shortcuts**:
   - Ctrl+A: Select all
   - Delete: Delete selected
   - Escape: Clear selection
5. **Progress Indicator**: Show progress during multi-template deletion
6. **Partial Failure Handling**: Better UX for partial deletion failures

## Related Documentation

- [Template Selector Feature](TEMPLATE_SELECTOR_FEATURE.md)
- [Template Update Method Fix](TEMPLATE_UPDATE_METHOD_FIX.md)
- [Template Section Builder](TEMPLATE_SECTION_BUILDER_UPDATE.md)
- [Report Card Templates Deep Link](REPORT_CARD_TEMPLATES_DEEPLINK.md)
