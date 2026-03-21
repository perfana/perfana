# Clickable Trends Chart - User Guide

## Feature Overview

The Trends chart in the Anomaly Detection table now supports interactive data point selection. Click any point on the trend line to view detailed metrics for that specific test run.

## Visual Guide

### Marker Legend

The chart uses different colors, shapes, and sizes to indicate the status of each data point:

#### Colors
- **🟠 Orange**: Selected test run (clicked by user)
- **🟣 Purple**: Current test run (the test run being analyzed on this page)
- **🔴 Red**: Regression detected
- **🔵 Blue**: No regression (normal)

#### Shapes
- **⭐ Star**: Selected test run
- **💎 Diamond**: Current test run
- **❌ X**: Regression point
- **⚫ Circle**: Normal point

#### Sizes
- **Large (14px)**: Selected or current test run
- **Standard (10px)**: Other test runs

## How to Use

### Step 1: View the Trends Chart
1. Navigate to a test run's anomaly detection page
2. Expand a metric row to see the trends chart
3. The current test run is highlighted with a **purple diamond** marker

### Step 2: Select a Test Run
1. Click any data point on the trends chart
2. The selected point changes to an **orange star** marker
3. The "Current Test Run Details" section below updates to show the selected test run's data
4. The header changes to display: "Selected Test Run: {testRunId}"

### Step 3: View Selected Test Run Details
The "Current Test Run Chart" section now displays:
- Metric values over time for the **selected** test run
- Threshold boundaries for that test run
- Statistical analysis specific to that test run

### Step 4: Reset to Current Test Run
1. Click the **"Reset to Current"** button in the header
2. The chart returns to showing the current test run
3. The header reverts to "Current Test Run Details"
4. The purple diamond marker remains on the current test run

## Example Scenarios

### Scenario 1: Investigating a Regression Point
```
Problem: You see a red X marker indicating a regression
Action: Click the red X point
Result: View detailed metrics for that regression to understand what went wrong
```

### Scenario 2: Comparing Historical Performance
```
Problem: You want to compare current performance with a previous test run
Action: Click the historical point (blue circle)
Result: See side-by-side comparison of thresholds and metrics
Action: Click "Reset to Current" to return
```

### Scenario 3: Analyzing Multiple Metrics
```
Problem: You need to check several metrics across the same test run
Action: In each metric row, click the same test run point
Result: Each metric independently shows data for that test run
Note: Selections are independent per metric row
```

## Visual States

### Initial State
```
Trends Chart:
[Blue Circle] [Blue Circle] [Purple Diamond] [Blue Circle] [Red X]
                            ↑ Current Test Run

Header: "Current Test Run Details"
Reset Button: Hidden
```

### After Clicking a Point
```
Trends Chart:
[Blue Circle] [Orange Star] [Purple Diamond] [Blue Circle] [Red X]
              ↑ Selected                    ↑ Current

Header: "Selected Test Run: test-run-abc-123"
Reset Button: Visible "Reset to Current"
```

### After Clicking Current Test Run
```
Trends Chart:
[Blue Circle] [Blue Circle] [Purple Diamond] [Blue Circle] [Red X]
                            ↑ Current (also selected)

Header: "Current Test Run Details"
Reset Button: Hidden (already showing current)
```

## Tips and Best Practices

### 1. Multiple Metric Analysis
When analyzing multiple metrics:
- Expand several metric rows
- Click the same test run point in each chart
- Compare how different metrics behaved during that test run

### 2. Identifying Patterns
Look for patterns across the timeline:
- Purple diamond: Your baseline (current test)
- Red X markers: Identify when regressions occurred
- Blue circles: Normal historical performance

### 3. Quick Reset
The "Reset to Current" button provides quick navigation back to the current test run without needing to find and click the purple diamond.

### 4. Threshold Comparison
Notice how threshold boundaries (green dashed lines) may vary between test runs based on their configuration at the time of execution.

## Keyboard Navigation

- **Tab**: Navigate to the "Reset to Current" button
- **Enter/Space**: Activate the reset button
- Mouse click required for selecting points on the chart (Plotly limitation)

## Accessibility Features

- **Color + Shape + Size**: Multiple visual indicators ensure visibility even with color blindness
- **Clear Labels**: Header text clearly indicates which test run is displayed
- **Persistent Highlight**: Selected point remains highlighted until another is clicked or reset
- **Independent Selection**: Each metric row maintains its own selection state

## Troubleshooting

### Issue: Clicking doesn't work
**Solution**: Ensure you're clicking directly on a data point (circle, X, diamond, or star marker)

### Issue: Chart doesn't update
**Solution**: Check that the test run has data available - if CurrentTestRunChart shows "no data", the selected test run may not have metrics

### Issue: Reset button doesn't appear
**Solution**: The button only appears when a different test run (not the current one) is selected

### Issue: Selection disappears
**Solution**: Selection clears when:
- You navigate to a different page
- You collapse and re-expand the metric row
- This is expected behavior

## Technical Notes

### Data Point Information
Hover over any point to see:
- Test Run ID
- Timestamp
- Metric value
- Conclusion (regression/no-regression)
- Version (if available)
- Annotations (if available)

### Threshold Visualization
The green shaded area shows the valid threshold range:
- Varies per test run based on configuration
- Dynamic boundaries (not static)
- Includes percentage, IQR, and absolute thresholds

### Performance
- Selecting a test run is instant (no API calls)
- All test run data is already loaded in the trends chart
- The CurrentTestRunChart component fetches detailed data on-demand
