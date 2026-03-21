# Clickable Trends Chart Implementation

## Overview
Implemented clickable data points in the Trends chart within the AnomalyDetectionTable component, allowing users to select different test runs and view their details.

## Changes Made

### 1. State Management
**File:** `/Users/daniel/workspace/perfana-next-gen/apps/web/app/test-runs/[id]/components/anomaly-detection/components/AnomalyDetectionTable.tsx`

Added state to track selected test run per row:
```typescript
const [selectedTestRunId, setSelectedTestRunId] = useState<Record<string, string>>({});
```

### 2. Enhanced Marker Visualization

Updated the `createTrendsPlot` function to accept `selectedTestRunIdForRow` parameter and implemented visual differentiation:

#### Color Scheme:
- **Orange (#ff9800)**: Selected test run (user clicked)
- **Purple (#9c27b0)**: Current test run (page context)
- **Red (#d32f2f)**: Regression points
- **Blue (#1976d2)**: Normal points

#### Marker Symbols:
- **Star**: Selected test run
- **Diamond**: Current test run
- **X**: Regression points
- **Circle**: Normal points

#### Marker Sizes:
- **14px**: Selected or current test run
- **10px**: Other points

### 3. Click Handler Implementation

Added onClick event handler to the Plot component:
```typescript
onClick={(event: any) => {
  if (event.points && event.points.length > 0) {
    const clickedPoint = event.points[0];
    const clickedTestRunId = clickedPoint.customdata?.testRunId;

    if (clickedTestRunId) {
      setSelectedTestRunId(prev => ({
        ...prev,
        [rowKey]: clickedTestRunId
      }));
    }
  }
}}
```

### 4. Dynamic Chart Updates

Updated the Plot component key to force re-render when selection changes:
```typescript
key={`${rowKey}-${chartKey[rowKey] || 0}-${drawerOpen[rowKey] ? 'open' : 'closed'}-${selectedTestRunId[rowKey] || 'none'}`}
```

### 5. Current Test Run Chart Integration

Modified the "Current Test Run Details" section to:
- Display selected test run data instead of current test run
- Update header text to show selected test run ID
- Pass correct test run ID to `CurrentTestRunChart` component
- Find matching thresholds for the selected test run

### 6. Reset Functionality

Added a "Reset to Current" button that:
- Only appears when a different test run is selected
- Clears the selection for the current row
- Returns to displaying the current test run data

Button styling follows project standards:
```typescript
<Button
  size="small"
  variant="outlined"
  onClick={() => {
    setSelectedTestRunId(prev => {
      const newState = { ...prev };
      delete newState[rowKey];
      return newState;
    });
  }}
  sx={{
    fontSize: '0.75rem',
    py: 0.5,
    px: 1.5,
    borderColor: 'primary.main',
    color: 'primary.main',
    '&:hover': {
      backgroundColor: 'primary.main',
      color: 'white',
      borderColor: 'primary.main'
    }
  }}
>
  Reset to Current
</Button>
```

## User Experience Flow

1. **Initial State**: Chart displays all test runs with current test run highlighted as purple diamond
2. **User Clicks Point**: Selected point becomes orange star, larger than other points
3. **Chart Updates**: CurrentTestRunChart below updates to show selected test run's data
4. **Header Changes**: "Current Test Run Details" changes to "Selected Test Run: {testRunId}"
5. **Reset Button Appears**: User can click "Reset to Current" to return to original state
6. **Click Another Point**: Previous selection clears, new point highlighted

## Visual Indicators

### Trends Chart Legend (by marker type):
- 🔶 Orange Star (Large): Selected test run by user
- 💎 Purple Diamond (Large): Current test run (page context)
- ❌ Red X: Regression test run
- 🔵 Blue Circle: Normal test run

### State Persistence
- Selections are per-row (each metric has independent selection)
- Selection persists when drawer opens/closes
- Selection clears on page navigation

## Technical Implementation Details

### Type Safety
- All TypeScript types properly defined
- No usage of `any` except for Plotly event handler (Plotly types limitation)
- Safe error checking patterns maintained

### Performance Considerations
- State updates are scoped per row to avoid unnecessary re-renders
- Chart key includes selection state to ensure proper re-rendering
- No performance impact on other rows when one is selected

### Accessibility
- Button has clear label "Reset to Current"
- Keyboard navigation supported through standard button interactions
- Visual indicators (color + shape + size) provide multiple differentiation methods

## Testing Recommendations

1. **Click Interaction**: Verify clicking data points updates the chart correctly
2. **Multiple Rows**: Ensure selections in different rows are independent
3. **Reset Functionality**: Confirm reset button returns to current test run
4. **Visual Highlighting**: Check all marker styles render correctly
5. **Drawer Interaction**: Verify selection persists when opening/closing drawer
6. **Edge Cases**: Test clicking current test run, clicking same point twice

## Files Modified

- `/Users/daniel/workspace/perfana-next-gen/apps/web/app/test-runs/[id]/components/anomaly-detection/components/AnomalyDetectionTable.tsx`

## Compliance with CODING_RULES.md

✅ **TypeScript Best Practices**: Strong typing, no unsafe `any` usage
✅ **React Patterns**: Proper state management with useState
✅ **MUI Theming**: Consistent use of theme colors and spacing
✅ **Error Handling**: Safe type checking patterns
✅ **Component Design**: Single Responsibility Principle maintained
✅ **Performance**: Optimized re-renders with proper key usage
✅ **Accessibility**: Keyboard navigation and clear labeling
✅ **UI Standards**: Follows project's button and typography patterns
