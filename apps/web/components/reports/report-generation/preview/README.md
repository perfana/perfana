# Report Section Preview Feature

This directory contains preview renderers for report sections, allowing users to preview how sections will appear in the final report and add comments based on what they see.

## Overview

The preview feature provides:
- **Visual Preview**: Shows how the section will be rendered in the final report
- **Comment Functionality**: Users can add comments about the section
- **Mock Data**: Demonstrates section appearance with realistic sample data
- **Responsive Design**: Full-screen modal for optimal viewing

## Architecture

### Core Components

1. **SectionPreviewModal** (`../SectionPreviewModal.tsx`)
   - Generic modal container for all section previews
   - Handles comment text box and save functionality
   - Full-screen display with app bar and actions
   - Reusable across all section types

2. **Section-Specific Preview Renderers** (e.g., `ApdexSectionPreview.tsx`)
   - Renders the actual preview content
   - Uses mock/sample data to demonstrate appearance
   - Respects configuration options from the section config
   - Follows report styling guidelines

### How It Works

```typescript
// 1. User clicks "Preview Section" button in section config
// 2. Modal opens with preview content and comment box
// 3. Preview renderer shows section with current config
// 4. User can add/edit comments
// 5. Comments are saved to section config on save
```

## Usage

### For End Users

1. Configure a report section (e.g., Apdex)
2. Click the "Preview Section" button
3. Review the preview with sample data
4. Add comments in the text box (max 5000 characters)
5. Click "Save Comment" to save notes
6. Comments are stored with the section configuration

### For Developers

#### Adding Preview to an Existing Section

**Step 1: Create Preview Renderer**

Create a new file in this directory (e.g., `SloSectionPreview.tsx`):

```typescript
'use client';

import React from 'react';
import { Box, Typography, Alert } from '@mui/material';
import { SloConfig } from '../SectionConfigs';

interface SloSectionPreviewProps {
  testRunId?: string;
  config: SloConfig;
}

export default function SloSectionPreview({ testRunId, config }: SloSectionPreviewProps) {
  // Use mock data to demonstrate the section
  const mockData = {
    // ... sample SLO data
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Service Level Objectives
      </Typography>

      {/* Render preview based on config */}
      {config.showSummaryTable && (
        // ... render summary table
      )}

      {/* Show configuration details */}
      <Alert severity="info" sx={{ mt: 3 }}>
        <Typography variant="body2">
          <strong>Preview Note:</strong> Using sample data for test run {testRunId || '[Test Run ID]'}
        </Typography>
      </Alert>
    </Box>
  );
}
```

**Step 2: Update Section Config Interface**

Add `comment` field to the config interface in `SectionConfigs.tsx`:

```typescript
export interface SloConfig {
  maxItems?: number;
  showDetails?: boolean;
  // ... other fields
  comment?: string; // Add this
}
```

**Step 3: Import Preview Component**

In `SectionConfigs.tsx`, add dynamic import:

```typescript
const SloSectionPreview = dynamic(() => import('./preview/SloSectionPreview'), { ssr: false });
```

**Step 4: Update Config Form Props**

Add `testRunId` to form props:

```typescript
interface SloConfigFormProps {
  config: SloConfig;
  onChange: (config: SloConfig) => void;
  testRunId?: string; // Add this
}
```

**Step 5: Add Preview Button and Modal**

In the config form component:

```typescript
export function SloConfigForm({ config, onChange, testRunId }: SloConfigFormProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Existing config controls */}

        {/* Preview Button */}
        <Button
          variant="outlined"
          startIcon={<VisibilityIcon />}
          onClick={() => setPreviewOpen(true)}
          sx={{
            mt: 1,
            textTransform: 'none',
            fontWeight: 600,
            borderColor: '#1976d2',
            color: '#1976d2',
          }}
        >
          Preview Section
        </Button>
      </Box>

      {/* Preview Modal */}
      <SectionPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        sectionTitle="Service Level Objectives"
        sectionType="SLO"
        testRunId={testRunId}
        initialComment={config.comment}
        onSaveComment={(comment) => onChange({ ...config, comment })}
      >
        <SloSectionPreview testRunId={testRunId} config={config} />
      </SectionPreviewModal>
    </>
  );
}
```

**Step 6: Pass testRunId in GenerateReportDialog**

Update the switch case in `GenerateReportDialog.tsx`:

```typescript
case 'slo':
  return <SloConfigForm config={sectionConfig} onChange={onConfigChange} testRunId={testRunId} />;
```

## Preview Design Guidelines

When creating preview renderers:

### 1. Use Mock Data
- Create realistic sample data that demonstrates all features
- Show typical values users would see in production
- Include edge cases if relevant (empty states, errors, etc.)

### 2. Respect Configuration
- Always check and apply all config options
- Show/hide elements based on config toggles
- Apply thresholds, filters, and other settings

### 3. Match Report Styling
- Use same colors, fonts, and layouts as final report
- Follow Material-UI design system
- Maintain consistency with other report sections

### 4. Include Preview Note
- Always add an alert explaining it's a preview
- Mention that real data will be used in final report
- Include test run ID if available

### 5. Loading States
- Show loading indicator initially
- Simulate realistic loading time (500-1000ms)
- Handle errors gracefully

### 6. Responsive Design
- Preview should work on all screen sizes
- Use Material-UI's responsive utilities
- Test on mobile, tablet, and desktop

## Example: Apdex Preview

The Apdex section preview demonstrates best practices:

- **Configuration Respect**: Shows/hides summary and transaction tables based on config
- **Threshold Application**: Uses error/warning thresholds for status chips
- **Rich Mock Data**: Includes 6 sample transactions with varied scores
- **Visual Hierarchy**: Clear sections with proper typography
- **Color Coding**: Status-based colors (green/yellow/red)
- **Distribution Charts**: Placeholder for chart rendering
- **Configuration Info**: Shows current threshold settings
- **Preview Note**: Explains mock data usage

## Benefits

### For Users
- **Visual Confirmation**: See exactly how section will appear
- **Documentation**: Add context-specific comments
- **Configuration Validation**: Verify settings produce desired output
- **Collaboration**: Share observations with team

### For Development
- **Modularity**: Each section preview is independent
- **Reusability**: SectionPreviewModal works for all sections
- **Maintainability**: Easy to update preview logic
- **Testing**: Preview can be tested in isolation

## Future Enhancements

Potential improvements:

1. **Real Data Preview**: Fetch actual test run data for preview
2. **Interactive Elements**: Allow filtering/sorting in preview
3. **Export Preview**: Download preview as image
4. **Side-by-Side Compare**: Show before/after for config changes
5. **Preview History**: View previous preview snapshots
6. **Collaborative Comments**: Share comments with team members
7. **Preview Templates**: Save preview configurations for reuse

## Technical Notes

- Preview components use dynamic imports to reduce bundle size
- All previews are client-side only (`'use client'`)
- Mock data is embedded to avoid API dependencies
- Accompanying text is stored on the section (`section.text`), not in the section config and not as a separate entity.
- Preview modal uses Material-UI Dialog with fullScreen mode
- Styling matches report generation styling system

## Support

For issues or questions:
- Check existing preview implementations (ApdexSectionPreview)
- Review SectionPreviewModal props and usage
- Ensure config interface includes `comment?: string`
- Verify testRunId is passed through component tree
