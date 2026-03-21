# AnomalyDetectionSection Component Refactoring Plan

## Overview
Breaking up the monolithic AnomalyDetectionSection.tsx (33,767 tokens) into smaller, maintainable components following the pattern established in the systems config components.

## Current State Analysis
- **File Size**: 33,767 tokens in a single component
- **Responsibilities**: Anomaly detection, trend visualization, configuration management, UI state management
- **Complexity**: Multiple nested states, API calls, form handling, chart rendering

## Proposed Component Architecture

### 1. Main Container Components

#### `AnomalyDetectionSection.tsx` *(Main orchestrator - ~200 lines)*
- **Responsibilities**: Props interface, main state coordination, data fetching orchestration
- **Key Functions**:
  - Expanded/collapsed state logic
  - Primary data fetching coordination
  - Renders either collapsed or expanded card based on state

#### `AnomalyDetectionCollapsedCard.tsx` *(~150 lines)*
- **Responsibilities**: Collapsed state UI (440px height)
- **Sections**:
  1. Header with expand button
  2. Primary info (blue box with regression count)
  3. Secondary content (clickable conclusion chips)
  4. Status icon (green/red circular indicator)
  5. Footer (decorative elements)
- **Key Features**: Auto-focus expand functionality, conclusion chip interactions

#### `AnomalyDetectionExpandedCard.tsx` *(~300 lines)*
- **Responsibilities**: Main expanded container coordination
- **Sections**:
  1. Tab navigation (Anomaly Detection vs Tracked Regressions)
  2. Feedback banners integration
  3. Table and pagination coordination
  4. Filter controls integration

### 2. Feature-Specific Components

#### `FeedbackBanner.tsx` *(~100 lines)*
- **Responsibilities**: TBD/Accepted/Denied state banners
- **Key Functions**: Adapt config update handlers, alert styling and messaging

#### `FilterControls.tsx` *(~80 lines)*
- **Responsibilities**: Search and filter functionality
- **Components**:
  - Search text input
  - Conclusion dropdown filter
  - Classification dropdown filter
  - Clear filters functionality

#### `AnomalyDetectionTable.tsx` *(~200 lines)*
- **Responsibilities**: Main data table structure
- **Key Functions**:
  - Column definitions and sorting
  - Expandable row coordination
  - Loading states and empty states

#### `AnomalyDetectionRow.tsx` *(~300 lines)*
- **Responsibilities**: Individual table row rendering
- **Key Functions**:
  - Expand/collapse toggle
  - Nested trend charts and details
  - Configuration form integration

### 3. Visualization Components

#### `TrendChart.tsx` *(~150 lines)*
- **Responsibilities**: Time series visualization
- **Key Functions**:
  - Plotly.js time series charts
  - Threshold line rendering
  - Unit conversion and formatting
  - Chart resizing and re-render logic

#### `DetailDrawer.tsx` *(~200 lines)*
- **Responsibilities**: Statistics breakdown drawer
- **Key Functions**:
  - Statistics table with detailed data
  - Loading states and error handling
  - Drawer open/close logic

### 4. Configuration Components

#### `MetricConfigurationDialog.tsx` *(~250 lines)*
- **Responsibilities**: Metric configuration form
- **Key Functions**:
  - Configuration form modal
  - Metric-specific settings
  - Save/cancel functionality
  - Form validation

#### `ThresholdEditor.tsx` *(~150 lines)*
- **Responsibilities**: Threshold editing interface
- **Key Functions**:
  - In-line threshold editing
  - Upper/lower bound inputs
  - Save/cancel/edit modes

### 5. Utility and Type Files

#### `types.ts` *(~100 lines)*
- AnomalyData interface
- MetricTrendData interface
- Configuration types
- State management types

#### `utils.ts` *(~200 lines)*
- Data formatting functions
- Color mapping utilities
- API response processing
- Chart data generation

#### `hooks.ts` *(~150 lines)*
- Custom hooks for data fetching
- State management hooks
- Chart interaction hooks

## Directory Structure
```
anomaly-detection/
├── AnomalyDetectionSection.tsx          # Main orchestrator
├── REFACTORING_PLAN.md                  # This document
├── components/
│   ├── AnomalyDetectionCollapsedCard.tsx
│   ├── AnomalyDetectionExpandedCard.tsx
│   ├── AnomalyDetectionTable.tsx
│   ├── AnomalyDetectionRow.tsx
│   ├── FeedbackBanner.tsx
│   ├── FilterControls.tsx
│   ├── TrendChart.tsx
│   ├── DetailDrawer.tsx
│   ├── MetricConfigurationDialog.tsx
│   └── ThresholdEditor.tsx
├── hooks/
│   ├── useAnomalyData.ts
│   ├── useTrendData.ts
│   └── useConfigForm.ts
├── utils/
│   ├── formatters.ts
│   ├── chartHelpers.ts
│   └── apiHelpers.ts
└── types.ts
```

## Migration Strategy

### Phase 1: Foundation (Types and Utils) ✅ COMPLETED
1. ✅ **Create refactoring plan document**
2. ✅ **Extract types and interfaces into types.ts**
3. ✅ **Extract utility functions into utils.ts**

### Phase 2: Visualization Components ✅ COMPLETED
4. ✅ **Create TrendChart component**
5. ✅ **Create DetailDrawer component**

### Phase 3: UI Components ✅ COMPLETED
6. ✅ **Create FilterControls component**
7. ✅ **Create AnomalyDetectionTable component**
8. ✅ **Create AnomalyDetectionRow component**

### Phase 4: Container Components ✅ COMPLETED
9. ✅ **Create AnomalyDetectionCollapsedCard component**
10. ✅ **Create AnomalyDetectionExpandedCard component**

### Phase 5: Main Refactor ✅ COMPLETED
11. ✅ **Refactor main AnomalyDetectionSection to orchestrator**
12. ✅ **Test refactored components**

## Benefits

1. **Maintainability** - Each component has a single, clear responsibility
2. **Testability** - Smaller components are easier to unit test
3. **Reusability** - Charts, filters, and forms can be reused elsewhere
4. **Performance** - Better tree-shaking and code splitting opportunities
5. **Developer Experience** - Easier to navigate, understand, and modify
6. **Consistency** - Follows the established pattern from systems config components

## Key Considerations

- **State Management**: Carefully extract shared state to avoid prop drilling
- **API Calls**: Consolidate related API calls into custom hooks
- **Performance**: Ensure chart re-rendering doesn't cause performance issues
- **Testing**: Each extracted component should have comprehensive tests
- **TypeScript**: Maintain strong typing throughout the refactor

## Success Criteria

- [ ] All functionality preserved
- [ ] No performance regressions
- [ ] Improved code organization and maintainability
- [ ] Consistent with existing component patterns
- [ ] Full TypeScript coverage
- [ ] Comprehensive test coverage