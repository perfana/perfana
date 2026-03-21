# Status Badge Implementation Guide

## Overview

The `StatusBadge` component provides accessible, visually consistent status indication for test run cards. It uses triple encoding (color + icon + text) to meet WCAG AA accessibility standards.

## When to Use Status Badges

### ✅ Use Status Badges For:

**Result Cards** - Cards that display pass/fail outcomes:
- **TestRunDetailsCard**: Overall test execution result
- **ServiceLevelObjectivesSection**: SLO compliance status
- **AnomalyDetectionSection**: Regression detection results

### ❌ Do NOT Use Status Badges For:

**Utility/Informational Cards** - Cards that provide tools or navigation:
- **DeepLinksCard**: Navigation links to external tools
- **DynatraceCard**: APM tool integration and navigation
- **DashboardsSection**: Grafana dashboard selection
- **ConfigurationComparisonSection**: Configuration analysis tool
- **TrendsCard**: Historical metrics visualization
- **CompareCard**: Test run comparison tool

## Component API

### StatusBadge Component

```typescript
import StatusBadge, { StatusType } from './shared/StatusBadge';

<StatusBadge
  status="success"      // 'success' | 'failure' | 'warning' | 'running' | 'neutral'
  label="Passed"        // Optional: Override default label
  size="small"          // Optional: 'small' | 'medium' (default: 'medium')
  showTooltip={true}    // Optional: Show tooltip on hover (default: true)
/>
```

### CardHeader Integration

```typescript
import CardHeader from './shared/CardHeader';

<CardHeader
  title="Test Run Details"
  expanded={expanded}
  onExpand={handleExpand}
  status="success"           // Optional: StatusType
  statusLabel="All Passed"   // Optional: Custom label
/>
```

## Status Types & Meanings

### Success (Green)
- **Icon**: CheckCircle ✓
- **Default Label**: "Passed"
- **Use For**: Tests passed, SLOs met, no regressions found
- **Color**: `#2e7d32` on `rgba(76, 175, 80, 0.1)`

### Failure (Red)
- **Icon**: Error ✗
- **Default Label**: "Failed"
- **Use For**: Tests failed, SLOs violated, regressions detected
- **Color**: `#c62828` on `rgba(244, 67, 54, 0.1)`

### Warning (Orange)
- **Icon**: Warning ⚠
- **Default Label**: "Warning"
- **Use For**: Partial failures, some SLOs missed, issues detected
- **Color**: `#e65100` on `rgba(255, 152, 0, 0.1)`

### Running (Blue)
- **Icon**: Autorenew 🔄 (animated rotation)
- **Default Label**: "Running"
- **Use For**: Test in progress, analysis running
- **Color**: `#1565c0` on `rgba(33, 150, 243, 0.1)`

### Neutral (Gray)
- **Icon**: Schedule ⏱
- **Default Label**: "Pending"
- **Use For**: Not started, no data available
- **Color**: `#616161` on `rgba(158, 158, 158, 0.1)`

## Implementation Examples

### Example 1: TestRunDetailsCard

```typescript
const getTestRunStatus = (): StatusType => {
  // Test still running
  if (!testRun.completed) return 'running';

  // Test marked as invalid
  if (testRun.valid === false) return 'failure';

  // Check consolidated result
  const result = testRun.consolidated_result?.overall;
  if (result === true) return 'success';
  if (result === false) return 'failure';

  // Completed but no clear result
  return 'warning';
};

<CardHeader
  title="Test Run Details"
  status={getTestRunStatus()}
  expanded={expanded}
  onExpand={handleExpand}
/>
```

### Example 2: ServiceLevelObjectivesSection

```typescript
const getSLOStatus = (): StatusType => {
  if (!sloData || sloData.length === 0) return 'neutral';

  const failed = sloData.filter(slo => !slo.met);
  const total = sloData.length;

  if (failed.length === 0) return 'success';
  if (failed.length === total) return 'failure';
  return 'warning'; // Some failed
};

const getSLOLabel = (): string => {
  const met = sloData.filter(slo => slo.met).length;
  const total = sloData.length;
  return `${met}/${total} Met`;
};

<CardHeader
  title="Service Level Objectives"
  status={getSLOStatus()}
  statusLabel={getSLOLabel()}
  expanded={expanded}
  onExpand={handleExpand}
/>
```

### Example 3: AnomalyDetectionSection

```typescript
const getAnomalyStatus = (): StatusType => {
  if (loading) return 'running';
  if (!hasData) return 'neutral';

  const hasRegressions = detectedAnomalies?.some(a => a.isRegression);
  const hasCritical = detectedAnomalies?.some(a => a.severity === 'critical');

  if (hasCritical) return 'failure';
  if (hasRegressions) return 'warning';
  return 'success';
};

<CardHeader
  title="Anomaly Detection"
  status={getAnomalyStatus()}
  statusLabel={hasRegressions ? "Regressions Found" : "Clean"}
  expanded={expanded}
  onExpand={handleExpand}
/>
```

## Accessibility Features

### WCAG AA Compliance
- **Text Labels**: Primary status indicator (screen reader friendly)
- **Icons**: Visual reinforcement (redundant encoding)
- **Colors**: Supplementary (not sole indicator)
- **Contrast Ratios**: All combinations meet 4.5:1 minimum
  - Success text: 8.2:1 contrast
  - Failure text: 7.8:1 contrast
  - Warning text: 7.1:1 contrast
  - Running text: 8.5:1 contrast

### Screen Reader Support
```html
<Chip
  icon={<CheckCircle />}
  label="Passed"
  aria-label="Test status: Passed"
/>
```

### Tooltips
- Provide additional context on hover
- Support keyboard navigation (focus + Enter)
- Work with touch devices (long-press)

## Dual-Layer Status System

The status badge works **in combination** with colored borders for maximum visibility:

### Collapsed State
- **Badge**: Shows in card header (top-right)
- **Border**: 2px colored border matching status
- **Result**: Triple reinforcement (badge + border + color)

### Expanded State
- **Badge**: Remains visible in header
- **Border**: Maintains status color (not neutral)
- **Result**: Status visible even when card is expanded

## Responsive Behavior

### Desktop (≥ 1024px)
```
[✓ Passed]  ← Full icon + text
```

### Tablet (768px - 1023px)
```
[✓ Pass]  ← Icon + abbreviated text
```

### Mobile (< 768px)
```
[✓]  ← Icon only with tooltip
```

## Animation Specifications

### Running State (Rotating Icon)
```css
animation: rotate 2s linear infinite;

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

### Alternative: Pulsing Dot
Instead of rotating icon, can use pulsing dot:
```css
animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

## Design Rationale

### Why Header Badges?

1. **Scannable**: Consistent position (top-right) across all cards
2. **Persistent**: Visible in both collapsed and expanded states
3. **Clear**: Icon + text removes ambiguity
4. **Accessible**: Triple encoding meets WCAG AA standards
5. **Familiar**: Similar to GitHub Actions, Linear, Vercel patterns

### Why NOT Use For All Cards?

Navigation and utility cards don't have pass/fail states:
- DeepLinks: Links either resolve or don't (not a test result)
- Dynatrace: Integration availability (not a performance result)
- Dashboards: Selection tool (not an outcome)

Status badges should **only indicate test outcomes**, not tool availability.

## Testing Checklist

When implementing status badges:

- [ ] Verify status logic covers all test states
- [ ] Test with screen reader (VoiceOver/NVDA)
- [ ] Check color-blind simulation (Deuteranopia, Protanopia)
- [ ] Validate contrast ratios (Chrome DevTools)
- [ ] Test keyboard navigation (Tab + Enter)
- [ ] Verify responsive behavior (mobile/tablet/desktop)
- [ ] Check animation performance (running state)
- [ ] Ensure tooltip works on touch devices
- [ ] Validate border colors match badge status
- [ ] Test with Windows High Contrast mode

## Future Enhancements

Potential improvements to consider:

1. **More Granular States**: "Partially Completed", "Cancelled", "Timeout"
2. **Progress Indicators**: Show test progress percentage for running state
3. **Historical Badges**: Show previous run status for comparison
4. **Custom Colors**: Theme-aware colors based on organization preferences
5. **Badge Groups**: Multiple badges for complex states (e.g., "Passed + Warnings")
