# RBAC Phase 6: Organization & Team Management UI

## Executive Summary

Implement the frontend UI layer for organization and team management, completing the RBAC feature with full user-facing controls for multi-tenant access management.

**Timeline**: 6-8 weeks for complete UI implementation
**Dependencies**: Phase 5 (RLS, Audit Logging) must be complete
**Impact**: Enables end-users to manage organizations, teams, and member permissions without admin intervention

---

## Current State Analysis

### ✅ What Exists (Backend Complete)

**Entities & Database**:
- ✅ Organizations table with teams relationship
- ✅ Teams table with organization FK
- ✅ OrganizationMember table with roles (JSONB)
- ✅ TeamMember table with roles (JSONB)
- ✅ Proper indexes and unique constraints
- ✅ CASCADE deletion for referential integrity

**API Endpoints**:
- ✅ Organizations CRUD: `GET/POST/PUT/DELETE /organizations`
- ✅ Teams CRUD: `GET/POST/PUT/DELETE /teams`
- ✅ Organization members service with full CRUD
- ✅ Team members service with full CRUD
- ✅ Authorization checks (global admin, org admin, team admin)
- ✅ Swagger documentation

**Authorization**:
- ✅ Role hierarchy (System → Organization → Team)
- ✅ Permission checks in all services
- ✅ @UserCtx() decorator for context extraction
- ✅ AuthorizationService for centralized auth logic

### ❌ What's Missing (UI Layer)

**Frontend Pages**:
- ❌ Organizations list page
- ❌ Organization details/settings page
- ❌ Organization members management UI
- ❌ Teams list page
- ❌ Team details/settings page
- ❌ Team members management UI
- ❌ Role assignment interfaces
- ❌ Member invitation workflow

**API Clients**:
- ❌ Organizations API client (`lib/api/organizations.ts`)
- ❌ Teams API client (`lib/api/teams.ts`)
- ❌ Organization members API client
- ❌ Team members API client

**Components**:
- ❌ Organization selector/switcher
- ❌ Member role picker
- ❌ Member invitation modal
- ❌ Organization card/list components
- ❌ Team card/list components

---

## Implementation Strategy

### Phase 6.1: Foundation & API Clients (Week 1-2)

#### 6.1.1 Create API Client Layer

**File**: `apps/web/lib/api/organizations.ts`
```typescript
import keycloakAuth from '@/lib/keycloak-auth';

export interface Organization {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  teams?: Team[];
}

export interface CreateOrganizationDto {
  name: string;
  description?: string;
}

export interface UpdateOrganizationDto {
  name?: string;
  description?: string;
}

class OrganizationsAPI {
  private getAuthHeaders() {
    const token = keycloakAuth.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async list(): Promise<Organization[]> {
    const response = await fetch(`/api/organizations`, {
      headers: { ...this.getAuthHeaders() },
    });
    if (!response.ok) throw new Error('Failed to fetch organizations');
    return response.json();
  }

  async get(id: string): Promise<Organization> {
    const response = await fetch(`/api/organizations/${id}`, {
      headers: { ...this.getAuthHeaders() },
    });
    if (!response.ok) throw new Error('Failed to fetch organization');
    return response.json();
  }

  async create(dto: CreateOrganizationDto): Promise<Organization> {
    const response = await fetch(`/api/organizations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
      },
      body: JSON.stringify(dto),
    });
    if (!response.ok) throw new Error('Failed to create organization');
    return response.json();
  }

  async update(id: string, dto: UpdateOrganizationDto): Promise<Organization> {
    const response = await fetch(`/api/organizations/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
      },
      body: JSON.stringify(dto),
    });
    if (!response.ok) throw new Error('Failed to update organization');
    return response.json();
  }

  async delete(id: string): Promise<void> {
    const response = await fetch(`/api/organizations/${id}`, {
      method: 'DELETE',
      headers: { ...this.getAuthHeaders() },
    });
    if (!response.ok) throw new Error('Failed to delete organization');
  }
}

export const organizationsAPI = new OrganizationsAPI();
```

**File**: `apps/web/lib/api/teams.ts`
```typescript
// Similar structure for teams API
```

**File**: `apps/web/lib/api/organization-members.ts`
```typescript
export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  roles: string[];
  created_at: string;
  updated_at: string;
  organization?: Organization;
}

export interface AddOrganizationMemberDto {
  organizationId: string;
  userId: string;
  roles: string[];
}

class OrganizationMembersAPI {
  async listByOrganization(orgId: string): Promise<OrganizationMember[]>
  async add(dto: AddOrganizationMemberDto): Promise<OrganizationMember>
  async updateRoles(id: string, roles: string[]): Promise<OrganizationMember>
  async remove(id: string): Promise<void>
}
```

**File**: `apps/web/lib/api/team-members.ts`
```typescript
// Similar structure for team members API
```

#### 6.1.2 Create Role Constants

**File**: `apps/web/lib/constants/roles.ts`
```typescript
export enum SystemRole {
  GLOBAL_ADMIN = 'perfana-admin',
  ADMIN = 'admin',
}

export enum OrganizationRole {
  ADMIN = 'org-admin',
  MEMBER = 'org-member',
  VIEWER = 'org-viewer',
}

export enum TeamRole {
  ADMIN = 'team-admin',
  MEMBER = 'team-member',
  VIEWER = 'team-viewer',
}

export const ORG_ROLE_LABELS = {
  [OrganizationRole.ADMIN]: 'Admin',
  [OrganizationRole.MEMBER]: 'Member',
  [OrganizationRole.VIEWER]: 'Viewer',
} as const;

export const ORG_ROLE_DESCRIPTIONS = {
  [OrganizationRole.ADMIN]: 'Full control over organization settings and members',
  [OrganizationRole.MEMBER]: 'Can view and use organization resources',
  [OrganizationRole.VIEWER]: 'Read-only access to organization resources',
} as const;

export const TEAM_ROLE_LABELS = {
  [TeamRole.ADMIN]: 'Admin',
  [TeamRole.MEMBER]: 'Member',
  [TeamRole.VIEWER]: 'Viewer',
} as const;

export const TEAM_ROLE_DESCRIPTIONS = {
  [TeamRole.ADMIN]: 'Full control over team settings and members',
  [TeamRole.MEMBER]: 'Can contribute to team resources',
  [TeamRole.VIEWER]: 'Read-only access to team resources',
} as const;
```

#### 6.1.3 Create React Query Hooks

**File**: `apps/web/lib/hooks/use-organizations.ts`
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { organizationsAPI } from '@/lib/api/organizations';

export function useOrganizations() {
  return useQuery({
    queryKey: ['organizations'],
    queryFn: () => organizationsAPI.list(),
  });
}

export function useOrganization(id: string) {
  return useQuery({
    queryKey: ['organizations', id],
    queryFn: () => organizationsAPI.get(id),
    enabled: !!id,
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: organizationsAPI.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
    },
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateOrganizationDto }) =>
      organizationsAPI.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      queryClient.invalidateQueries({ queryKey: ['organizations', id] });
    },
  });
}

export function useDeleteOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: organizationsAPI.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
    },
  });
}
```

**File**: `apps/web/lib/hooks/use-teams.ts`
```typescript
// Similar hooks for teams
```

**File**: `apps/web/lib/hooks/use-organization-members.ts`
```typescript
// Similar hooks for organization members
```

**Verification Checklist**:
- [ ] All API clients handle authentication headers
- [ ] All API clients handle errors consistently
- [ ] React Query hooks implement optimistic updates
- [ ] React Query cache invalidation is correct
- [ ] TypeScript types match backend DTOs

---

### Phase 6.2: Organizations Management UI (Week 3-4)

#### 6.2.1 Organizations List Page

**File**: `apps/web/app/settings/organizations/page.tsx`
```typescript
'use client';

import { useState } from 'react';
import { Box, Typography, Button, Grid, Card, CardContent, CardActions } from '@mui/material';
import { Add as AddIcon, Business as OrgIcon } from '@mui/icons-material';
import { useOrganizations } from '@/lib/hooks/use-organizations';
import { CreateOrganizationDialog } from '@/components/organizations/CreateOrganizationDialog';
import { OrganizationCard } from '@/components/organizations/OrganizationCard';

export default function OrganizationsPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const { data: organizations, isLoading, error } = useOrganizations();

  if (isLoading) return <LoadingSkeleton />;
  if (error) return <ErrorDisplay error={error} />;

  return (
    <Box sx={{ p: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 4 }}>
        <Box>
          <Typography variant="h4" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <OrgIcon /> Organizations
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Manage organizations and their members
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
        >
          Create Organization
        </Button>
      </Box>

      <Grid container spacing={3}>
        {organizations?.map((org) => (
          <Grid item xs={12} sm={6} md={4} key={org.id}>
            <OrganizationCard organization={org} />
          </Grid>
        ))}
      </Grid>

      {organizations?.length === 0 && (
        <EmptyState
          icon={<OrgIcon sx={{ fontSize: 80 }} />}
          title="No organizations yet"
          description="Create your first organization to get started"
          action={
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreateDialogOpen(true)}
            >
              Create Organization
            </Button>
          }
        />
      )}

      <CreateOrganizationDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />
    </Box>
  );
}
```

#### 6.2.2 Organization Card Component

**File**: `apps/web/components/organizations/OrganizationCard.tsx`
```typescript
'use client';

import { Card, CardContent, CardActions, Typography, Chip, IconButton, Box } from '@mui/material';
import { Settings as SettingsIcon, People as PeopleIcon, Group as TeamIcon } from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import { Organization } from '@/lib/api/organizations';

interface OrganizationCardProps {
  organization: Organization;
}

export function OrganizationCard({ organization }: OrganizationCardProps) {
  const router = useRouter();

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer',
        transition: 'all 0.2s',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: 4,
        },
      }}
      onClick={() => router.push(`/settings/organizations/${organization.id}`)}
    >
      <CardContent sx={{ flexGrow: 1 }}>
        <Typography variant="h6" gutterBottom>
          {organization.name}
        </Typography>
        {organization.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {organization.description}
          </Typography>
        )}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {organization.teams && organization.teams.length > 0 && (
            <Chip
              icon={<TeamIcon />}
              label={`${organization.teams.length} teams`}
              size="small"
              variant="outlined"
            />
          )}
        </Box>
      </CardContent>
      <CardActions sx={{ justifyContent: 'space-between', px: 2, pb: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Created {new Date(organization.created_at).toLocaleDateString()}
        </Typography>
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/settings/organizations/${organization.id}`);
          }}
        >
          <SettingsIcon fontSize="small" />
        </IconButton>
      </CardActions>
    </Card>
  );
}
```

#### 6.2.3 Create Organization Dialog

**File**: `apps/web/components/organizations/CreateOrganizationDialog.tsx`
```typescript
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Alert,
} from '@mui/material';
import { useCreateOrganization } from '@/lib/hooks/use-organizations';

interface CreateOrganizationDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreateOrganizationDialog({ open, onClose }: CreateOrganizationDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const createMutation = useCreateOrganization();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({ name, description });
      setName('');
      setDescription('');
      onClose();
    } catch (error) {
      // Error is handled by mutation
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Create Organization</DialogTitle>
        <DialogContent>
          {createMutation.error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {createMutation.error.message}
            </Alert>
          )}
          <TextField
            label="Organization Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            fullWidth
            autoFocus
            sx={{ mb: 2, mt: 1 }}
          />
          <TextField
            label="Description (Optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={3}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={!name || createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
```

#### 6.2.4 Organization Details Page

**File**: `apps/web/app/settings/organizations/[id]/page.tsx`
```typescript
'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Box,
  Typography,
  Button,
  Tabs,
  Tab,
  Card,
  CardContent,
  IconButton,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useOrganization, useDeleteOrganization } from '@/lib/hooks/use-organizations';
import { OrganizationSettingsTab } from '@/components/organizations/OrganizationSettingsTab';
import { OrganizationMembersTab } from '@/components/organizations/OrganizationMembersTab';
import { OrganizationTeamsTab } from '@/components/organizations/OrganizationTeamsTab';

export default function OrganizationDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.id as string;
  const [currentTab, setCurrentTab] = useState(0);

  const { data: organization, isLoading, error } = useOrganization(orgId);
  const deleteMutation = useDeleteOrganization();

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete this organization?')) {
      await deleteMutation.mutateAsync(orgId);
      router.push('/settings/organizations');
    }
  };

  if (isLoading) return <LoadingSkeleton />;
  if (error || !organization) return <ErrorDisplay error={error} />;

  return (
    <Box sx={{ p: 4 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton onClick={() => router.back()}>
            <BackIcon />
          </IconButton>
          <Box>
            <Typography variant="h4">{organization.name}</Typography>
            {organization.description && (
              <Typography variant="body2" color="text.secondary">
                {organization.description}
              </Typography>
            )}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button startIcon={<EditIcon />} variant="outlined">
            Edit
          </Button>
          <Button
            startIcon={<DeleteIcon />}
            variant="outlined"
            color="error"
            onClick={handleDelete}
          >
            Delete
          </Button>
        </Box>
      </Box>

      <Tabs value={currentTab} onChange={(_, v) => setCurrentTab(v)} sx={{ mb: 3 }}>
        <Tab label="Settings" />
        <Tab label="Members" />
        <Tab label="Teams" />
      </Tabs>

      {currentTab === 0 && <OrganizationSettingsTab organization={organization} />}
      {currentTab === 1 && <OrganizationMembersTab organizationId={orgId} />}
      {currentTab === 2 && <OrganizationTeamsTab organizationId={orgId} />}
    </Box>
  );
}
```

**Verification Checklist**:
- [ ] Organizations list page shows all accessible organizations
- [ ] Create organization dialog validates input
- [ ] Organization cards show team count and creation date
- [ ] Organization details page has settings/members/teams tabs
- [ ] Delete confirmation dialog prevents accidental deletion
- [ ] Navigation works correctly between pages

---

### Phase 6.3: Organization Members Management (Week 4-5)

#### 6.3.1 Organization Members Tab

**File**: `apps/web/components/organizations/OrganizationMembersTab.tsx`
```typescript
'use client';

import { useState } from 'react';
import {
  Box,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Menu,
  MenuItem,
} from '@mui/material';
import {
  PersonAdd as AddIcon,
  MoreVert as MoreIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useOrganizationMembers } from '@/lib/hooks/use-organization-members';
import { AddMemberDialog } from './AddMemberDialog';
import { EditMemberRolesDialog } from './EditMemberRolesDialog';
import { ORG_ROLE_LABELS } from '@/lib/constants/roles';

interface OrganizationMembersTabProps {
  organizationId: string;
}

export function OrganizationMembersTab({ organizationId }: OrganizationMembersTabProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editMember, setEditMember] = useState<OrganizationMember | null>(null);
  const { data: members, isLoading } = useOrganizationMembers(organizationId);

  if (isLoading) return <LoadingSkeleton />;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h6">Members ({members?.length || 0})</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setAddDialogOpen(true)}
        >
          Add Member
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>User ID</TableCell>
              <TableCell>Roles</TableCell>
              <TableCell>Joined</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {members?.map((member) => (
              <TableRow key={member.id}>
                <TableCell>{member.user_id}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {member.roles.map((role) => (
                      <Chip
                        key={role}
                        label={ORG_ROLE_LABELS[role] || role}
                        size="small"
                        color={role === 'org-admin' ? 'primary' : 'default'}
                      />
                    ))}
                  </Box>
                </TableCell>
                <TableCell>
                  {new Date(member.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell align="right">
                  <MemberActions
                    member={member}
                    onEdit={() => setEditMember(member)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <AddMemberDialog
        open={addDialogOpen}
        organizationId={organizationId}
        onClose={() => setAddDialogOpen(false)}
      />

      {editMember && (
        <EditMemberRolesDialog
          open={!!editMember}
          member={editMember}
          onClose={() => setEditMember(null)}
        />
      )}
    </Box>
  );
}
```

#### 6.3.2 Add Member Dialog

**File**: `apps/web/components/organizations/AddMemberDialog.tsx`
```typescript
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Box,
} from '@mui/material';
import { useAddOrganizationMember } from '@/lib/hooks/use-organization-members';
import { OrganizationRole, ORG_ROLE_LABELS } from '@/lib/constants/roles';

interface AddMemberDialogProps {
  open: boolean;
  organizationId: string;
  onClose: () => void;
}

export function AddMemberDialog({ open, organizationId, onClose }: AddMemberDialogProps) {
  const [userId, setUserId] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([OrganizationRole.MEMBER]);
  const addMutation = useAddOrganizationMember();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addMutation.mutateAsync({
        organizationId,
        userId,
        roles: selectedRoles,
      });
      setUserId('');
      setSelectedRoles([OrganizationRole.MEMBER]);
      onClose();
    } catch (error) {
      // Error handled by mutation
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Add Member</DialogTitle>
        <DialogContent>
          <TextField
            label="User ID (Keycloak sub)"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
            fullWidth
            autoFocus
            sx={{ mb: 2, mt: 1 }}
            helperText="Enter the Keycloak user ID (sub) or API key ID"
          />

          <FormControl fullWidth>
            <InputLabel>Roles</InputLabel>
            <Select
              multiple
              value={selectedRoles}
              onChange={(e) => setSelectedRoles(e.target.value as string[])}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {selected.map((value) => (
                    <Chip key={value} label={ORG_ROLE_LABELS[value]} size="small" />
                  ))}
                </Box>
              )}
            >
              {Object.values(OrganizationRole).map((role) => (
                <MenuItem key={role} value={role}>
                  {ORG_ROLE_LABELS[role]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={!userId || selectedRoles.length === 0 || addMutation.isPending}
          >
            {addMutation.isPending ? 'Adding...' : 'Add Member'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
```

#### 6.3.3 Edit Member Roles Dialog

**File**: `apps/web/components/organizations/EditMemberRolesDialog.tsx`
```typescript
// Similar structure to AddMemberDialog but for editing existing member roles
```

**Verification Checklist**:
- [ ] Members table shows user ID, roles, and join date
- [ ] Add member dialog validates user ID input
- [ ] Role selector allows multiple role selection
- [ ] Edit roles updates member roles correctly
- [ ] Remove member shows confirmation dialog
- [ ] Role chips display with appropriate colors

---

### Phase 6.4: Teams Management UI (Week 5-6)

#### 6.4.1 Teams List Page

**File**: `apps/web/app/settings/teams/page.tsx`
```typescript
// Similar structure to organizations page
// Shows teams across all accessible organizations
// Filter by organization dropdown
```

#### 6.4.2 Organization Teams Tab

**File**: `apps/web/components/organizations/OrganizationTeamsTab.tsx`
```typescript
'use client';

import { useState } from 'react';
import {
  Box,
  Button,
  Grid,
  Typography,
} from '@mui/material';
import { Add as AddIcon, Group as TeamIcon } from '@mui/icons-material';
import { useTeamsByOrganization } from '@/lib/hooks/use-teams';
import { CreateTeamDialog } from '@/components/teams/CreateTeamDialog';
import { TeamCard } from '@/components/teams/TeamCard';

interface OrganizationTeamsTabProps {
  organizationId: string;
}

export function OrganizationTeamsTab({ organizationId }: OrganizationTeamsTabProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const { data: teams, isLoading } = useTeamsByOrganization(organizationId);

  if (isLoading) return <LoadingSkeleton />;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h6">Teams ({teams?.length || 0})</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
        >
          Create Team
        </Button>
      </Box>

      <Grid container spacing={3}>
        {teams?.map((team) => (
          <Grid item xs={12} sm={6} md={4} key={team.id}>
            <TeamCard team={team} />
          </Grid>
        ))}
      </Grid>

      {teams?.length === 0 && (
        <EmptyState
          icon={<TeamIcon sx={{ fontSize: 60 }} />}
          title="No teams yet"
          description="Create your first team to organize members"
          action={
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreateDialogOpen(true)}
            >
              Create Team
            </Button>
          }
        />
      )}

      <CreateTeamDialog
        open={createDialogOpen}
        organizationId={organizationId}
        onClose={() => setCreateDialogOpen(false)}
      />
    </Box>
  );
}
```

#### 6.4.3 Team Details Page

**File**: `apps/web/app/settings/teams/[id]/page.tsx`
```typescript
// Similar structure to organization details page
// Tabs: Settings, Members
```

#### 6.4.4 Team Members Tab

**File**: `apps/web/components/teams/TeamMembersTab.tsx`
```typescript
// Similar to OrganizationMembersTab but for team members
// Uses team roles instead of organization roles
```

**Verification Checklist**:
- [ ] Teams list shows all teams in organization
- [ ] Create team dialog validates input
- [ ] Team cards show member count
- [ ] Team details page has settings/members tabs
- [ ] Team member management works correctly

---

### Phase 6.5: Organization Selector/Switcher (Week 6-7)

#### 6.5.1 Organization Context Provider

**File**: `apps/web/lib/contexts/organization-context.tsx`
```typescript
'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Organization } from '@/lib/api/organizations';
import { useOrganizations } from '@/lib/hooks/use-organizations';

interface OrganizationContextValue {
  currentOrganization: Organization | null;
  organizations: Organization[];
  switchOrganization: (orgId: string) => void;
  isLoading: boolean;
}

const OrganizationContext = createContext<OrganizationContextValue | undefined>(undefined);

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { data: organizations, isLoading } = useOrganizations();
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);

  // Load saved organization from localStorage
  useEffect(() => {
    const savedOrgId = localStorage.getItem('currentOrganizationId');
    if (savedOrgId && organizations?.find(o => o.id === savedOrgId)) {
      setCurrentOrgId(savedOrgId);
    } else if (organizations?.length > 0) {
      // Default to first organization
      setCurrentOrgId(organizations[0].id);
    }
  }, [organizations]);

  const currentOrganization = organizations?.find(o => o.id === currentOrgId) || null;

  const switchOrganization = (orgId: string) => {
    setCurrentOrgId(orgId);
    localStorage.setItem('currentOrganizationId', orgId);
  };

  return (
    <OrganizationContext.Provider
      value={{
        currentOrganization,
        organizations: organizations || [],
        switchOrganization,
        isLoading,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganizationContext() {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error('useOrganizationContext must be used within OrganizationProvider');
  }
  return context;
}
```

#### 6.5.2 Organization Switcher Component

**File**: `apps/web/components/layout/OrganizationSwitcher.tsx`
```typescript
'use client';

import {
  Box,
  Button,
  Menu,
  MenuItem,
  Typography,
  Divider,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  Business as OrgIcon,
  Check as CheckIcon,
  Settings as SettingsIcon,
  KeyboardArrowDown as ArrowDownIcon,
} from '@mui/icons-material';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOrganizationContext } from '@/lib/contexts/organization-context';

export function OrganizationSwitcher() {
  const router = useRouter();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const { currentOrganization, organizations, switchOrganization } = useOrganizationContext();

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSwitch = (orgId: string) => {
    switchOrganization(orgId);
    handleClose();
  };

  return (
    <>
      <Button
        variant="outlined"
        onClick={handleOpen}
        startIcon={<OrgIcon />}
        endIcon={<ArrowDownIcon />}
        sx={{ minWidth: 200 }}
      >
        <Box sx={{ textAlign: 'left', flex: 1 }}>
          <Typography variant="body2" noWrap>
            {currentOrganization?.name || 'Select Organization'}
          </Typography>
        </Box>
      </Button>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        PaperProps={{ sx: { minWidth: 250 } }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="overline" color="text.secondary">
            Organizations
          </Typography>
        </Box>
        {organizations.map((org) => (
          <MenuItem
            key={org.id}
            onClick={() => handleSwitch(org.id)}
            selected={org.id === currentOrganization?.id}
          >
            <ListItemIcon>
              {org.id === currentOrganization?.id && <CheckIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText>{org.name}</ListItemText>
          </MenuItem>
        ))}
        <Divider sx={{ my: 1 }} />
        <MenuItem
          onClick={() => {
            router.push('/settings/organizations');
            handleClose();
          }}
        >
          <ListItemIcon>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Manage Organizations</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
```

#### 6.5.3 Add to Navigation Bar

**File**: `apps/web/components/layout/Navbar.tsx`
```typescript
// Add OrganizationSwitcher to navbar
// Position: Between logo and main navigation
```

**Verification Checklist**:
- [ ] Organization context persists across page navigation
- [ ] Selected organization saved to localStorage
- [ ] Switcher shows current organization
- [ ] Switching organization updates context immediately
- [ ] Switcher accessible from all pages

---

### Phase 6.6: Enhanced Features (Week 7-8)

#### 6.6.1 Member Invitation Workflow

**Feature**: Instead of entering Keycloak user IDs manually, provide an invitation system

**File**: `apps/web/components/organizations/InviteMemberDialog.tsx`
```typescript
// Send email invitation with signup link
// Invitation tracks pending status
// Auto-adds user to organization when they sign up
```

**Backend Enhancement Needed**:
```typescript
// Create organization_invitations table
// Add POST /organizations/:id/invitations endpoint
// Add email sending service integration
```

#### 6.6.2 Role Permissions Matrix

**File**: `apps/web/components/organizations/RolePermissionsMatrix.tsx`
```typescript
// Visual matrix showing what each role can do
// Helps admins understand permission levels
// Display in organization/team settings
```

#### 6.6.3 Member Search & Filtering

**Enhancement**: Add search and filter to member lists
```typescript
// Search by user ID
// Filter by role
// Sort by join date
```

#### 6.6.4 Bulk Member Operations

**Enhancement**: Allow bulk member actions
```typescript
// Select multiple members
// Bulk add roles
// Bulk remove members
// Import from CSV
```

#### 6.6.5 Activity Log

**File**: `apps/web/components/organizations/ActivityLog.tsx`
```typescript
// Show recent changes to organization/team
// Member added/removed events
// Role changes
// Settings updates
// Uses audit_logs table from Phase 5
```

**Verification Checklist**:
- [ ] Invitation emails sent successfully
- [ ] Permissions matrix is accurate and clear
- [ ] Search and filtering work correctly
- [ ] Bulk operations handle errors gracefully
- [ ] Activity log shows recent events

---

## UI/UX Design Standards

### Design Principles

1. **Consistent with Existing UI**:
   - Use Material-UI components matching current design
   - Follow established color scheme and typography
   - Maintain consistent spacing and layout patterns

2. **Clear Visual Hierarchy**:
   - Primary actions (Create, Add) use contained buttons
   - Secondary actions (Edit, Settings) use outlined buttons
   - Destructive actions (Delete, Remove) use error color

3. **Responsive Design**:
   - Mobile-first approach with breakpoints at sm/md/lg
   - Cards stack on mobile, grid on desktop
   - Tables become scrollable on mobile

4. **Loading & Error States**:
   - Skeleton loaders for initial loading
   - Inline error messages for form validation
   - Toast notifications for success/error actions
   - Retry buttons for failed operations

5. **Accessibility**:
   - Proper ARIA labels on all interactive elements
   - Keyboard navigation support
   - Focus management in dialogs
   - Screen reader announcements for actions

### Color Scheme

**Organization-related UI**:
- Primary accent: Blue (`#1976d2`)
- Cards/backgrounds: White with subtle gray borders
- Hover states: Slight elevation with shadow

**Role Indicators**:
- Admin: Primary blue chip
- Member: Default gray chip
- Viewer: Light gray chip with dashed border

### Typography

- Page titles: `variant="h4"`
- Section headers: `variant="h6"`
- Card titles: `variant="h6"` or `variant="subtitle1"`
- Body text: `variant="body1"` or `variant="body2"`
- Helper text: `variant="caption"` with `color="text.secondary"`

---

## Testing Strategy

### Unit Tests

**Component Tests** (Jest + React Testing Library):
```typescript
describe('OrganizationCard', () => {
  it('should display organization name and description');
  it('should show team count chip when teams exist');
  it('should navigate to details page on click');
  it('should handle missing description gracefully');
});

describe('AddMemberDialog', () => {
  it('should validate required fields');
  it('should allow multiple role selection');
  it('should call API with correct payload');
  it('should handle API errors with user feedback');
  it('should reset form after successful submission');
});
```

**Hook Tests** (Jest + React Testing Library):
```typescript
describe('useOrganizations', () => {
  it('should fetch organizations on mount');
  it('should handle authentication errors');
  it('should retry on failure');
});

describe('useCreateOrganization', () => {
  it('should create organization and invalidate cache');
  it('should handle validation errors');
});
```

### Integration Tests

**API Client Tests**:
```typescript
describe('OrganizationsAPI', () => {
  it('should include auth headers in all requests');
  it('should handle 401 unauthorized responses');
  it('should handle 403 forbidden responses');
  it('should parse response data correctly');
});
```

### E2E Tests (Playwright)

**Critical User Flows**:
```typescript
test('Organization management flow', async ({ page }) => {
  // 1. Login as admin
  await page.goto('/login');
  await loginAsAdmin(page);

  // 2. Navigate to organizations
  await page.goto('/settings/organizations');

  // 3. Create organization
  await page.click('text=Create Organization');
  await page.fill('input[name="name"]', 'Test Org');
  await page.fill('textarea[name="description"]', 'Test Description');
  await page.click('button:has-text("Create")');

  // 4. Verify organization appears
  await expect(page.locator('text=Test Org')).toBeVisible();

  // 5. Add member
  await page.click('text=Test Org');
  await page.click('text=Members');
  await page.click('text=Add Member');
  await page.fill('input[name="userId"]', 'user-123');
  await page.click('text=org-member');
  await page.click('button:has-text("Add Member")');

  // 6. Verify member added
  await expect(page.locator('text=user-123')).toBeVisible();
});
```

---

## Migration & Deployment

### Phase 6.1 Deployment
- Deploy API clients and hooks
- No user-facing changes yet
- Low risk

### Phase 6.2 Deployment
- Deploy organizations list and details pages
- Add navigation links to settings menu
- Feature flag: `ENABLE_ORG_MANAGEMENT_UI`

### Phase 6.3 Deployment
- Deploy member management UI
- Notify admins of new feature
- Provide documentation

### Phase 6.4 Deployment
- Deploy teams management UI
- Complete feature rollout

### Phase 6.5 Deployment
- Deploy organization switcher
- Update navigation globally
- High visibility change

### Phase 6.6 Deployment
- Deploy enhanced features incrementally
- Gather user feedback
- Iterate on UX

---

## Documentation

### User Documentation

**File**: `docs/user-guide/organizations.md`
- How to create an organization
- How to invite members
- Understanding roles and permissions
- Managing teams

**File**: `docs/user-guide/teams.md`
- Creating teams within organizations
- Team member management
- Team vs organization roles

### Developer Documentation

**File**: `docs/dev/organization-ui.md`
- Component architecture
- State management patterns
- API client usage
- Testing guidelines

---

## Success Criteria

### Functional Requirements
- ✅ Users can view all organizations they're members of
- ✅ Org admins can create/update/delete organizations
- ✅ Org admins can add/remove members and assign roles
- ✅ Users can create and manage teams within organizations
- ✅ Team admins can manage team members
- ✅ Organization switcher allows switching context
- ✅ All actions respect RBAC permissions

### Non-Functional Requirements
- ✅ Page load time <2 seconds
- ✅ Form submissions respond within 500ms
- ✅ Mobile-responsive on all screen sizes
- ✅ WCAG 2.1 AA accessibility compliance
- ✅ Error messages are user-friendly
- ✅ Loading states provide visual feedback

### User Experience
- ✅ Intuitive navigation between orgs/teams
- ✅ Clear visual feedback for all actions
- ✅ Consistent with existing Perfana UI
- ✅ No confusion about current organization context
- ✅ Helpful empty states guide new users

---

## Risks & Mitigation

### Risk: User Confusion About Roles
**Mitigation**:
- Provide role permissions matrix
- Add tooltips explaining each role
- Include help documentation links

### Risk: Performance with Many Organizations
**Mitigation**:
- Implement pagination for large lists
- Lazy load organization details
- Cache organization list in context

### Risk: Accidental Organization Deletion
**Mitigation**:
- Require confirmation dialog
- Show resource count before deletion
- Consider soft delete with grace period

### Risk: API Key Organization Association
**Mitigation**:
- Clearly show which org an API key belongs to
- Prevent cross-org API key usage
- Document API key scoping in UI

---

## Post-Implementation

### Phase 6.7: Polish & Optimization (Week 8+)
- Performance profiling and optimization
- Accessibility audit and fixes
- User feedback incorporation
- UI polish and animations
- Mobile UX refinement

### Future Enhancements
- Organization templates for quick setup
- Role templates for common permission sets
- Member groups for bulk permissions
- Organization settings (branding, defaults)
- Advanced member search with filters
- Export organization/team data
- Organization transfer ownership

---

## Dependencies

**Required Before Starting**:
- ✅ Phase 5 complete (RLS, audit logging)
- ✅ Backend API fully tested
- ✅ Keycloak JWT authentication working
- ✅ React Query configured in frontend

**Required During Implementation**:
- Material-UI v5
- React Query v4+
- Next.js 14+ (App Router)
- TypeScript 5+

**Optional Enhancements**:
- Email service (for invitations)
- File upload service (for member CSV import)
- Analytics service (for usage tracking)

---

## Estimated Effort

**Total Timeline**: 6-8 weeks

**Breakdown by Phase**:
- Phase 6.1 (API Clients): 1-2 weeks
- Phase 6.2 (Organizations UI): 1 week
- Phase 6.3 (Members Management): 1 week
- Phase 6.4 (Teams UI): 1 week
- Phase 6.5 (Org Switcher): 1 week
- Phase 6.6 (Enhanced Features): 1-2 weeks
- Phase 6.7 (Polish): Ongoing

**Team Requirements**:
- 1 Frontend Engineer (primary)
- 1 Backend Engineer (API enhancements, 25% time)
- 1 Designer (UX review, 10% time)
- 1 QA Engineer (testing, 25% time)

---

## Conclusion

This plan completes the RBAC feature by providing a full UI layer for organization and team management. Upon completion:

1. **Users can self-manage** organizations and teams without admin help
2. **Clear visual feedback** shows current organization context
3. **Role management** is intuitive and well-documented
4. **Mobile users** have full functionality on smaller screens
5. **Accessibility standards** are met for all users

The implementation follows a phased approach to minimize risk and allow for iterative feedback. Each phase delivers incremental value and can be deployed independently with feature flags.
