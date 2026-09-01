/**
 * Tests for useDynatraceIntegration.
 *
 * Two contracts live in this hook and nowhere else:
 *
 * 1. `clientUrl` is asymmetric between create and update. Create OMITS the key
 *    when the field is blank (a POST must not carry an empty column value);
 *    update ALWAYS sends it, `''` included, because `''` is how the user clears
 *    a client URL that was previously set.
 * 2. `apiToken` is optional in the zod schema so the EDIT dialog can submit it
 *    blank ("keep the existing token"). The create and test-connection paths
 *    have nothing to keep, so they re-impose it themselves — with a field error
 *    and an early return, not a request.
 */

import { renderHook, act } from '@testing-library/react';
import { useDynatraceIntegration } from '../useDynatraceIntegration';
import type { CreateDynatraceConfigFormData } from '@/lib/validations';

jest.mock('@/lib/dynatrace', () => ({
  fetchDynatraceConfigs: jest.fn(),
  createDynatraceConfig: jest.fn(),
  updateDynatraceConfig: jest.fn(),
  testDynatraceConnection: jest.fn(),
  fetchRequestAttributesForHost: jest.fn(),
  deleteDynatraceConfig: jest.fn(),
}));

import {
  fetchDynatraceConfigs,
  createDynatraceConfig,
  updateDynatraceConfig,
  testDynatraceConnection,
  fetchRequestAttributesForHost,
  type DynatraceConfig,
} from '@/lib/dynatrace';

const mockFetchConfigs = fetchDynatraceConfigs as jest.MockedFunction<typeof fetchDynatraceConfigs>;
const mockCreate = createDynatraceConfig as jest.MockedFunction<typeof createDynatraceConfig>;
const mockUpdate = updateDynatraceConfig as jest.MockedFunction<typeof updateDynatraceConfig>;
const mockTestConnection = testDynatraceConnection as jest.MockedFunction<typeof testDynatraceConnection>;
const mockFetchAttributes = fetchRequestAttributesForHost as jest.MockedFunction<
  typeof fetchRequestAttributesForHost
>;

const EXISTING_CONFIG: DynatraceConfig = {
  id: 'cfg-1',
  label: 'Prod tenant',
  host: 'https://abc12345.live.dynatrace.com',
  clientUrl: 'https://dt-proxy.internal.example.com',
  apiToken: 'stored-token',
  dynatraceType: 'saas',
  useProxy: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function formData(overrides: Partial<CreateDynatraceConfigFormData> = {}): CreateDynatraceConfigFormData {
  return {
    label: 'Prod tenant',
    host: 'https://abc12345.live.dynatrace.com',
    clientUrl: 'https://dt-proxy.internal.example.com',
    apiToken: 'dt0c01.token1234',
    platformApiToken: '',
    dynatraceType: 'saas',
    useProxy: false,
    ...overrides,
  } as CreateDynatraceConfigFormData;
}

function renderIntegration() {
  const onSnackbar = jest.fn();
  const { result } = renderHook(() => useDynatraceIntegration({ onSnackbar }));
  return { result, onSnackbar };
}

/** Put the hook in the state handleUpdate needs: a selected config, edit dialog open. */
async function renderEditing(config: DynatraceConfig = EXISTING_CONFIG) {
  const { result, onSnackbar } = renderIntegration();
  await act(async () => {
    result.current.openEditDialog(config);
  });
  return { result, onSnackbar };
}

describe('useDynatraceIntegration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchConfigs.mockResolvedValue([]);
    mockCreate.mockResolvedValue(EXISTING_CONFIG);
    mockUpdate.mockResolvedValue(EXISTING_CONFIG);
    mockFetchAttributes.mockResolvedValue({ all: [], testRunId: [], requestName: [] } as never);
    mockTestConnection.mockResolvedValue({ success: true, version: '1.300.0' } as never);
  });

  describe('handleCreate', () => {
    it('sends clientUrl when the user filled it in', async () => {
      const { result } = renderIntegration();

      await act(async () => {
        await result.current.handleCreate(formData({ clientUrl: 'https://dt.example.com' }));
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate.mock.calls[0][0].clientUrl).toBe('https://dt.example.com');
    });

    it('omits the clientUrl key entirely when the field is blank', async () => {
      const { result } = renderIntegration();

      await act(async () => {
        await result.current.handleCreate(formData({ clientUrl: '' }));
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      // Not `undefined` — the key must not be in the payload at all.
      expect(Object.keys(mockCreate.mock.calls[0][0])).not.toContain('clientUrl');
    });

    it('refuses a blank apiToken with a field error instead of calling the API', async () => {
      const { result } = renderIntegration();

      await act(async () => {
        await result.current.handleCreate(formData({ apiToken: '' }));
      });

      expect(mockCreate).not.toHaveBeenCalled();
      expect(result.current.form.getFieldState('apiToken').error?.message).toBe(
        'API token is required'
      );
    });
  });

  describe('handleUpdate', () => {
    it('always sends clientUrl, including the empty string that clears it', async () => {
      const { result } = await renderEditing();

      await act(async () => {
        await result.current.handleUpdate(formData({ clientUrl: '' }));
      });

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      const [id, payload] = mockUpdate.mock.calls[0];
      expect(id).toBe('cfg-1');
      expect(Object.keys(payload)).toContain('clientUrl');
      expect(payload.clientUrl).toBe('');
    });

    it('sends the label so a rename actually reaches the API', async () => {
      const { result } = await renderEditing();

      await act(async () => {
        await result.current.handleUpdate(formData({ label: 'Renamed tenant' }));
      });

      expect(mockUpdate.mock.calls[0][1].label).toBe('Renamed tenant');
    });
  });

  describe('edit dialog form reset', () => {
    it('prefills clientUrl from the selected config and leaves the token blank', async () => {
      const { result } = await renderEditing();

      const values = result.current.form.getValues();
      expect(values.clientUrl).toBe('https://dt-proxy.internal.example.com');
      expect(values.label).toBe('Prod tenant');
      expect(values.apiToken).toBe('');
    });

    it('maps an unset clientUrl to an empty string rather than undefined', async () => {
      const { result } = await renderEditing({ ...EXISTING_CONFIG, clientUrl: undefined });

      expect(result.current.form.getValues().clientUrl).toBe('');
    });
  });

  describe('handleTestConnection', () => {
    it('refuses a blank apiToken with a field error instead of calling the API', async () => {
      const { result } = renderIntegration();

      await act(async () => {
        await result.current.handleTestConnection(formData({ apiToken: '' }));
      });

      expect(mockTestConnection).not.toHaveBeenCalled();
      expect(result.current.form.getFieldState('apiToken').error?.message).toBe(
        'API token is required'
      );
    });

    it('tests against host, not clientUrl — the server is what has to reach Dynatrace', async () => {
      const { result } = renderIntegration();

      await act(async () => {
        await result.current.handleTestConnection(formData());
      });

      expect(mockTestConnection).toHaveBeenCalledWith({
        host: 'https://abc12345.live.dynatrace.com',
        apiToken: 'dt0c01.token1234',
      });
    });
  });
});
