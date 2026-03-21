# Organization Switcher Implementation Guide

## Overview
Secure multi-organization support with client-side organization selection and server-side validation.

## Security Architecture

### 🔒 Key Security Principle
**NEVER trust organization IDs from the client.** Always validate against database membership.

```
User selects org in UI → Header sent → Backend validates → Access granted/denied
                                              ↓
                                    SELECT FROM organization_members
                                    WHERE user_id = ? AND organization_id = ?
```

## Backend Implementation (✅ Complete)

### 1. Database Schema
Organizations managed in Perfana database:
- **`organization_members`** - User memberships with roles
  - `user_id` (Keycloak sub)
  - `organization_id` (UUID)
  - `roles` (JSONB: `['org-admin', 'org-member', 'org-viewer']`)
  - `joined_at` (timestamp for ordering)

### 2. Middleware Security Layer
**File**: `apps/api/src/middleware/db-session.middleware.ts`

**Flow**:
1. Load all organizations user is a member of:
   ```sql
   SELECT organization_id FROM organization_members
   WHERE user_id = $1
   ORDER BY joined_at DESC
   ```

2. Check for user-selected organization via header:
   ```typescript
   const selectedOrgId = req.headers['x-organization-id'];
   ```

3. **SECURITY VALIDATION** - Verify membership:
   ```typescript
   const isMember = context.organizations.includes(selectedOrgId);
   if (!isMember) {
     throw new Error('Access denied: You are not a member of the selected organization');
   }
   ```

4. Set as current organization:
   ```typescript
   context.organizations = [selectedOrgId, ...others];
   ```

### 3. User Context API
**Endpoint**: `GET /api/users/me/context`

**Response**:
```json
{
  "userId": "3b273a60-b0df-400f-a787-b6a3d13a6dd3",
  "email": "user@example.com",
  "currentOrganizationId": "uuid-1234",
  "currentTeamId": null,
  "organizations": [
    {
      "organizationId": "uuid-1234",
      "name": "Acme Corp",
      "roles": ["org-admin"]
    },
    {
      "organizationId": "uuid-5678",
      "name": "Beta Inc",
      "roles": ["org-member"]
    }
  ],
  "teams": [...],
  "requiresOrganizationSelection": true  // true if >1 org
}
```

### 4. UserContext Decorator
**File**: `apps/api/src/common/decorators/user-context.decorator.ts`

**Priority Order**:
1. ✅ **sessionContext** (database-loaded with validation)
2. API key organization
3. JWT organizations (future)

## Frontend Implementation (TODO)

### 1. Organization Switcher Component

```typescript
// apps/web/components/layout/OrganizationSwitcher.tsx
'use client';

import { useEffect, useState } from 'react';
import { Select, MenuItem } from '@mui/material';

interface Organization {
  organizationId: string;
  name: string;
  roles: string[];
}

export function OrganizationSwitcher() {
  const [userContext, setUserContext] = useState<any>(null);
  const [selectedOrg, setSelectedOrg] = useState<string>('');
  const [showDialog, setShowDialog] = useState(false);

  useEffect(() => {
    loadUserContext();
  }, []);

  const loadUserContext = async () => {
    const response = await fetch('/api/users/me/context', {
      headers: {
        'Authorization': `Bearer ${getToken()}`,
      },
    });

    const context = await response.json();
    setUserContext(context);

    // Show dialog if multiple orgs and none selected
    if (context.requiresOrganizationSelection) {
      setShowDialog(true);
    } else if (context.currentOrganizationId) {
      setSelectedOrg(context.currentOrganizationId);
    }
  };

  const handleOrgChange = (orgId: string) => {
    setSelectedOrg(orgId);
    // Store in localStorage for persistence
    localStorage.setItem('selectedOrganizationId', orgId);
    // Reload to apply new context
    window.location.reload();
  };

  return (
    <>
      {/* Organization Selector in Header */}
      <Select
        value={selectedOrg}
        onChange={(e) => handleOrgChange(e.target.value)}
        displayEmpty
      >
        {userContext?.organizations.map((org: Organization) => (
          <MenuItem key={org.organizationId} value={org.organizationId}>
            {org.name}
            {org.roles.includes('org-admin') && ' (Admin)'}
          </MenuItem>
        ))}
      </Select>

      {/* Modal Dialog for Initial Selection */}
      <Dialog open={showDialog} onClose={() => {}}>
        <DialogTitle>Select Organization</DialogTitle>
        <DialogContent>
          <Typography>
            You belong to multiple organizations. Please select one to continue:
          </Typography>
          <List>
            {userContext?.organizations.map((org: Organization) => (
              <ListItem
                key={org.organizationId}
                button
                onClick={() => {
                  handleOrgChange(org.organizationId);
                  setShowDialog(false);
                }}
              >
                <ListItemText
                  primary={org.name}
                  secondary={org.roles.join(', ')}
                />
              </ListItem>
            ))}
          </List>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

### 2. API Client with Organization Header

```typescript
// apps/web/lib/api/client.ts

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add auth token
  const token = keycloakAuth.getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Add selected organization ID
  // SECURITY: Backend validates this against user's actual memberships
  const selectedOrgId = localStorage.getItem('selectedOrganizationId');
  if (selectedOrgId) {
    headers['X-Organization-Id'] = selectedOrgId;
  }

  return headers;
}

// Use in all API calls
export async function fetchWithAuth(url: string, options?: RequestInit) {
  return fetch(url, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options?.headers,
    },
  });
}
```

### 3. Add to Layout

```typescript
// apps/web/app/layout.tsx

import { OrganizationSwitcher } from '@/components/layout/OrganizationSwitcher';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <Header>
          <OrganizationSwitcher />
        </Header>
        {children}
      </body>
    </html>
  );
}
```

## Security Features

### ✅ Implemented

1. **Database Validation**
   - Every request validates organization ID against `organization_members` table
   - User cannot access organizations they're not a member of

2. **Ordered by Membership**
   - Organizations ordered by `joined_at DESC` (most recent first)
   - Deterministic default selection

3. **Audit Logging**
   - Failed organization access attempts logged with warning
   - Security violations can be monitored

4. **Error Handling**
   - Clear error message: "Access denied: You are not a member of the selected organization"
   - 403 Forbidden response

### 🔒 Additional Recommendations

1. **Rate Limiting**
   - Limit organization switch attempts to prevent enumeration attacks

2. **Session Persistence**
   - Consider storing selected organization in server-side session (Redis)
   - More secure than localStorage alone

3. **Audit Trail**
   - Log all organization switches in audit logs
   - Track access patterns per organization

## Testing

### Backend Tests

```typescript
describe('Organization Selection Security', () => {
  it('should allow access to user\'s own organization', async () => {
    const response = await request(app)
      .get('/api/grafana-instances')
      .set('Authorization', `Bearer ${validToken}`)
      .set('X-Organization-Id', 'user-org-uuid');

    expect(response.status).toBe(200);
  });

  it('should deny access to other organization', async () => {
    const response = await request(app)
      .get('/api/grafana-instances')
      .set('Authorization', `Bearer ${validToken}`)
      .set('X-Organization-Id', 'other-org-uuid');  // Not a member!

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('not a member');
  });

  it('should use first org as default if no header provided', async () => {
    const response = await request(app)
      .get('/api/users/me/context')
      .set('Authorization', `Bearer ${validToken}`);

    expect(response.body.currentOrganizationId).toBe('most-recent-org-uuid');
  });
});
```

### Frontend Tests

```typescript
describe('OrganizationSwitcher', () => {
  it('should show dialog when user has multiple orgs', async () => {
    mockUserContext({
      organizations: [org1, org2],
      requiresOrganizationSelection: true
    });

    render(<OrganizationSwitcher />);
    expect(screen.getByText('Select Organization')).toBeInTheDocument();
  });

  it('should include organization header in API calls', async () => {
    localStorage.setItem('selectedOrganizationId', 'org-uuid');

    await fetchWithAuth('/api/test');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Organization-Id': 'org-uuid'
        })
      })
    );
  });
});
```

## Migration Checklist

- [x] Add `ORDER BY joined_at DESC` to organization query
- [x] Add organization validation in middleware
- [x] Add `X-Organization-Id` header handling
- [x] Update UserCtx decorator to prioritize sessionContext
- [x] Create `GET /api/users/me/context` endpoint
- [ ] Create OrganizationSwitcher component
- [ ] Add organization header to all API calls
- [ ] Add organization selector to main layout
- [ ] Test with multiple organizations
- [ ] Add audit logging for organization switches
- [ ] Update user documentation

## API Changes

### New Endpoints
- `GET /api/users/me/context` - Get user's organization context

### New Headers
- `X-Organization-Id` - Selected organization (validated by backend)

### Existing Behavior
- All existing endpoints continue to work
- Default to first organization if no header provided
- Backend validates all organization access

## Notes

- Organizations are **never** in Keycloak JWT - always loaded from database
- Backend **always** validates organization membership - frontend cannot bypass
- Users see only their own organizations' resources
- Tampering with headers/localStorage is **harmless** - backend rejects invalid orgs
- Support for API keys can be added similarly (scope to specific organization)
