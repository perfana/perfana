# Multi-Organization API Key Creation Solution

## Problem Statement

When a user belongs to multiple organizations, the API key creation flow had no way for the user to select which organization the API key should belong to. It would always default to the first organization.

## Root Causes Identified

### 1. **Backend Service Not Saving Organization** (`api-keys.service.ts`)
- Parameter was `_organizationId` (unused prefix)
- Comment said "unused until Phase 4" despite Phase 4 being complete
- The `create()` call was missing: `organization_id`, `created_by`, `updated_by`

### 2. **DatabaseSessionMiddleware Column Mismatch** (`db-session.middleware.ts`)
- Query used `ORDER BY joined_at DESC`
- Actual column name is `created_at`

### 3. **Frontend Missing Organization Selection**
- `CreateApiKeyRequest` interface didn't include `organizationId`
- `createApiKeySchema` didn't validate `organizationId`
- `ApiKeyFormDialog` had no organization selector
- No way for multi-org users to choose which organization

## Solution Implemented

### Backend Fixes

#### 1. API Keys Service (`api-keys.service.ts`)

**Changed:**
```typescript
// Before: Parameter was unused
async createApiKey(
  createDto: CreateApiKeyDto,
  userId: string,
  roles: string[],
  _organizationId: string,  // ← Unused
)

// After: Parameter is now used
async createApiKey(
  createDto: CreateApiKeyDto,
  userId: string,
  roles: string[],
  organizationId: string,  // ← Active
)
```

**Database Insert:**
```typescript
// Before: Missing ownership fields
const apiKey = await this.apiKeyRepository.create({
  apiKey: hashedToken,
  description: createDto.description,
  validUntil: validUntil,
  roles: apiKeyRoles,
} as ApiKey);

// After: Includes ownership tracking
const apiKey = await this.apiKeyRepository.create({
  apiKey: hashedToken,
  description: createDto.description,
  validUntil: validUntil,
  roles: apiKeyRoles,
  organization_id: organizationId,      // ✅ Added
  created_by: userId,                   // ✅ Added
  updated_by: userId,                   // ✅ Added
} as ApiKey);
```

#### 2. DatabaseSessionMiddleware (`db-session.middleware.ts`)

```typescript
// Before: Wrong column name
'SELECT organization_id FROM organization_members WHERE user_id = $1 ORDER BY joined_at DESC'

// After: Correct column name
'SELECT organization_id FROM organization_members WHERE user_id = $1 ORDER BY created_at DESC'
```

### Frontend Implementation

#### 1. Updated Validation Schema (`lib/validations.ts`)

```typescript
export const createApiKeySchema = z.object({
  description: z.string().min(1, 'Description is required').max(255, 'Description must be less than 255 characters'),
  ttl: z.string().min(1, 'Time to live is required'),
  organizationId: z.string().uuid('Invalid organization ID').optional(), // ✅ Added
})
```

#### 2. Updated API Client Interface (`lib/api-keys.ts`)

```typescript
export interface CreateApiKeyRequest {
  description: string;
  ttl: string;
  organizationId?: string; // ✅ Added - Organization to create the API key for
}
```

#### 3. Enhanced `useApiKeys` Hook (`app/settings/hooks/useApiKeys.ts`)

**Imports Organization Context:**
```typescript
import { useOrganization } from '@/lib/contexts/organization-context';
```

**Uses Current Organization:**
```typescript
// Get organization context for multi-org support
const { currentOrganizationId, organizations } = useOrganization();

const form = useForm<CreateApiKeyFormData>({
  resolver: zodResolver(createApiKeySchema),
  defaultValues: {
    description: '',
    ttl: '30d',
    organizationId: currentOrganizationId || undefined, // ✅ Default to current
  },
});

// Update organizationId when current organization changes
useEffect(() => {
  if (currentOrganizationId) {
    form.setValue('organizationId', currentOrganizationId);
  }
}, [currentOrganizationId, form]);
```

**Returns Organizations:**
```typescript
return {
  // ... other fields
  organizations, // ✅ Expose organizations for the dialog
};
```

#### 4. Updated Settings Page (`app/settings/page.tsx`)

```typescript
<ApiKeyFormDialog
  open={apiKeys.createDialogOpen}
  form={apiKeys.form}
  organizations={apiKeys.organizations} // ✅ Pass organizations
  onClose={apiKeys.closeDialogs}
  onSubmit={apiKeys.handleCreateKey}
/>
```

#### 5. Enhanced API Key Form Dialog (`app/settings/components/ApiKeyFormDialog.tsx`)

**Updated Props:**
```typescript
interface ApiKeyFormDialogProps {
  open: boolean;
  form: UseFormReturn<CreateApiKeyFormData>;
  organizations: Organization[]; // ✅ Added
  onClose: () => void;
  onSubmit: (data: CreateApiKeyFormData) => Promise<void>;
}
```

**Organization Selector Logic:**
```typescript
// Show organization selector only if user belongs to multiple organizations
const showOrganizationSelector = organizations.length > 1;
```

**UI Implementation:**
```typescript
{/* Organization Selector - shown only for multi-org users */}
{showOrganizationSelector && (
  <FormControl fullWidth variant="outlined" error={!!form.formState.errors.organizationId}>
    <InputLabel>Organization</InputLabel>
    <Select
      {...form.register('organizationId')}
      value={form.watch('organizationId') || ''}
      onChange={(e) => form.setValue('organizationId', e.target.value || undefined)}
      label="Organization"
    >
      {organizations.map((org) => (
        <MenuItem key={org.id} value={org.id}>
          {org.name}
        </MenuItem>
      ))}
    </Select>
  </FormControl>
)}

{/* Info message for single-org users */}
{!showOrganizationSelector && organizations.length === 1 && (
  <Alert severity="info" sx={{ mt: 2 }}>
    This API key will be created for organization: <strong>{organizations[0].name}</strong>
  </Alert>
)}
```

## User Experience Flow

### Single Organization User

1. User opens "Create API Key" dialog
2. Form shows: Description, TTL
3. Info message displays: "This API key will be created for organization: **Acme Corp**"
4. User submits → API key created for their organization

### Multi-Organization User

1. User opens "Create API Key" dialog
2. Form shows: Description, TTL, **Organization Dropdown**
3. Organization dropdown pre-selected with **current organization** from context
4. User can select different organization if desired
5. User submits → API key created for **selected organization**

## Backend Logic Flow

```typescript
// Controller (api-keys.controller.ts)
async create(@Body() createDto: CreateApiKeyDto, @UserCtx() ctx: UserContext) {
  // Priority 1: organizationId from request body (user's selection) ✅
  let organizationId = createDto.organizationId || ctx.organizationId;

  // Priority 2: Fall back to user's first organization
  if (!organizationId) {
    const userOrgs = await this.apiKeysService.getUserOrganizations(ctx.userId);
    organizationId = userOrgs[0];
  }

  // Create with selected organization
  const result = await this.apiKeysService.createApiKey(
    createDto,
    ctx.userId,
    ctx.roles,
    organizationId // ✅ Passes through to service
  );
}
```

## Database Schema

API keys now properly track ownership:

```sql
api_keys:
  - id (uuid)
  - api_key (varchar)
  - description (varchar)
  - roles (text[])
  - valid_until (timestamp)
  - organization_id (uuid) ✅ Links to organizations table
  - created_by (varchar) ✅ User ID (Keycloak sub)
  - updated_by (varchar) ✅ User ID (Keycloak sub)
  - created_at (timestamp)
  - updated_at (timestamp)
  - last_used (timestamp)
```

## Testing Checklist

### Backend Tests
- [x] API key created with `organization_id` set
- [x] API key created with `created_by` set (Keycloak sub)
- [x] API key created with `updated_by` set (Keycloak sub)
- [x] Controller respects `organizationId` from request body
- [x] Controller falls back to `ctx.organizationId` if not provided
- [x] Controller queries database for first org as final fallback

### Frontend Tests
- [ ] Single-org user sees info message (not dropdown)
- [ ] Multi-org user sees organization dropdown
- [ ] Dropdown pre-selects current organization
- [ ] User can change organization selection
- [ ] Form validation requires valid UUID for organizationId
- [ ] API request includes selected organizationId

### Integration Tests
- [ ] Create API key as single-org user → organizationId set correctly
- [ ] Create API key as multi-org user → organizationId matches selection
- [ ] Switch current organization → form updates to new default
- [ ] API keys filtered by organization membership
- [ ] Test runs created with API key inherit organization

## Related Files Modified

### Backend
1. `apps/api/src/modules/api-keys/api-keys.service.ts`
2. `apps/api/src/modules/api-keys/dto/create-api-key.dto.ts` (already had organizationId)
3. `apps/api/src/middleware/db-session.middleware.ts`

### Frontend
4. `apps/web/lib/validations.ts`
5. `apps/web/lib/api-keys.ts`
6. `apps/web/app/settings/hooks/useApiKeys.ts`
7. `apps/web/app/settings/page.tsx`
8. `apps/web/app/settings/components/ApiKeyFormDialog.tsx`

### Database
- API keys table already has ownership columns (from Phase 4 migration)
- organization_members table tracks user memberships

## Benefits

1. **Multi-Tenant Isolation**: API keys properly scoped to organizations
2. **User Choice**: Multi-org users can select target organization
3. **Clear Ownership**: `created_by` and `updated_by` track who manages keys
4. **Security**: API keys can't be used to access resources outside their organization
5. **Audit Trail**: Complete tracking of API key creation and usage
6. **UX Excellence**: Intuitive interface that adapts to user's organization count

## Future Enhancements

1. **Organization Filtering**: Show only organizations where user has `org-admin` role
2. **Role-Based Creation**: Allow users to specify roles for the API key within the form
3. **API Key Management**: Edit organization assignment for existing keys (with proper authorization)
4. **Bulk Operations**: Create API keys for multiple organizations at once
5. **Usage Analytics**: Track API key usage by organization
