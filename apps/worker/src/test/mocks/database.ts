import { vi } from 'vitest';

export class MockClient {
  query = vi.fn();
  release = vi.fn();
}

export class MockPool {
  mockClient = new MockClient();

  connect = vi.fn(() => Promise.resolve(this.mockClient));
  end = vi.fn(() => Promise.resolve());
  on = vi.fn();

  setupTransactionMocks() {
    // Setup default transaction behavior
    this.mockClient.query.mockImplementation((sql: string, params?: any[]) => {
      if (sql === 'BEGIN') {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql === 'COMMIT') {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (sql === 'ROLLBACK') {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      // Default return for other queries
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  }
}

export function createMockPool(): MockPool {
  return new MockPool();
}