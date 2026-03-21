# Report Section Preview - Visual Guide

## What Users Will See

### 1. Report Builder View

```
┌─────────────────────────────────────────────────────────────┐
│ Generate Report                                          [X] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Available Sections        │  Report Layout (3/20)         │
│  ┌──────────────────┐     │  ┌─────────────────────────┐  │
│  │ 📋 Header        │     │  │ 📊 Apdex Score      [v] │  │
│  │ Text heading     │     │  │ Application Perf Index   │  │
│  └──────────────────┘     │  │                          │  │
│                            │  │ [Expanded Config Panel]  │  │
│  ┌──────────────────┐     │  │                          │  │
│  │ 📊 Apdex  ◀─────┼────┼─┤ ☑ Show Summary          │  │
│  │ Performance idx  │     │  │ ☑ Show Transaction Level │  │
│  └──────────────────┘     │  │ ☐ Include Dist. Chart    │  │
│                            │  │                          │  │
│  ┌──────────────────┐     │  │ Error Threshold: 0.50    │  │
│  │ 📈 Response Times│     │  │ ━━━━━●━━━━━━━━━━━━━━━   │  │
│  │ Transaction perf │     │  │                          │  │
│  └──────────────────┘     │  │ Warning Threshold: 0.85  │  │
│                            │  │ ━━━━━━━━━━━━━━━━●━━━━   │  │
│  ... (7 more sections)     │  │                          │  │
│                            │  │ ┌────────────────────┐   │  │
│                            │  │ │ 👁 Preview Section │   │  │
│                            │  │ └────────────────────┘   │  │
│                            │  └─────────────────────────┘  │
│                            │                               │
│                            │  ┌─────────────────────────┐  │
│                            │  │ 📝 Text Block       [^] │  │
│                            │  │ Free-form content        │  │
│                            │  └─────────────────────────┘  │
│                            │                               │
├─────────────────────────────────────────────────────────────┤
│                         [Cancel]  [Generate Report]         │
└─────────────────────────────────────────────────────────────┘
```

### 2. Preview Modal - Full Screen

```
┌─────────────────────────────────────────────────────────────────┐
│ 👁 Preview: Apdex Score          [Apdex]                   [X] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                                                           │ │
│  │  Application Performance Index (Apdex)                   │ │
│  │  ═══════════════════════════════════                     │ │
│  │                                                           │ │
│  │  Overall Performance Summary                             │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │                                                       │ │ │
│  │  │  Overall Apdex Score    Total Transactions   Avg RT  │ │ │
│  │  │      0.870                    145            245 ms   │ │ │
│  │  │      [Good]                                           │ │ │
│  │  │                                                       │ │ │
│  │  │  Request Distribution                                 │ │ │
│  │  │  Satisfied (67.6%)  ████████████████░░░              │ │ │
│  │  │  98 requests                                          │ │ │
│  │  │                                                       │ │ │
│  │  │  Tolerating (24.1%) ████████░░░░░░░░░░░              │ │ │
│  │  │  35 requests                                          │ │ │
│  │  │                                                       │ │ │
│  │  │  Frustrated (8.3%)  ███░░░░░░░░░░░░░░░░              │ │ │
│  │  │  12 requests                                          │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  │                                                           │ │
│  │  ℹ Configuration: Error Threshold: 0.50 | Warning: 0.85 │ │
│  │                                                           │ │
│  │  Transaction-Level Performance                           │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │ Transaction Name  │ Apdex │ Status  │  RT   │ Reqs  │ │ │
│  │  ├─────────────────────────────────────────────────────┤ │ │
│  │  │ Homepage Load     │ 0.950 │ [Good]  │ 120ms │ 1,523 │ │ │
│  │  │ Login Request     │ 0.890 │ [Good]  │ 234ms │   856 │ │ │
│  │  │ Search API        │ 0.780 │[Warn]  │ 445ms │ 2,341 │ │ │
│  │  │ Checkout Process  │ 0.650 │[Warn]  │ 678ms │   423 │ │ │
│  │  │ Dashboard Render  │ 0.920 │ [Good]  │ 156ms │ 1,876 │ │ │
│  │  │ Profile Update    │ 0.430 │[Critical]│892ms│   234 │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  │                                                           │ │
│  │  ℹ Preview Note: This preview uses sample data.         │ │
│  │    The actual report will use real data from test run    │ │
│  │    abc-123-xyz.                                          │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                                                           │ │
│  │  💬 Section Comments                                     │ │
│  │  ─────────────────────────────────────────────────────   │ │
│  │                                                           │ │
│  │  Add comments or observations based on what you see...   │ │
│  │                                                           │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │ The Profile Update transaction shows critical       │ │ │
│  │  │ performance issues with an Apdex of 0.43. This       │ │ │
│  │  │ should be investigated before production.            │ │ │
│  │  │                                                       │ │ │
│  │  │ Consider lowering error threshold to 0.45 to catch   │ │ │
│  │  │ more issues early.                                   │ │ │
│  │  │                                                       │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  │  139 / 2000 characters                                   │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  [⚠ Unsaved changes]              [Cancel]  [Save Comment]     │
└─────────────────────────────────────────────────────────────────┘
```

## UI Elements Breakdown

### App Bar (Top)
- **Left**: 👁 Visibility icon + "Preview: [Section Title]"
- **Center**: [Section Type] badge (blue chip)
- **Right**: ✕ Close button

**Colors**:
- Background: Blue gradient (#1976d2 → #1565c0)
- Text: White
- Badge: Semi-transparent white

### Preview Content Area
**Styling**:
- Background: Light gray (#f5f5f5)
- Padding: 24px
- Scrollable content

#### Preview Paper
- White background
- Elevation: 2
- Border radius: 8px
- Padding: 24px
- Margin bottom: 24px

### Comment Section
**Paper Styling**:
- White background
- Elevation: 2
- Border radius: 8px
- Padding: 24px

**Header**:
- 💬 Comment icon (blue)
- "Section Comments" title (h6)
- Divider line

**Text Box**:
- Multiline (6 rows)
- Character counter below
- Max 2000 characters
- Blue outline on hover
- Placeholder text

### Action Bar (Bottom)
**Paper Styling**:
- White background
- Elevation: 4
- Border top: 1px solid rgba(0,0,0,0.12)
- Padding: 16px

**Left Side**:
- Unsaved changes chip (yellow warning, only when changes exist)

**Right Side**:
- Cancel button (outlined)
- Save Comment button (contained, blue gradient)
  - Disabled when no changes

## Color Palette

### Primary Colors
- **Blue Primary**: #1976d2
- **Blue Dark**: #1565c0
- **Blue Darker**: #0d47a1

### Status Colors
- **Good/Success**: #4caf50 (green)
- **Warning**: #ff9800 (orange)
- **Critical/Error**: #f44336 (red)

### Apdex Score Colors
```typescript
function getApdexColor(score: number): string {
  if (score >= 0.94) return '#4caf50';      // Excellent (green)
  if (score >= 0.85) return '#8bc34a';      // Good (light green)
  if (score >= 0.7) return '#ffc107';       // Fair (amber)
  if (score >= 0.5) return '#ff9800';       // Poor (orange)
  return '#f44336';                         // Unacceptable (red)
}
```

### Background Colors
- **Modal Background**: #f5f5f5
- **Paper**: #ffffff
- **Info Alert**: rgba(25, 118, 210, 0.05)
- **Info Alert Border**: rgba(25, 118, 210, 0.2)

## Typography

### Headers
- **Section Title**: h5, 600 weight, blue color
- **Subsection**: h6, 600 weight
- **Caption**: small, gray secondary

### Data Display
- **Scores**: h4, 700 weight, monospace font
- **Metrics**: body2, monospace font
- **Labels**: body2, regular weight

## Interactive Elements

### Preview Button
```
┌────────────────────┐
│ 👁 Preview Section │  ← Click to open modal
└────────────────────┘
```
- Outlined style
- Blue border (#1976d2)
- Blue text
- Hover: Light blue background
- Icon: Visibility (eye icon)

### Save Button States
```
[Save Comment]           ← Default (enabled, has changes)
[Save Comment]           ← Disabled (no changes)
[Save Comment] ⟳         ← Saving (spinner)
[Save Comment] ✓         ← Saved (checkmark, brief)
```

## Responsive Behavior

### Desktop (>1200px)
- Full-screen modal
- Wide preview area
- Side-by-side sections visible

### Tablet (768px - 1200px)
- Full-screen modal
- Stacked sections
- Adequate spacing maintained

### Mobile (<768px)
- Full-screen modal (auto-applied)
- Single column layout
- Touch-friendly targets (48px minimum)
- Reduced padding

## Animation & Transitions

### Modal Open
- Slide up from bottom
- Duration: 300ms
- Easing: ease-in-out

### Modal Close
- Fade out
- Duration: 200ms
- Easing: ease-in

### Button Hover
- Background color transition
- Duration: 150ms
- Easing: ease

### Loading State
- Circular progress spinner
- Indeterminate animation
- Center-aligned

## Accessibility

### Keyboard Navigation
- **Escape**: Close modal
- **Tab**: Navigate through elements
- **Enter**: Activate focused button
- **Ctrl/Cmd + S**: Save comment (potential)

### Screen Reader Support
- `aria-label` on close button
- Semantic HTML structure
- Focus management on modal open
- Focus trap within modal
- Return focus on close

### ARIA Attributes
```html
<Dialog
  aria-labelledby="preview-title"
  aria-describedby="preview-content"
  role="dialog"
  aria-modal="true"
>
```

## User Interactions

### Opening Preview
1. User configures section settings
2. Clicks "Preview Section" button
3. Modal slides up (300ms animation)
4. Preview content renders
5. Focus moves to modal

### Editing Comment
1. User clicks in text box
2. Types comment (live character count)
3. "Unsaved changes" chip appears
4. Save button becomes enabled

### Saving Comment
1. User clicks "Save Comment"
2. Button shows loading state (brief)
3. Comment saved to config
4. "Unsaved changes" chip disappears
5. Modal closes (200ms animation)
6. Focus returns to preview button

### Canceling
1. User clicks "Cancel" or X or presses Escape
2. Confirmation if unsaved changes (optional)
3. Modal closes
4. Changes discarded
5. Focus returns to preview button

## Error States

### Loading Error
```
┌─────────────────────────────────────────┐
│ ⚠ Error Loading Preview                │
│ Unable to render section preview.       │
│ [Retry]                                 │
└─────────────────────────────────────────┘
```

### Save Error
```
┌─────────────────────────────────────────┐
│ ⚠ Error Saving Comment                 │
│ Your comment could not be saved. Try    │
│ again or copy it before closing.        │
│ [Retry] [Copy to Clipboard]            │
└─────────────────────────────────────────┘
```

## Performance Indicators

### Fast Preview
- < 100ms: Instant (no spinner)
- 100-500ms: Brief spinner
- > 500ms: Progress indicator

### Character Count Colors
- < 1800 chars: Gray (normal)
- 1800-1950 chars: Orange (warning)
- 1950-2000 chars: Red (approaching limit)
- 2000 chars: Red, bold (at limit)

## Context-Aware Features

### With Test Run ID
```
ℹ Preview Note: Using sample data for test run
  test-run-123-abc
```

### Without Test Run ID (Template Mode)
```
ℹ Preview Note: Using sample data. This is a
  template preview.
```

### With Existing Comment
- Text box pre-filled
- No "Unsaved changes" initially
- Save button disabled until edited

### Without Comment
- Empty text box with placeholder
- No unsaved changes indicator
- Save button enabled when text entered

---

This visual guide helps developers and designers understand exactly how the preview feature appears to users and ensures consistent implementation across all section types.
