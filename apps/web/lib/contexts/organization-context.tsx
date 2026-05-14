'use client';

/**
 * Organization Context Provider
 *
 * Provides the current organization selection context throughout the app.
 * Persists the selected organization to localStorage.
 *
 * - Admins: interactive selector, no auto-select on first visit
 * - Non-admin multi-org users: interactive selector, no auto-select on first visit
 * - Non-admin single-org users: read-only display, auto-selected
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { useOrganizations } from '../hooks/use-organizations';
import { Organization } from '../api/organizations';
import { useAuth } from '@/contexts/auth-context';
import { hasGlobalAdminRole } from '@/lib/constants/roles';

const STORAGE_KEY = 'perfana_selected_organization_id';

interface OrganizationContextValue {
  /** Currently selected organization */
  currentOrganization: Organization | null;
  /** ID of the currently selected organization */
  currentOrganizationId: string | null;
  /** All organizations the user has access to */
  organizations: Organization[];
  /** Whether organizations are loading */
  isLoading: boolean;
  /** Error if organizations failed to load */
  error: Error | null;
  /** Whether the org selector should be visible (true once orgs are loaded and user has >= 1 org) */
  shouldShowSelector: boolean;
  /** Whether the selector is read-only (non-admin single-org user) */
  isSelectorReadOnly: boolean;
  /** Whether orgs are loaded AND an org is selected (data views can render) */
  isReady: boolean;
  /** Whether the user is authenticated but has no organization memberships (non-admin) */
  hasNoOrganizations: boolean;
  /** Whether the user is a global admin */
  isAdmin: boolean;
  /** Select an organization by ID */
  selectOrganization: (id: string) => void;
  /** Clear the current organization selection */
  clearSelection: () => void;
  /** Refresh the organizations list */
  refresh: () => void;
}

const OrganizationContext = createContext<OrganizationContextValue | undefined>(
  undefined
);

export interface OrganizationProviderProps {
  children: React.ReactNode;
}

/**
 * Organization Provider Component
 *
 * Wraps the application to provide organization context.
 * - Admins must explicitly select an org (unless one is persisted in localStorage)
 * - Non-admin single-org users auto-select their only org
 */
export function OrganizationProvider({ children }: OrganizationProviderProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Get authentication state
  const { user, isLoading: isAuthLoading } = useAuth();

  // Determine if user is a global admin
  const isAdmin = useMemo(
    () => hasGlobalAdminRole(user?.roles),
    [user?.roles]
  );

  // Fetch organizations - only when authenticated
  const {
    data: organizations = [],
    isLoading,
    error,
    refetch,
  } = useOrganizations({
    enabled: !isAuthLoading && user !== null,
  });

  // Whether the selector should be visible (always when user has at least 1 org)
  const shouldShowSelector = useMemo(() => {
    if (isLoading || !isInitialized) return false;
    return organizations.length > 0;
  }, [organizations.length, isLoading, isInitialized]);

  // Read-only for non-admin single-org users (display-only, no dropdown)
  const isSelectorReadOnly = useMemo(() => {
    return !isAdmin && organizations.length === 1;
  }, [isAdmin, organizations.length]);

  // True when user is authenticated, orgs finished loading, but user has zero memberships (and is not an admin)
  const hasNoOrganizations = useMemo(() => {
    return isInitialized && !isLoading && !isAdmin && organizations.length === 0;
  }, [isInitialized, isLoading, isAdmin, organizations.length]);

  // Load persisted selection on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedId = localStorage.getItem(STORAGE_KEY);
      if (storedId) {
        setSelectedId(storedId);
      }
      setIsInitialized(true);
    }
  }, []);

  // Auto-select logic:
  // - Non-admin single-org users: auto-select their only org
  // - Admins: only auto-select if there's a valid persisted selection
  // - Multi-org non-admins: only auto-select if there's a valid persisted selection
  useEffect(() => {
    if (!isInitialized || isLoading || organizations.length === 0 || selectedId) {
      return;
    }

    // Check if stored ID is still valid
    const storedId = localStorage.getItem(STORAGE_KEY);
    const storedOrgExists = storedId && organizations.some((o) => o.id === storedId);

    if (storedOrgExists) {
      // Restore persisted selection
      setSelectedId(storedId);
    } else if (!isAdmin && organizations.length === 1) {
      // Non-admin with exactly one org: auto-select
      const firstOrg = organizations[0];
      setSelectedId(firstOrg.id);
      localStorage.setItem(STORAGE_KEY, firstOrg.id);
    }
    // Admin or multi-org without persisted selection: leave unselected
  }, [isInitialized, isLoading, organizations, selectedId, isAdmin]);

  // Clear selection if selected org no longer exists
  useEffect(() => {
    if (
      isInitialized &&
      !isLoading &&
      selectedId &&
      organizations.length > 0 &&
      !organizations.some((o) => o.id === selectedId)
    ) {
      clearSelection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitialized, isLoading, selectedId, organizations]);

  const selectOrganization = useCallback((id: string) => {
    setSelectedId(id);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, id);
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const refresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const currentOrganization = useMemo(() => {
    if (!selectedId) return null;
    return organizations.find((o) => o.id === selectedId) || null;
  }, [selectedId, organizations]);

  // Ready when orgs are loaded and one is selected
  const isReady = useMemo(
    () => isInitialized && !isLoading && selectedId !== null && currentOrganization !== null,
    [isInitialized, isLoading, selectedId, currentOrganization]
  );

  const value = useMemo<OrganizationContextValue>(
    () => ({
      currentOrganization,
      currentOrganizationId: selectedId,
      organizations,
      isLoading,
      error: error as Error | null,
      shouldShowSelector,
      isSelectorReadOnly,
      isReady,
      hasNoOrganizations,
      isAdmin,
      selectOrganization,
      clearSelection,
      refresh,
    }),
    [
      currentOrganization,
      selectedId,
      organizations,
      isLoading,
      error,
      shouldShowSelector,
      isSelectorReadOnly,
      isReady,
      hasNoOrganizations,
      isAdmin,
      selectOrganization,
      clearSelection,
      refresh,
    ]
  );

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}

/**
 * Hook to access the organization context
 *
 * Must be used within an OrganizationProvider.
 */
export function useOrganizationContext(): OrganizationContextValue {
  const context = useContext(OrganizationContext);
  if (context === undefined) {
    throw new Error(
      'useOrganizationContext must be used within an OrganizationProvider'
    );
  }
  return context;
}

/**
 * Hook to get the current organization (convenience hook)
 */
export function useCurrentOrganization(): Organization | null {
  const { currentOrganization } = useOrganizationContext();
  return currentOrganization;
}

/**
 * Hook to get the current organization ID (convenience hook)
 */
export function useCurrentOrganizationId(): string | null {
  const { currentOrganizationId } = useOrganizationContext();
  return currentOrganizationId;
}
