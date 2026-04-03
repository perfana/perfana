import { authenticatedFetch } from './api';

export interface ApiKey {
  id: string;
  description: string;
  valid_until: string;
  created_at: string;
  last_used?: string;
}

export interface CreateApiKeyRequest {
  description: string;
  ttl: string;
  organizationId?: string; // Organization to create the API key for
}

export interface CreateApiKeyResponse {
  apiKey: ApiKey;
  token: string;
}

export async function fetchApiKeys(organizationId?: string): Promise<ApiKey[]> {
  const url = organizationId
    ? `/api-keys?organizationId=${encodeURIComponent(organizationId)}`
    : `/api-keys`;
  const response = await authenticatedFetch(url, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch API keys');
  }

  return response.json();
}

export async function createApiKey(data: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
  const response = await authenticatedFetch(`/api-keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create API key');
  }

  return response.json();
}

export async function deleteApiKey(id: string): Promise<void> {
  const response = await authenticatedFetch(`/api-keys/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to delete API key');
  }
}

export async function validateApiKey(token: string): Promise<boolean> {
  const response = await authenticatedFetch(`/api-keys/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    return false;
  }

  const result = await response.json();
  return result.valid;
}