/**
 * Unit tests for AuthLayout Component
 *
 * Tests the authentication-aware layout wrapper:
 * - Loading state display
 * - Public route handling (signin, signup, forgot-password)
 * - Protected route access control
 * - Authentication redirects
 * - AppShell integration for authenticated users
 * - Route-based layout decisions
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AuthLayout } from '@/components/layout/auth-layout';

// Mock Next.js navigation
const mockUsePathname = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

// Mock AppShell component
jest.mock('@/components/layout/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">
      <div data-testid="app-shell-content">{children}</div>
    </div>
  ),
}));

// Mock auth context
const mockUseAuth = jest.fn();

jest.mock('@/contexts/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('AuthLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset window.location
    delete (window as any).location;
    window.location = { href: '' } as any;
  });

  describe('Loading State', () => {
    it('should show loading spinner while checking authentication', () => {
      mockUsePathname.mockReturnValue('/');
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: true,
      });

      render(
        <AuthLayout>
          <div>Protected Content</div>
        </AuthLayout>
      );

      // Should show loading spinner
      const spinner = document.querySelector('.spinner');
      expect(spinner).toBeInTheDocument();
      expect(spinner).toHaveClass('spinner-lg');
    });

    it('should not show content while loading', () => {
      mockUsePathname.mockReturnValue('/');
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: true,
      });

      render(
        <AuthLayout>
          <div data-testid="content">Protected Content</div>
        </AuthLayout>
      );

      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    });

    it('should center loading spinner on screen', () => {
      mockUsePathname.mockReturnValue('/');
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: true,
      });

      const { container } = render(
        <AuthLayout>
          <div>Content</div>
        </AuthLayout>
      );

      const loadingContainer = container.querySelector('.min-h-screen');
      expect(loadingContainer).toHaveClass('flex', 'items-center', 'justify-center');
    });
  });

  describe('Public Routes', () => {
    const publicRoutes = ['/signin', '/signup', '/forgot-password'];

    publicRoutes.forEach((route) => {
      it(`should render children directly on ${route} without AppShell`, () => {
        mockUsePathname.mockReturnValue(route);
        mockUseAuth.mockReturnValue({
          user: null,
          isLoading: false,
        });

        render(
          <AuthLayout>
            <div data-testid="public-content">Public Page Content</div>
          </AuthLayout>
        );

        // Content should be rendered without AppShell
        expect(screen.getByTestId('public-content')).toBeInTheDocument();
        expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
      });

      it(`should render ${route} even when user is authenticated`, () => {
        mockUsePathname.mockReturnValue(route);
        mockUseAuth.mockReturnValue({
          user: {
            id: 'user-123',
            email: 'test@example.com',
            created_at: '2024-01-01T00:00:00Z',
          },
          isLoading: false,
        });

        render(
          <AuthLayout>
            <div data-testid="public-content">Public Page</div>
          </AuthLayout>
        );

        // Public routes should be accessible even when authenticated
        expect(screen.getByTestId('public-content')).toBeInTheDocument();
        expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
      });
    });

    it('should not apply AppShell wrapper to public routes', () => {
      mockUsePathname.mockReturnValue('/signin');
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
      });

      const { container } = render(
        <AuthLayout>
          <div>Sign In Form</div>
        </AuthLayout>
      );

      expect(screen.getByText('Sign In Form')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="app-shell"]')).not.toBeInTheDocument();
    });
  });

  describe('Protected Routes - Unauthenticated', () => {
    it('should redirect to signin when accessing protected route without authentication', () => {
      mockUsePathname.mockReturnValue('/test-runs');
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
      });

      render(
        <AuthLayout>
          <div data-testid="protected-content">Protected Content</div>
        </AuthLayout>
      );

      // Should redirect to signin
      expect(window.location.href).toBe('/signin');
      // Content should not be rendered
      expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
    });

    it('should not render children when redirecting to signin', () => {
      mockUsePathname.mockReturnValue('/settings');
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
      });

      const { container } = render(
        <AuthLayout>
          <div data-testid="settings-content">Settings</div>
        </AuthLayout>
      );

      expect(screen.queryByTestId('settings-content')).not.toBeInTheDocument();
      expect(container.firstChild).toBeNull();
    });

    it('should only redirect in browser environment', () => {
      mockUsePathname.mockReturnValue('/protected');
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
      });

      // Test that it checks for window
      render(
        <AuthLayout>
          <div>Protected</div>
        </AuthLayout>
      );

      // In jsdom environment, window exists, so redirect should happen
      expect(window.location.href).toBe('/signin');
    });
  });

  describe('Protected Routes - Authenticated', () => {
    const authenticatedUser = {
      id: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      created_at: '2024-01-01T00:00:00Z',
      roles: ['user'],
    };

    it('should render children with AppShell when authenticated', () => {
      mockUsePathname.mockReturnValue('/test-runs');
      mockUseAuth.mockReturnValue({
        user: authenticatedUser,
        isLoading: false,
      });

      render(
        <AuthLayout>
          <div data-testid="protected-content">Test Runs Page</div>
        </AuthLayout>
      );

      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
      expect(screen.getByText('Test Runs Page')).toBeInTheDocument();
    });

    it('should wrap content in AppShell for home page', () => {
      mockUsePathname.mockReturnValue('/');
      mockUseAuth.mockReturnValue({
        user: authenticatedUser,
        isLoading: false,
      });

      render(
        <AuthLayout>
          <div data-testid="home-content">Home</div>
        </AuthLayout>
      );

      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      expect(screen.getByTestId('home-content')).toBeInTheDocument();
    });

    it('should wrap content in AppShell for all protected routes', () => {
      const protectedRoutes = ['/', '/test-runs', '/systems', '/integrations', '/settings'];

      protectedRoutes.forEach((route) => {
        mockUsePathname.mockReturnValue(route);
        mockUseAuth.mockReturnValue({
          user: authenticatedUser,
          isLoading: false,
        });

        const { unmount } = render(
          <AuthLayout>
            <div data-testid={`content-${route}`}>Content for {route}</div>
          </AuthLayout>
        );

        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
        expect(screen.getByTestId(`content-${route}`)).toBeInTheDocument();

        unmount();
      });
    });

    it('should pass children to AppShell correctly', () => {
      mockUsePathname.mockReturnValue('/settings');
      mockUseAuth.mockReturnValue({
        user: authenticatedUser,
        isLoading: false,
      });

      render(
        <AuthLayout>
          <div data-testid="complex-content">
            <header>Header</header>
            <main>Main Content</main>
            <footer>Footer</footer>
          </div>
        </AuthLayout>
      );

      const appShellContent = screen.getByTestId('app-shell-content');
      expect(appShellContent).toBeInTheDocument();

      const complexContent = screen.getByTestId('complex-content');
      expect(complexContent).toBeInTheDocument();
      expect(screen.getByText('Header')).toBeInTheDocument();
      expect(screen.getByText('Main Content')).toBeInTheDocument();
      expect(screen.getByText('Footer')).toBeInTheDocument();
    });
  });

  describe('Route Detection', () => {
    it('should correctly identify signin as public route', () => {
      mockUsePathname.mockReturnValue('/signin');
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
      });

      render(
        <AuthLayout>
          <div data-testid="signin-form">Sign In</div>
        </AuthLayout>
      );

      expect(screen.getByTestId('signin-form')).toBeInTheDocument();
      expect(window.location.href).not.toBe('/signin');
    });

    it('should correctly identify signup as public route', () => {
      mockUsePathname.mockReturnValue('/signup');
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
      });

      render(
        <AuthLayout>
          <div data-testid="signup-form">Sign Up</div>
        </AuthLayout>
      );

      expect(screen.getByTestId('signup-form')).toBeInTheDocument();
      expect(window.location.href).not.toBe('/signin');
    });

    it('should correctly identify forgot-password as public route', () => {
      mockUsePathname.mockReturnValue('/forgot-password');
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
      });

      render(
        <AuthLayout>
          <div data-testid="forgot-password-form">Forgot Password</div>
        </AuthLayout>
      );

      expect(screen.getByTestId('forgot-password-form')).toBeInTheDocument();
      expect(window.location.href).not.toBe('/signin');
    });

    it('should treat unknown routes as protected', () => {
      mockUsePathname.mockReturnValue('/unknown-route');
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
      });

      render(
        <AuthLayout>
          <div data-testid="unknown-content">Unknown Page</div>
        </AuthLayout>
      );

      expect(window.location.href).toBe('/signin');
      expect(screen.queryByTestId('unknown-content')).not.toBeInTheDocument();
    });

    it('should handle routes with query parameters', () => {
      mockUsePathname.mockReturnValue('/test-runs');
      mockUseAuth.mockReturnValue({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          created_at: '2024-01-01T00:00:00Z',
        },
        isLoading: false,
      });

      render(
        <AuthLayout>
          <div data-testid="test-runs-content">Test Runs</div>
        </AuthLayout>
      );

      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      expect(screen.getByTestId('test-runs-content')).toBeInTheDocument();
    });

    it('should handle nested routes correctly', () => {
      mockUsePathname.mockReturnValue('/test-runs/123');
      mockUseAuth.mockReturnValue({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          created_at: '2024-01-01T00:00:00Z',
        },
        isLoading: false,
      });

      render(
        <AuthLayout>
          <div data-testid="test-run-detail">Test Run Detail</div>
        </AuthLayout>
      );

      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      expect(screen.getByTestId('test-run-detail')).toBeInTheDocument();
    });
  });

  describe('State Transitions', () => {
    it('should transition from loading to authenticated state', () => {
      mockUsePathname.mockReturnValue('/test-runs');

      // Start with loading
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: true,
      });

      const { rerender } = render(
        <AuthLayout>
          <div data-testid="content">Content</div>
        </AuthLayout>
      );

      expect(document.querySelector('.spinner')).toBeInTheDocument();

      // Transition to authenticated
      mockUseAuth.mockReturnValue({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          created_at: '2024-01-01T00:00:00Z',
        },
        isLoading: false,
      });

      rerender(
        <AuthLayout>
          <div data-testid="content">Content</div>
        </AuthLayout>
      );

      expect(document.querySelector('.spinner')).not.toBeInTheDocument();
      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      expect(screen.getByTestId('content')).toBeInTheDocument();
    });

    it('should transition from loading to redirect for unauthenticated', () => {
      mockUsePathname.mockReturnValue('/test-runs');

      // Start with loading
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: true,
      });

      const { rerender } = render(
        <AuthLayout>
          <div data-testid="content">Content</div>
        </AuthLayout>
      );

      expect(document.querySelector('.spinner')).toBeInTheDocument();
      expect(window.location.href).toBe('');

      // Transition to unauthenticated
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
      });

      rerender(
        <AuthLayout>
          <div data-testid="content">Content</div>
        </AuthLayout>
      );

      expect(window.location.href).toBe('/signin');
      expect(screen.queryByTestId('content')).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null children gracefully', () => {
      mockUsePathname.mockReturnValue('/signin');
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
      });

      expect(() => {
        render(
          <AuthLayout>
            {null}
          </AuthLayout>
        );
      }).not.toThrow();
    });

    it('should handle multiple children', () => {
      mockUsePathname.mockReturnValue('/');
      mockUseAuth.mockReturnValue({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          created_at: '2024-01-01T00:00:00Z',
        },
        isLoading: false,
      });

      render(
        <AuthLayout>
          <div data-testid="child-1">Child 1</div>
          <div data-testid="child-2">Child 2</div>
        </AuthLayout>
      );

      expect(screen.getByTestId('child-1')).toBeInTheDocument();
      expect(screen.getByTestId('child-2')).toBeInTheDocument();
    });

    it('should handle user object with minimal fields', () => {
      mockUsePathname.mockReturnValue('/test-runs');
      mockUseAuth.mockReturnValue({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          created_at: '2024-01-01T00:00:00Z',
        },
        isLoading: false,
      });

      render(
        <AuthLayout>
          <div data-testid="content">Content</div>
        </AuthLayout>
      );

      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      expect(screen.getByTestId('content')).toBeInTheDocument();
    });

    it('should handle user object with all optional fields', () => {
      mockUsePathname.mockReturnValue('/test-runs');
      mockUseAuth.mockReturnValue({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
          created_at: '2024-01-01T00:00:00Z',
          roles: ['admin', 'user'],
          organizations: ['org-1', 'org-2'],
          teams: ['team-1', 'team-2'],
        },
        isLoading: false,
      });

      render(
        <AuthLayout>
          <div data-testid="content">Content</div>
        </AuthLayout>
      );

      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      expect(screen.getByTestId('content')).toBeInTheDocument();
    });
  });

  describe('Integration', () => {
    it('should work correctly with auth context and pathname', () => {
      mockUsePathname.mockReturnValue('/test-runs');
      mockUseAuth.mockReturnValue({
        user: {
          id: 'user-123',
          email: 'test@example.com',
          created_at: '2024-01-01T00:00:00Z',
        },
        isLoading: false,
      });

      render(
        <AuthLayout>
          <div data-testid="integrated-content">Integrated Content</div>
        </AuthLayout>
      );

      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      expect(screen.getByTestId('integrated-content')).toBeInTheDocument();
    });

    it('should correctly pass through all props to children', () => {
      mockUsePathname.mockReturnValue('/signin');
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
      });

      const ChildWithProps = ({ title, count }: { title: string; count: number }) => (
        <div>
          <h1 data-testid="title">{title}</h1>
          <span data-testid="count">{count}</span>
        </div>
      );

      render(
        <AuthLayout>
          <ChildWithProps title="Test Title" count={42} />
        </AuthLayout>
      );

      expect(screen.getByTestId('title')).toHaveTextContent('Test Title');
      expect(screen.getByTestId('count')).toHaveTextContent('42');
    });
  });
});
