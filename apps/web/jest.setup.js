// Optional: configure or set up a testing framework before each test.
// If you delete this file, remove `setupFilesAfterEnv` from `jest.config.js`

// Used for __tests__/testing-library.js
// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'

// Setup required environment variables for tests
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api'
process.env.NEXT_PUBLIC_KEYCLOAK_URL = 'http://localhost:8080'
process.env.NEXT_PUBLIC_KEYCLOAK_REALM = 'perfana-test'
process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID = 'perfana-web-test'
process.env.NEXT_PUBLIC_USE_KEYCLOAK_AUTH = 'false'

// Mock keycloak-js to avoid ESM import issues
jest.mock('keycloak-js', () => {
  return jest.fn(() => ({
    init: jest.fn().mockResolvedValue(true),
    login: jest.fn(),
    logout: jest.fn(),
    updateToken: jest.fn().mockResolvedValue(true),
    hasRealmRole: jest.fn().mockReturnValue(false),
    createAccountUrl: jest.fn().mockReturnValue(''),
    token: 'mock-token',
    refreshToken: 'mock-refresh-token',
    authenticated: true,
    subject: 'user-123',
    tokenParsed: { sub: 'user-123', email: 'test@example.com', realm_access: { roles: [] } },
  }));
});

// Mock socket.io-client globally
// Individual test files can override with their own jest.mock() calls
jest.mock('socket.io-client', () => {
  const mockSocketInstance = {
    on: jest.fn(),
    off: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    removeAllListeners: jest.fn(),
    onAny: jest.fn(),
    connected: false,
    id: 'mock-socket-id',
  };

  return {
    io: jest.fn(() => mockSocketInstance),
  };
});

// Mock next/navigation globally
// Individual test files can override with their own jest.mock() calls
// IMPORTANT: Return stable references to prevent infinite re-render loops
// in hooks that use these values as useEffect/useCallback dependencies
const mockNavRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  prefetch: jest.fn(),
  back: jest.fn(),
  forward: jest.fn(),
  refresh: jest.fn(),
};
const mockNavSearchParams = new URLSearchParams();
const mockNavParams = {};

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => mockNavRouter),
  useSearchParams: jest.fn(() => mockNavSearchParams),
  usePathname: jest.fn(() => '/'),
  useParams: jest.fn(() => mockNavParams),
}));

// Mock theme context globally
jest.mock('@/contexts/theme-context', () => ({
  useThemeMode: () => ({
    mode: 'light',
    preference: 'light',
    isDark: false,
    toggleTheme: jest.fn(),
    setMode: jest.fn(),
    setPreference: jest.fn(),
  }),
  ThemeContextProvider: ({ children }) => children,
}));

// Mock next/image globally
// Renders a simple img element for testing purposes
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props) => {
    const React = require('react');
    return React.createElement('img', props);
  },
}));

// Enhanced Response polyfill for tests
if (typeof Response === 'undefined') {
  global.Response = class Response {
    constructor(body, init = {}) {
      this.body = body
      this.status = init.status || 200
      this.statusText = init.statusText || 'OK'
      this.ok = this.status >= 200 && this.status < 300
      this._headers = new Map(Object.entries(init.headers || {}))
      this.headers = {
        get: (name) => this._headers.get(name.toLowerCase()) || this._headers.get(name) || null,
        has: (name) => this._headers.has(name.toLowerCase()) || this._headers.has(name),
        forEach: (cb) => this._headers.forEach(cb),
        entries: () => this._headers.entries(),
      }
    }

    async json() {
      return typeof this.body === 'string' ? JSON.parse(this.body) : this.body
    }

    async text() {
      return typeof this.body === 'string' ? this.body : JSON.stringify(this.body)
    }

    clone() {
      const cloned = new Response(this.body, {
        status: this.status,
        statusText: this.statusText,
        headers: Object.fromEntries(this._headers),
      })
      return cloned
    }

    async arrayBuffer() {
      const text = typeof this.body === 'string' ? this.body : JSON.stringify(this.body)
      const encoder = new TextEncoder()
      return encoder.encode(text).buffer
    }

    async blob() {
      const text = typeof this.body === 'string' ? this.body : JSON.stringify(this.body)
      return new Blob([text])
    }
  }
}

// Global fetch mock - returns a resolved Response with ok:true by default
// Individual test files can override with their own global.fetch = jest.fn() assignments
if (!global.fetch || !global.fetch._isMockFunction) {
  global.fetch = jest.fn(() =>
    Promise.resolve(
      new (global.Response || Response)(JSON.stringify({}), {
        status: 200,
        statusText: 'OK',
      })
    )
  )
}
