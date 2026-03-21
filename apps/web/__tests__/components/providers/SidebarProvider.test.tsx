/**
 * Unit tests for SidebarProvider Context
 *
 * Tests the sidebar context provider:
 * - Context value initialization
 * - Toggle, open, and close operations
 * - Window resize handling and mobile detection
 * - Auto-close on mobile
 * - useSidebar hook validation
 * - Context provider cleanup
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SidebarProvider, useSidebar } from '@/contexts/sidebar-context';

// Test component that uses the useSidebar hook
function TestComponent() {
  const { isOpen, isMobile, toggle, open, close } = useSidebar();

  return (
    <div>
      <div data-testid="is-open">{isOpen ? 'open' : 'closed'}</div>
      <div data-testid="is-mobile">{isMobile ? 'mobile' : 'desktop'}</div>
      <button onClick={toggle} data-testid="toggle-btn">
        Toggle
      </button>
      <button onClick={open} data-testid="open-btn">
        Open
      </button>
      <button onClick={close} data-testid="close-btn">
        Close
      </button>
    </div>
  );
}

describe('SidebarProvider', () => {
  // Store original window.innerWidth
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    // Reset window.innerWidth before each test
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });
  });

  afterEach(() => {
    // Restore original window.innerWidth
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    });
  });

  describe('Initial State', () => {
    it('should render children', () => {
      render(
        <SidebarProvider>
          <div>Test Content</div>
        </SidebarProvider>
      );

      expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('should initialize with sidebar open on desktop', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1024,
      });

      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      expect(screen.getByTestId('is-open')).toHaveTextContent('open');
      expect(screen.getByTestId('is-mobile')).toHaveTextContent('desktop');
    });

    it('should initialize with sidebar closed on mobile', async () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 500,
      });

      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-open')).toHaveTextContent('closed');
      });

      expect(screen.getByTestId('is-mobile')).toHaveTextContent('mobile');
    });
  });

  describe('Toggle Functionality', () => {
    it('should toggle sidebar from open to closed', () => {
      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      expect(screen.getByTestId('is-open')).toHaveTextContent('open');

      const toggleBtn = screen.getByTestId('toggle-btn');
      fireEvent.click(toggleBtn);

      expect(screen.getByTestId('is-open')).toHaveTextContent('closed');
    });

    it('should toggle sidebar from closed to open', () => {
      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      const toggleBtn = screen.getByTestId('toggle-btn');

      // Close first
      fireEvent.click(toggleBtn);
      expect(screen.getByTestId('is-open')).toHaveTextContent('closed');

      // Toggle back to open
      fireEvent.click(toggleBtn);
      expect(screen.getByTestId('is-open')).toHaveTextContent('open');
    });

    it('should toggle multiple times', () => {
      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      const toggleBtn = screen.getByTestId('toggle-btn');

      // Start: open
      expect(screen.getByTestId('is-open')).toHaveTextContent('open');

      // Toggle 1: closed
      fireEvent.click(toggleBtn);
      expect(screen.getByTestId('is-open')).toHaveTextContent('closed');

      // Toggle 2: open
      fireEvent.click(toggleBtn);
      expect(screen.getByTestId('is-open')).toHaveTextContent('open');

      // Toggle 3: closed
      fireEvent.click(toggleBtn);
      expect(screen.getByTestId('is-open')).toHaveTextContent('closed');
    });
  });

  describe('Open Functionality', () => {
    it('should open sidebar when closed', () => {
      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      // Close first
      const toggleBtn = screen.getByTestId('toggle-btn');
      fireEvent.click(toggleBtn);
      expect(screen.getByTestId('is-open')).toHaveTextContent('closed');

      // Now open
      const openBtn = screen.getByTestId('open-btn');
      fireEvent.click(openBtn);
      expect(screen.getByTestId('is-open')).toHaveTextContent('open');
    });

    it('should keep sidebar open when already open', () => {
      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      // Already open
      expect(screen.getByTestId('is-open')).toHaveTextContent('open');

      // Click open again
      const openBtn = screen.getByTestId('open-btn');
      fireEvent.click(openBtn);

      // Should still be open
      expect(screen.getByTestId('is-open')).toHaveTextContent('open');
    });
  });

  describe('Close Functionality', () => {
    it('should close sidebar when open', () => {
      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      expect(screen.getByTestId('is-open')).toHaveTextContent('open');

      const closeBtn = screen.getByTestId('close-btn');
      fireEvent.click(closeBtn);

      expect(screen.getByTestId('is-open')).toHaveTextContent('closed');
    });

    it('should keep sidebar closed when already closed', () => {
      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      // Close first
      const toggleBtn = screen.getByTestId('toggle-btn');
      fireEvent.click(toggleBtn);
      expect(screen.getByTestId('is-open')).toHaveTextContent('closed');

      // Click close again
      const closeBtn = screen.getByTestId('close-btn');
      fireEvent.click(closeBtn);

      // Should still be closed
      expect(screen.getByTestId('is-open')).toHaveTextContent('closed');
    });
  });

  describe('Window Resize Handling', () => {
    it('should detect desktop size on resize', async () => {
      // Start mobile
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 500,
      });

      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-mobile')).toHaveTextContent('mobile');
      });

      // Resize to desktop
      act(() => {
        Object.defineProperty(window, 'innerWidth', {
          writable: true,
          configurable: true,
          value: 1024,
        });
        window.dispatchEvent(new Event('resize'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-mobile')).toHaveTextContent('desktop');
      });
    });

    it('should detect mobile size on resize', async () => {
      // Start desktop
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1024,
      });

      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      expect(screen.getByTestId('is-mobile')).toHaveTextContent('desktop');
      expect(screen.getByTestId('is-open')).toHaveTextContent('open');

      // Resize to mobile
      act(() => {
        Object.defineProperty(window, 'innerWidth', {
          writable: true,
          configurable: true,
          value: 500,
        });
        window.dispatchEvent(new Event('resize'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-mobile')).toHaveTextContent('mobile');
      });
    });

    it('should auto-close sidebar when resizing to mobile while open', async () => {
      // Start desktop with sidebar open
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1024,
      });

      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      expect(screen.getByTestId('is-open')).toHaveTextContent('open');

      // Resize to mobile
      act(() => {
        Object.defineProperty(window, 'innerWidth', {
          writable: true,
          configurable: true,
          value: 500,
        });
        window.dispatchEvent(new Event('resize'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-open')).toHaveTextContent('closed');
      });
    });

    it('should not auto-close sidebar on mobile if already closed', async () => {
      // Start desktop
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1024,
      });

      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      // Close sidebar first
      const closeBtn = screen.getByTestId('close-btn');
      fireEvent.click(closeBtn);
      expect(screen.getByTestId('is-open')).toHaveTextContent('closed');

      // Resize to mobile
      act(() => {
        Object.defineProperty(window, 'innerWidth', {
          writable: true,
          configurable: true,
          value: 500,
        });
        window.dispatchEvent(new Event('resize'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-mobile')).toHaveTextContent('mobile');
      });

      // Should remain closed
      expect(screen.getByTestId('is-open')).toHaveTextContent('closed');
    });

    it('should handle multiple resize events', async () => {
      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      // Resize to mobile
      act(() => {
        Object.defineProperty(window, 'innerWidth', {
          writable: true,
          configurable: true,
          value: 500,
        });
        window.dispatchEvent(new Event('resize'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-mobile')).toHaveTextContent('mobile');
      });

      // Resize back to desktop
      act(() => {
        Object.defineProperty(window, 'innerWidth', {
          writable: true,
          configurable: true,
          value: 1024,
        });
        window.dispatchEvent(new Event('resize'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-mobile')).toHaveTextContent('desktop');
      });

      // Resize to mobile again
      act(() => {
        Object.defineProperty(window, 'innerWidth', {
          writable: true,
          configurable: true,
          value: 600,
        });
        window.dispatchEvent(new Event('resize'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-mobile')).toHaveTextContent('mobile');
      });
    });

    it('should use 768px as mobile breakpoint', async () => {
      // Just below breakpoint (767px) - mobile
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 767,
      });

      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-mobile')).toHaveTextContent('mobile');
      });
    });

    it('should treat 768px as desktop', async () => {
      // At breakpoint (768px) - desktop
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 768,
      });

      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-mobile')).toHaveTextContent('desktop');
      });
    });
  });

  describe('useSidebar Hook', () => {
    it('should throw error when used outside SidebarProvider', () => {
      // Suppress console.error for this test
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<TestComponent />);
      }).toThrow('useSidebar must be used within a SidebarProvider');

      consoleError.mockRestore();
    });

    it('should provide all context values', () => {
      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      expect(screen.getByTestId('is-open')).toBeInTheDocument();
      expect(screen.getByTestId('is-mobile')).toBeInTheDocument();
      expect(screen.getByTestId('toggle-btn')).toBeInTheDocument();
      expect(screen.getByTestId('open-btn')).toBeInTheDocument();
      expect(screen.getByTestId('close-btn')).toBeInTheDocument();
    });
  });

  describe('Event Listener Cleanup', () => {
    it('should remove resize event listener on unmount', () => {
      const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener');

      const { unmount } = render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });

    it('should add resize event listener on mount', () => {
      const addEventListenerSpy = jest.spyOn(window, 'addEventListener');

      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      expect(addEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));

      addEventListenerSpy.mockRestore();
    });
  });

  describe('State Persistence Across Operations', () => {
    it('should maintain state after multiple operations', () => {
      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      const toggleBtn = screen.getByTestId('toggle-btn');
      const openBtn = screen.getByTestId('open-btn');
      const closeBtn = screen.getByTestId('close-btn');

      // Initial: open
      expect(screen.getByTestId('is-open')).toHaveTextContent('open');

      // Close
      fireEvent.click(closeBtn);
      expect(screen.getByTestId('is-open')).toHaveTextContent('closed');

      // Open
      fireEvent.click(openBtn);
      expect(screen.getByTestId('is-open')).toHaveTextContent('open');

      // Toggle to closed
      fireEvent.click(toggleBtn);
      expect(screen.getByTestId('is-open')).toHaveTextContent('closed');

      // Toggle to open
      fireEvent.click(toggleBtn);
      expect(screen.getByTestId('is-open')).toHaveTextContent('open');
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid toggle clicks', () => {
      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      const toggleBtn = screen.getByTestId('toggle-btn');

      // Rapid clicks
      fireEvent.click(toggleBtn);
      fireEvent.click(toggleBtn);
      fireEvent.click(toggleBtn);
      fireEvent.click(toggleBtn);
      fireEvent.click(toggleBtn);

      // Should end up closed (started open, clicked 5 times)
      expect(screen.getByTestId('is-open')).toHaveTextContent('closed');
    });

    it('should handle window resize to same size category', async () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1024,
      });

      render(
        <SidebarProvider>
          <TestComponent />
        </SidebarProvider>
      );

      expect(screen.getByTestId('is-mobile')).toHaveTextContent('desktop');

      // Resize within desktop range
      act(() => {
        Object.defineProperty(window, 'innerWidth', {
          writable: true,
          configurable: true,
          value: 1200,
        });
        window.dispatchEvent(new Event('resize'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('is-mobile')).toHaveTextContent('desktop');
      });
    });
  });
});
