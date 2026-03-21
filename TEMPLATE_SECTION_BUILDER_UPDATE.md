# Template Section Builder Integration

## Overview

Updated the Template Management Dialog to allow users to configure template sections directly from the Systems config page using the report generator dialog in "template-builder" mode.

## Problem

Previously, the template creation dialog only showed an info message saying:
> "To configure sections for this template, use the report generator on a test run page."

This required users to:
1. Navigate to a test run
2. Use the report generator
3. Save as template

This workflow was confusing and inefficient for creating standalone templates.

## Solution

Integrated the `GenerateReportDialog` component directly into the `TemplateManagementDialog` with a new "template-builder" mode that:
- Works without requiring a test run ID
- Shows "Configure Template Sections" title instead of "Generate Report"
- Has a "Save Configuration" button instead of "Generate Report"
- Returns sections and styling to the parent component via callback
- Hides the "save as template" toggle (not applicable in template mode)

## Changes Made

### 1. Updated `GenerateReportDialog` Component

**File**: `apps/web/components/reports/report-generation/GenerateReportDialog.tsx`

**Changes**:
- Added optional props:
  - `mode?: 'report' | 'template-builder'` - Determines dialog behavior
  - `testRunId?: string` - Now optional (not needed in template-builder mode)
  - `initialSections?: ReportSectionConfig[]` - Pre-populate sections when editing
  - `initialStyling?: ReportStyling` - Pre-populate styling when editing
  - `onTemplateBuilt?: (sections, styling) => void` - Callback for template mode

- Added `isTemplateBuilder` computed value to control mode-specific behavior

- Updated template loading logic:
  - Skips template fetching in template-builder mode
  - Initializes sections from `initialSections` prop

- Updated `handleGenerate` function:
  - In template-builder mode: calls `onTemplateBuilt()` with sections and styling
  - In report mode: generates report as before

- Updated UI based on mode:
  - Dialog title: "Configure Template Sections" vs "Generate Report"
  - Hides template info banner in template-builder mode
  - Hides "save as template" toggle in template-builder mode
  - Button text: "Save Configuration" vs "Generate Report"
  - Status text: "Saving..." vs generation status

### 2. Updated `TemplateManagementDialog` Component

**File**: `apps/web/app/systems/[id]/config/components/TemplateManagementDialog.tsx`

**Changes**:
- Added import for `GenerateReportDialog`
- Added state: `showSectionBuilder` to control section builder dialog visibility
- Added handlers:
  - `handleOpenSectionBuilder()` - Opens the section builder dialog
  - `handleSectionBuilderClose()` - Closes the section builder dialog
  - `handleSectionsConfigured()` - Receives configured sections and styling

- Replaced info alert with interactive section configuration box:
  - Shows current section count
  - Lists configured section types as chips
  - Has "Configure Sections" / "Edit Sections" button

- Added `GenerateReportDialog` at end of component:
  - Opens in `template-builder` mode
  - Pre-populates with existing sections when editing
  - Saves configured sections back to template state

## User Flow

### Creating a New Template

1. Navigate to **Systems → [System] → Config → Reporting Templates**
2. Click **"Create Template"**
3. Enter template name and description
4. Click **"Configure Sections"** button
5. **Report generator dialog opens** with:
   - Title: "Configure Template Sections"
   - Empty section list (or pre-populated if editing)
   - Drag-and-drop section builder
6. Add desired sections (SLO, trends, regressions, etc.)
7. Configure each section (optional)
8. Click **"Save Configuration"**
9. Dialog closes and returns to template form
10. Template form shows: "X section(s) configured" with section type chips
11. Optionally set as default template
12. Click **"Create"** to save the template

### Editing an Existing Template

1. Click edit icon on a template
2. Template loads with existing sections
3. Click **"Edit Sections"** button
4. Report generator dialog opens with current sections
5. Modify sections as needed
6. Click **"Save Configuration"**
7. Updated sections saved to template
8. Click **"Update"** to save changes

## Benefits

✅ **Improved UX**: Configure sections directly where templates are created
✅ **No test run required**: Templates can be created independently
✅ **Visual feedback**: See configured sections before saving
✅ **Edit capability**: Easily modify existing template sections
✅ **Consistent UI**: Uses same report builder interface users already know
✅ **Type-safe**: Full TypeScript support with proper typing

## Testing

### Create Template with Sections
1. Go to Systems → Config → Reporting Templates
2. Click "Create Template"
3. Enter name: "Test Template"
4. Click "Configure Sections"
5. Add sections: Header, SLO, Trends
6. Click "Save Configuration"
7. Verify section count shows "3 section(s) configured"
8. Click "Create"
9. Verify template appears in table with correct section count

### Edit Template Sections
1. Click edit icon on existing template
2. Verify sections are pre-loaded
3. Click "Edit Sections"
4. Verify existing sections appear in builder
5. Add or remove sections
6. Click "Save Configuration"
7. Verify updated section count
8. Click "Update"
9. Verify changes persist

### Delete Section in Template
1. Edit template
2. Open section builder
3. Delete all sections
4. Save configuration
5. Verify "No sections configured yet" message
6. Can still save template with empty sections

## API Compatibility

No backend changes required:
- Template entity already supports `sections` JSONB field
- Create/update endpoints already accept sections array
- Existing API endpoints work as-is

## Notes

- Templates can be saved with zero sections (empty array)
- Section validation happens on report generation, not template creation
- Styling configuration is optional and not exposed in template builder UI yet
- Future enhancement: Add styling editor to template builder mode
