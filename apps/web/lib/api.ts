import { env } from './env';

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};

  // Store persistent logs to survive page reloads
  const persistLog = (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    const logs = JSON.parse(localStorage.getItem('perfana_debug_logs') || '[]');
    logs.push({ timestamp, message, data });
    // Keep only last 50 logs
    if (logs.length > 50) logs.splice(0, logs.length - 50);
    localStorage.setItem('perfana_debug_logs', JSON.stringify(logs));
    // console.log(message, data); // Disabled - logs still stored in localStorage
  };

  persistLog('🔍 getAuthHeaders called', {
    useKeycloak: env.USE_KEYCLOAK_AUTH,
    keycloakUrl: env.KEYCLOAK_URL,
    keycloakRealm: env.KEYCLOAK_REALM,
    timestamp: new Date().toISOString()
  });

  // Try to get Keycloak token first if enabled
  if (env.USE_KEYCLOAK_AUTH) {
    persistLog('🔑 Attempting Keycloak authentication...');
    try {
      // Dynamically import keycloak auth to avoid SSR issues
      const keycloakAuth = require('./keycloak-auth').default;
      persistLog('📦 Keycloak auth module loaded', {
        isAuthenticated: keycloakAuth.isAuthenticated(),
        hasToken: !!keycloakAuth.getToken()
      });

      const keycloakToken = keycloakAuth.getToken();
      if (keycloakToken) {
        persistLog('✅ Keycloak token found', {
          tokenLength: keycloakToken.length,
        });
        return { 'Authorization': `Bearer ${keycloakToken}` };
      } else {
        persistLog('❌ No Keycloak token available');
      }
    } catch (error) {
      persistLog('⚠️ Failed to get Keycloak token:', error);
    }
  }

  // Fallback to traditional token (sessionStorage preferred over localStorage for security)
  const token = sessionStorage.getItem('perfana_access_token') || localStorage.getItem('perfana_access_token');
  persistLog('🔄 Falling back to traditional token', {
    hasToken: !!token,
    tokenLength: token?.length,
  });

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
      const refreshToken = typeof window !== 'undefined' ? (sessionStorage.getItem('perfana_refresh_token') || localStorage.getItem('perfana_refresh_token')) : null;
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
    localStorage.removeItem('perfana_access_token');
    localStorage.removeItem('perfana_refresh_token');
    localStorage.removeItem('perfana_user');

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
  // Store persistent logs to survive page reloads
  const persistLog = (message: string, data?: any) => {
    if (typeof window !== 'undefined') {
      const timestamp = new Date().toISOString();
      const logs = JSON.parse(localStorage.getItem('perfana_debug_logs') || '[]');
      logs.push({ timestamp, message, data });
      // Keep only last 50 logs
      if (logs.length > 50) logs.splice(0, logs.length - 50);
      localStorage.setItem('perfana_debug_logs', JSON.stringify(logs));
    }
    // console.log(message, data); // Disabled - logs still stored in localStorage
  };

  const fullUrl = url.startsWith('http') ? url : `${env.API_URL}/${url.replace(/^\//, '')}`;
  persistLog('🔗 authenticatedFetch called:', {
    originalUrl: url,
    envApiUrl: env.API_URL,
    constructedFullUrl: fullUrl,
    method: options.method || 'GET'
  });

  const requestOptions = {
    ...options,
    headers: {
      ...options.headers,
      ...getAuthHeaders(),
    },
  };

  persistLog('📤 Making API request', {
    url: fullUrl,
    method: options.method || 'GET',
    hasAuthHeader: !!(requestOptions.headers as Record<string, string>)?.['Authorization']
  });

  let response = await fetch(fullUrl, requestOptions);

  persistLog('📥 API response received', {
    url: fullUrl,
    status: response.status,
    statusText: response.statusText,
    ok: response.ok
  });

  // If 401, try to refresh token and retry once
  if (response.status === 401) {
    persistLog('🔄 401 response, attempting token refresh');
    const refreshed = await handleAuthError(response);
    if (refreshed) {
      persistLog('✅ Token refreshed, retrying request');
      // Update headers with new token and retry
      requestOptions.headers = {
        ...requestOptions.headers,
        ...getAuthHeaders(),
      };
      response = await fetch(fullUrl, requestOptions);
      persistLog('📥 Retry response received', {
        url: fullUrl,
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      });
    } else {
      persistLog('❌ Token refresh failed');
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