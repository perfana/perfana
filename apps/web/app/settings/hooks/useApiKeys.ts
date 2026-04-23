'use client';

import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  fetchApiKeys,
  createApiKey,
  deleteApiKey,
  ApiKey,
  ApiKeyRequestError,
} from '@/lib/api-keys';
import {
  createApiKeySchema,
  type CreateApiKeyFormData,
} from '@/lib/validations';
import { UseApiKeysProps } from '../types';
import { useOrganizationContext } from '@/lib/contexts/organization-context';

export function useApiKeys({ onSnackbar }: UseApiKeysProps) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [createdToken, setCreatedToken] = useState<string>('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<ApiKey | null>(null);

  // Get organization context for multi-org support
  const { currentOrganizationId, organizations } = useOrganizationContext();

  const form = useForm<CreateApiKeyFormData>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: {
      description: '',
      ttl: '30d',
      organizationId: currentOrganizationId || undefined,
    },
  });

  // Update organizationId when current organization changes
  useEffect(() => {
    if (currentOrganizationId) {
      form.setValue('organizationId', currentOrganizationId);
    }
  }, [currentOrganizationId, form]);

  const loadApiKeys = useCallback(async () => {
    try {
      setLoading(true);
      const keys = await fetchApiKeys(currentOrganizationId || undefined);
      setApiKeys(keys);
      setError('');
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to load API keys'
      );
    } finally {
      setLoading(false);
    }
  }, [currentOrganizationId]);

  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

  const handleCreateKey = async (data: CreateApiKeyFormData) => {
    try {
      const requestData = {
        description: data.description || '',
        ttl: data.ttl || '30d',
        organizationId: currentOrganizationId || data.organizationId,
      };
      const result = await createApiKey(requestData);
      setApiKeys([result.apiKey, ...apiKeys]);
      setCreatedToken(result.token);
      setCreateDialogOpen(false);
      form.reset();
      onSnackbar({
        open: true,
        message: 'API key created successfully! Make sure to copy it now.',
        severity: 'success',
      });
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? (err as Error).message
          : 'Failed to create API key';
      // Surface duplicate-description conflicts inline on the description
      // field so the user sees exactly which field to fix (issue #117).
      if (err instanceof ApiKeyRequestError && err.status === 409) {
        form.setError('description', { message });
      } else {
        form.setError('root', { message });
      }
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    try {
      await deleteApiKey(keyId);
      setApiKeys(apiKeys.filter((key) => key.id !== keyId));
      setDeleteDialogOpen(false);
      setSelectedKey(null);
      onSnackbar({
        open: true,
        message: 'API key deleted successfully',
        severity: 'success',
      });
    } catch (err) {
      onSnackbar({
        open: true,
        message:
          err && typeof err === 'object' && 'message' in err
            ? (err as Error).message
            : 'Failed to delete API key',
        severity: 'error',
      });
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onSnackbar({
        open: true,
        message: 'Copied to clipboard!',
        severity: 'success',
      });
    } catch {
      onSnackbar({
        open: true,
        message: 'Failed to copy to clipboard',
        severity: 'error',
      });
    }
  };

  const clearCreatedToken = () => {
    setCreatedToken('');
  };

  const openDeleteDialog = (apiKey: ApiKey) => {
    setSelectedKey(apiKey);
    setDeleteDialogOpen(true);
  };

  const closeDialogs = () => {
    setCreateDialogOpen(false);
    setDeleteDialogOpen(false);
    setSelectedKey(null);
    form.reset();
  };

  return {
    apiKeys,
    loading,
    error,
    createdToken,
    createDialogOpen,
    deleteDialogOpen,
    selectedKey,
    form,
    organizations, // Expose organizations for the dialog
    loadApiKeys,
    handleCreateKey,
    handleDeleteKey,
    setCreateDialogOpen,
    setDeleteDialogOpen,
    setSelectedKey,
    clearCreatedToken,
    copyToClipboard,
    openDeleteDialog,
    closeDialogs,
  };
}
