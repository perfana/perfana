import { describe, it, expect } from 'vitest';
import { batchPanelQueries, processBatchedResponses } from '@perfana/shared/services/grafana';
import { PanelDocument } from '../../src/types/pipeline.js';

describe('Grafana Batching', () => {
  const mockPanel: PanelDocument = {
    test_run_id: 'test-123',
    application_dashboard_id: 'dashboard-1',
    dashboard_uid: 'uid-123',
    panel_id: 1,
    panel_title: 'Test Panel',
    dashboard_label: 'Test Dashboard',
    benchmark_ids: null,
    errors: null,
    requests: [{
      endpoint: '/api/ds/query',
      method: 'POST',
      request_body: {
        queries: [{
          refId: 'A',
          expr: 'test_metric'
        }],
        from_: '2024-01-01T00:00:00Z',
        to: '2024-01-01T01:00:00Z'
      }
    }],
    updated_at: new Date()
  };

  describe('batchPanelQueries', () => {
    it('should create batches with correct structure', () => {
      const panels = [mockPanel];
      const batches = batchPanelQueries(panels, 1);

      expect(batches).toHaveLength(1);
      expect(batches[0]).toMatchObject({
        request: {
          endpoint: '/api/ds/query',
          method: 'POST',
          request_body: {
            queries: expect.any(Array),
            from_: '2024-01-01T00:00:00Z',
            to: '2024-01-01T01:00:00Z'
          }
        },
        ref_id_mapping: expect.any(Array)
      });
    });

    it('should handle empty panels array', () => {
      const batches = batchPanelQueries([]);
      expect(batches).toHaveLength(0);
    });

    it('should skip panels with no requests', () => {
      const panelWithoutRequests = { ...mockPanel, requests: [] };
      const batches = batchPanelQueries([panelWithoutRequests]);
      expect(batches).toHaveLength(0);
    });
  });

  describe('processBatchedResponses', () => {
    it('should handle empty responses', () => {
      const results = processBatchedResponses([], []);
      expect(results).toHaveLength(0);
    });

    it('should handle client errors', () => {
      const batches = batchPanelQueries([mockPanel], 1);
      const responses = [{ error: new Error('Network error') }];

      const results = processBatchedResponses(batches, responses);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        panel: mockPanel,
        data: null,
        errors: expect.arrayContaining([
          expect.objectContaining({
            message: 'Internal client error when making request to Grafana.',
            type: expect.any(String)
          })
        ])
      });
    });
  });
});