# Reporting Templates Tab Implementation

## Overview

Added a new "Reporting Templates" tab to the System Under Test configuration page that allows users to create, manage, and configure reporting templates.

## What Was Implemented

### 1. Backend (Already Existed)
- Database table: `report_templates` ✓
- Entity: `ReportTemplate` ✓
- Controller: `ReportTemplateController` with full CRUD operations ✓
- Service: `ReportTemplateService` ✓
- API endpoints at `/api/report-templates/*` ✓

### 2. Frontend Hook (`useReportingTemplateManagement.ts`)
Location: `apps/web/app/systems/[id]/config/hooks/useReportingTemplateManagement.ts`

Features:
- Template CRUD operations (create, read, update, delete)
- Template duplication
- Set default template
- Search and filter functionality
- Loading states management

### 3. Template Table Component (`TemplateTable.tsx`)
Location: `apps/web/app/systems/[id]/config/components/TemplateTable.tsx`

Features:
- Display templates in a table format
- Search filtering
- Shows template name, description, section count, section types
- Action buttons: Edit, Delete, Duplicate, Set as Default
- Default template badge with star icon

### 4. Reporting Templates Section (`ReportingTemplatesSection.tsx`)
Location: `apps/web/app/systems/[id]/config/components/ReportingTemplatesSection.tsx`

Features:
- Section header with system/environment/workload context
- Search bar for filtering templates
- Create template button
- Template table display
- Duplicate template dialog
- Loading and empty states

### 5. Template Management Dialog (`TemplateManagementDialog.tsx`)
Location: `apps/web/app/systems/[id]/config/components/TemplateManagementDialog.tsx`

Features:
- Create and edit template forms
- Template name and description fields
- Set as default toggle
- Loads existing template data when editing
- Note: Section configuration is done via the report generator on test run pages

### 6. System Config Page Updates
Location: `apps/web/app/systems/[id]/config/page.tsx`

Changes:
- Added new "Reporting Templates" tab (8th tab)
- Integrated `useReportingTemplateManagement` hook
- Added `ReportingTemplatesSection` component to tab 7
- Added `TemplateManagementDialog` for create/edit operations
- Added delete confirmation dialog
- Auto-loads templates when tab becomes active
- Clears templates when environment changes

## API Endpoints Used

### List Templates
```
GET /api/report-templates
Query params: system_id, test_environment, workload, search, sortBy, sortOrder
```

### Get Template
```
GET /api/report-templates/:templateId
```

### Create Template
```
POST /api/report-templates
Body: { name, description, system_id, test_environment, workload, sections, styling, is_default }
```

### Update Template
```
PATCH /api/report-templates/:templateId
Body: { name, description, sections, styling, is_default }
```

### Delete Template
```
DELETE /api/report-templates/:templateId
```

### Duplicate Template
```
POST /api/report-templates/:templateId/duplicate
Body: { name }
```

### Set Default Template
```
PUT /api/report-templates/:templateId/set-default
```

## How It Works

1. **Navigate to System Config**: Go to Systems → Select a system → Config tab
2. **Select Environment/Workload**: Choose the target environment and workload
3. **Open Reporting Templates Tab**: Click on the "Reporting Templates" tab (last tab)
4. **Create Template**: Click "Create Template" button
   - Enter template name and description
   - Optionally set as default
   - Note: Sections are configured later via report generator on test runs
5. **Manage Templates**:
   - **Edit**: Click edit icon to modify template metadata
   - **Delete**: Click delete icon and confirm
   - **Duplicate**: Click copy icon, enter new name
   - **Set as Default**: Click star icon (only for non-default templates)
6. **Search**: Use search bar to filter templates by name, description, or creator

## Template Scoping

Templates are scoped by:
- `system_id`: The system under test
- `test_environment`: The environment (e.g., "test", "production")
- `workload`: The workload type (e.g., "load", "stress")

This ensures templates are specific to their context.

## Future Enhancements

1. **Section Configuration**: Allow users to configure sections directly in the system config page
2. **Template Preview**: Show a preview of what the report will look like
3. **Template Tags**: Add tagging system for better organization
4. **Template Sharing**: Share templates across systems or teams
5. **Template Import/Export**: Export templates as JSON for backup or sharing
6. **Batch Operations**: Select and delete/duplicate multiple templates at once

## Files Created/Modified

### Created:
1. `apps/web/app/systems/[id]/config/hooks/useReportingTemplateManagement.ts`
2. `apps/web/app/systems/[id]/config/components/TemplateTable.tsx`
3. `apps/web/app/systems/[id]/config/components/ReportingTemplatesSection.tsx`
4. `apps/web/app/systems/[id]/config/components/TemplateManagementDialog.tsx`

### Modified:
1. `apps/web/app/systems/[id]/config/hooks/index.ts` - Added export for new hook
2. `apps/web/app/systems/[id]/config/page.tsx` - Added new tab and integrated components

## Testing Recommendations

1. **Create Template**: Verify template creation with valid data
2. **Edit Template**: Verify template updates persist correctly
3. **Delete Template**: Verify template is removed from database
4. **Duplicate Template**: Verify new template is created with copied data
5. **Set Default**: Verify only one template can be default per scope
6. **Search Filter**: Verify search works for name, description, and creator
7. **Environment Switch**: Verify templates reload when switching environment/workload
8. **Empty State**: Verify appropriate message shows when no templates exist
9. **Loading State**: Verify loading spinner shows during API calls
10. **Error Handling**: Verify error messages display correctly for failed operations

## Notes

- The backend API and database table already existed, so only frontend components were needed
- Templates can be created with empty sections array initially
- Section configuration is done through the report generator interface on test run pages
- The "save as template" feature in the report generator will populate the sections
- Templates inherit authentication from the global KeycloakEnhancedAuthGuard
