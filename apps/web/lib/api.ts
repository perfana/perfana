import { env } from './env';

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};

  // Try to get Keycloak token first if enabled
  if (env.USE_KEYCLOAK_AUTH) {
    try {
      // Dynamically import keycloak auth to avoid SSR issues
      const keycloakAuth = require('./keycloak-auth').default;
      const keycloakToken = keycloakAuth.getToken();
      if (keycloakToken) {
        return { 'Authorization': `Bearer ${keycloakToken}` };
      }
    } catch (error) {
      console.warn('Failed to get Keycloak token:', error);
    }
  }

  // Fallback to traditional token (sessionStorage only for security)
  const token = sessionStorage.getItem('perfana_access_token');

  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

async function handleAuthError(response: Response): Promise<boolean> {
  if (response.status === 401) {
    // Handle Keycloak token refresh first if enabled
    if (env.USE_KEYCLOAK_AUTH && typeof window !== 'undefined') {
      try {
        const keycloakAuth = require('./keycloak-auth').default;
        if (keycloakAuth.isAuthenticated()) {
          const refreshed = await keycloakAuth.updateToken(0); // Force refresh
          if (refreshed) {
            return true;
          } else {
            // Keycloak refresh failed, redirect to Keycloak login
            await keycloakAuth.login();
            return false;
          }
        }
      } catch (error) {
        console.warn('Keycloak token refresh failed:', error);
      }
    }

    // Traditional token refresh
    try {
      const refreshToken = typeof window !== 'undefined' ? sessionStorage.getItem('perfana_refresh_token') : null;
      if (refreshToken) {
        const refreshResponse = await fetch(`${env.API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        if (refreshResponse.ok) {
          const data = await refreshResponse.json();
          sessionStorage.setItem('perfana_access_token', data.session.access_token);
          sessionStorage.setItem('perfana_refresh_token', data.session.refresh_token);
          return true; // Token refreshed successfully
        }
      }
    } catch (error) {
      console.warn('Token refresh failed:', error);
    }

    // Refresh failed, clear tokens and redirect to signin
    sessionStorage.removeItem('perfana_access_token');
    sessionStorage.removeItem('perfana_refresh_token');

    if (typeof window !== 'undefined') {
      // Save the current path so we can return after login
      const returnTo = window.location.pathname + window.location.search;
      if (returnTo !== '/' && returnTo !== '/signin') {
        sessionStorage.setItem('perfana_return_to', returnTo);
      }
      window.location.href = '/signin';
    }
    return false;
  }
  return false;
}




// Export the utilities for use in other components
export { getAuthHeaders, handleAuthError };

// Utility function to make an authenticated fetch request with auto-retry on 401
export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const fullUrl = url.startsWith('http') ? url : `${env.API_URL}/${url.replace(/^\//, '')}`;

  const requestOptions = {
    ...options,
    headers: {
      ...options.headers,
      ...getAuthHeaders(),
    },
  };

  let response = await fetch(fullUrl, requestOptions);

  // If 401, try to refresh token and retry once
  if (response.status === 401) {
    const refreshed = await handleAuthError(response);
    if (refreshed) {
      requestOptions.headers = {
        ...requestOptions.headers,
        ...getAuthHeaders(),
      };
      response = await fetch(fullUrl, requestOptions);
    }
  }

  return response;
}

// Dashboard API functions
export interface DashboardStatistics {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  activeTests: number;
  sloComplianceRate: number;
  mostTestedSystem: { name: string; count: number } | null;
  timePeriod: string;
}

export interface RecentFailure {
  id: string;
  test_run_id: string;
  system_name: string;
  test_environment: string;
  workload: string;
  start_time: string | null;
  end_time: string | null;
  consolidated_result: any;
  created_at: string;
}

export interface SystemSummary {
  id: string;
  name: string;
  testRunCount: number;
  lastTestRun: string | null;
  passFailRatio: { passed: number; failed: number };
}

/**
 * Fetch dashboard statistics with optional time period filtering
 */
export async function fetchDashboardStatistics(
  timePeriod: '24h' | '7d' | '30d' | 'all' | 'custom' = '7d',
  from?: string,
  to?: string,
  organizationId?: string,
): Promise<DashboardStatistics> {
  let url = `test-runs/dashboard/statistics?timePeriod=${timePeriod}`;

  // Add custom date range parameters if provided
  if (timePeriod === 'custom' && from && to) {
    url += `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  }

  if (organizationId) {
    url += `&organizationId=${encodeURIComponent(organizationId)}`;
  }

  const response = await authenticatedFetch(url, { method: 'GET' });

  if (!response.ok) {
    throw new Error(`Failed to fetch dashboard statistics: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch recent failed test runs
 */
export async function fetchRecentFailures(
  limit: number = 10,
  timePeriod: '24h' | '7d' | '30d' | 'all' | 'custom' = '7d',
  from?: string,
  to?: string,
  organizationId?: string,
): Promise<RecentFailure[]> {
  let url = `test-runs/dashboard/recent-failures?limit=${limit}&timePeriod=${timePeriod}`;

  // Add custom date range parameters if provided
  if (timePeriod === 'custom' && from && to) {
    url += `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  }

  if (organizationId) {
    url += `&organizationId=${encodeURIComponent(organizationId)}`;
  }

  const response = await authenticatedFetch(url, { method: 'GET' });

  if (!response.ok) {
    throw new Error(`Failed to fetch recent failures: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch systems summary for dashboard
 */
export async function fetchDashboardSystemsSummary(organizationId?: string): Promise<SystemSummary[]> {
  let url = 'test-runs/dashboard/systems-summary';
  if (organizationId) {
    url += `?organizationId=${encodeURIComponent(organizationId)}`;
  }

  const response = await authenticatedFetch(url, { method: 'GET' });

  if (!response.ok) {
    throw new Error(`Failed to fetch systems summary: ${response.statusText}`);
  }

  return response.json();
}