# Template Selector Feature for Report Generation

## Overview

Added a template selection interface to the report generator that allows users to:
1. Browse available templates
2. Load a template as a starting point
3. Edit the template sections before generating
4. Start from scratch without a template

## Problem

Previously, when generating a report from a test run, the dialog would:
- Auto-load the first/default template automatically
- Hide the template selector
- Give users limited control over template selection

Users had no visibility into what templates were available and couldn't easily choose between templates or start fresh.

## Solution

Added an interactive template selector view that shows:
- A "Start from Scratch" option for building custom reports
- A list of all available templates
- Template metadata (name, section count, default badge)
- Visual feedback with icons and hover states

## User Flow

### 1. Opening the Report Generator

When a user clicks "Generate Report" on a test run:

1. **Template Selector View Opens** (new default)
   - Shows "Choose a Starting Point" heading
   - Displays two options:
     - **Start from Scratch** - Build custom report from empty canvas
     - **Available Templates** - List of templates for this system/environment/workload

### 2. Selecting a Template

User can click on any template to:
1. Load the template's sections into the report builder
2. View the sections in the layout panel
3. Edit, add, or remove sections as needed
4. Generate the report with modified configuration

**Template Card Shows:**
- Template name
- "Default" badge (if applicable)
- Section count (e.g., "5 sections")
- Star icon for default template, assignment icon for others

### 3. Starting from Scratch

User can click "Start from Scratch" to:
1. Open empty report builder
2. Add sections manually from available sections list
3. Build completely custom report
4. Optionally save as new template

### 4. Going Back

If a template is loaded, user sees:
- Info banner showing "Based on Template: {name}"
- "Back to Templates" button to return to selector
- Can switch between templates without closing dialog

## Changes Made

### 1. Updated Template Loading Logic

**File**: `apps/web/components/reports/report-generation/GenerateReportDialog.tsx`

**Before:**
```typescript
// Auto-loaded first/default template
if (summaries.length > 0) {
  const defaultTemplate = summaries.find((t) => t.is_default) || summaries[0];
  const detail = await getTemplate(defaultTemplate.id);
  setSelectedTemplate(detail);
  setSections(detail.sections || []);
  setShowTemplateSelector(false); // Hidden by default
}
```

**After:**
```typescript
// Don't auto-load - let user choose
setTemplates(summaries);
setShowTemplateSelector(true); // Visible by default
```

### 2. Added Template Selection Handlers

```typescript
// Load template when selected
const handleLoadTemplate = async (templateId: string) => {
  const detail = await getTemplate(templateId);
  setSelectedTemplate(detail);
  setSections(detail.sections || []);
  setShowTemplateSelector(false);
};

// Start from scratch (no template)
const handleStartFromScratch = () => {
  setSelectedTemplate(null);
  setSections([]);
  setShowTemplateSelector(false);
};
```

### 3. Added Template Selector UI

Added new view that displays when `showTemplateSelector` is true:

**Components:**
- **Start from Scratch Card**
  - Primary action for custom reports
  - Large clickable card with description icon
  - Hover effect with border highlight

- **Template List**
  - Shows all available templates
  - Each template as clickable card
  - Visual distinction for default template (star icon)
  - Section count displayed
  - Hover effects

- **Empty State**
  - Info alert when no templates available
  - Encourages starting from scratch

### 4. Updated Action Buttons

- Hide "Generate Report" button when template selector is visible
- Only show generate button after user has made selection
- Prevents generating empty reports accidentally

### 5. Added Icons

Added `StarIcon` import for default template indicator.

## UI Design

### Template Selector Layout

```
┌─────────────────────────────────────────────────────┐
│ Generate Report                                      │
├─────────────────────────────────────────────────────┤
│ Choose a Starting Point                             │
│ Select a template or start from scratch             │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ [Icon] Start from Scratch                    │   │
│ │        Build custom report from empty canvas │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ Available Templates (3)                             │
│                                                     │
│ ┌─────────────────────────────────────────────┐   │
│ │ [★] Executive Summary Report [Default]       │   │
│ │     8 sections                                │   │
│ └─────────────────────────────────────────────┘   │
│ ┌─────────────────────────────────────────────┐   │
│ │ [📋] Performance Analysis                     │   │
│ │     5 sections                                │   │
│ └─────────────────────────────────────────────┘   │
│ ┌─────────────────────────────────────────────┐   │
│ │ [📋] Quick Overview                          │   │
│ │     3 sections                                │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                      [Cancel]        │
└─────────────────────────────────────────────────────┘
```

### Report Builder Layout (After Selection)

```
┌─────────────────────────────────────────────────────┐
│ Generate Report                                      │
├─────────────────────────────────────────────────────┤
│ ℹ️ Based on Template: "Executive Summary"          │
│    [Back to Templates]                              │
│                                                     │
│ ┌──────────────┬────────────────────────────────┐  │
│ │ Available    │ Report Layout      [5 sections]│  │
│ │ Sections     │                                 │  │
│ │              │ [Section cards here...]         │  │
│ │ [Cards...]   │                                 │  │
│ └──────────────┴────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│                   [Cancel] [Generate Report]         │
└─────────────────────────────────────────────────────┘
```

## Benefits

✅ **Better Discovery** - Users can see all available templates
✅ **More Control** - Users choose starting point explicitly
✅ **Template Awareness** - Shows which template is being used
✅ **Flexibility** - Easy to switch between templates or start fresh
✅ **Visual Feedback** - Clear icons and badges for template status
✅ **Empty State Handling** - Graceful when no templates exist

## Testing

### Test Template Selection

1. Navigate to a test run
2. Click "Generate Report"
3. Verify template selector shows
4. Verify "Start from Scratch" option appears
5. Verify available templates are listed
6. Click on a template
7. Verify sections load
8. Verify "Back to Templates" button appears
9. Click "Back to Templates"
10. Verify template selector shows again

### Test Start from Scratch

1. Open report generator
2. Click "Start from Scratch"
3. Verify empty report builder opens
4. Add sections manually
5. Verify report can be generated
6. Verify no template info banner shows

### Test Default Template Indicator

1. Open report generator
2. Find template marked as default
3. Verify it has star icon
4. Verify "Default" chip badge
5. Non-default templates should have assignment icon

### Test Empty State

1. Create system/environment/workload with no templates
2. Open report generator
3. Verify info alert shows
4. Verify message encourages starting from scratch
5. Verify "Start from Scratch" still works

## Backwards Compatibility

✅ **Existing Templates** - All existing templates work unchanged
✅ **API Compatibility** - No backend changes required
✅ **Template Builder Mode** - Not affected (template-builder mode bypasses selector)

## Future Enhancements

1. **Template Preview** - Show template structure before loading
2. **Template Search** - Filter templates by name or section types
3. **Template Favorites** - Pin frequently used templates
4. **Recent Templates** - Show recently used templates first
5. **Template Descriptions** - Show full description in selector
6. **Template Tags** - Filter by tags or categories
