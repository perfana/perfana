/**
 * Unit tests for AppShell Component
 *
 * Tests the main application shell layout:
 * - Sidebar integration
 * - Main content area rendering
 * - Responsive layout transitions
 * - Content area width adjustments based on sidebar state
 * - Children rendering
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AppShell } from '@/components/layout/app-shell';

// Mock the sidebar component
jest.mock('@/components/layout/sidebar', () => ({
  Sidebar: () => <div data-testid="mock-sidebar">Sidebar</div>,
}));

// Mock the sidebar context
const mockUseSidebar = jest.fn();

jest.mock('@/contexts/sidebar-context', () => ({
  useSidebar: () => mockUseSidebar(),
}));

// Mock cn utility
jest.mock('@/lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

describe('AppShell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render sidebar component', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      render(
        <AppShell>
          <div>Content</div>
        </AppShell>
      );

      expect(screen.getByTestId('mock-sidebar')).toBeInTheDocument();
    });

    it('should render children content', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      render(
        <AppShell>
          <div data-testid="test-content">Test Content</div>
        </AppShell>
      );

      expect(screen.getByTestId('test-content')).toBeInTheDocument();
      expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('should render multiple children', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      render(
        <AppShell>
          <div data-testid="child-1">Child 1</div>
          <div data-testid="child-2">Child 2</div>
          <div data-testid="child-3">Child 3</div>
        </AppShell>
      );

      expect(screen.getByTestId('child-1')).toBeInTheDocument();
      expect(screen.getByTestId('child-2')).toBeInTheDocument();
      expect(screen.getByTestId('child-3')).toBeInTheDocument();
    });

    it('should wrap children in main content area', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      const { container } = render(
        <AppShell>
          <div data-testid="test-content">Content</div>
        </AppShell>
      );

      const mainContent = container.querySelector('.main-content');
      expect(mainContent).toBeInTheDocument();

      const contentArea = container.querySelector('.content-area');
      expect(contentArea).toBeInTheDocument();
    });
  });

  describe('Layout Structure', () => {
    it('should have app-shell wrapper class', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      const { container } = render(
        <AppShell>
          <div>Content</div>
        </AppShell>
      );

      const appShell = container.querySelector('.app-shell');
      expect(appShell).toBeInTheDocument();
    });

    it('should have main-content class on content wrapper', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      const { container } = render(
        <AppShell>
          <div>Content</div>
        </AppShell>
      );

      const mainContent = container.querySelector('.main-content');
      expect(mainContent).toBeInTheDocument();
      expect(mainContent).toHaveClass('main-content');
    });

    it('should have content-area class on inner wrapper', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      const { container } = render(
        <AppShell>
          <div>Content</div>
        </AppShell>
      );

      const contentArea = container.querySelector('.content-area');
      expect(contentArea).toBeInTheDocument();
      expect(contentArea).toHaveClass('content-area');
    });
  });

  describe('Sidebar State - Desktop', () => {
    it('should not apply collapsed class when sidebar is open on desktop', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      const { container } = render(
        <AppShell>
          <div>Content</div>
        </AppShell>
      );

      const mainContent = container.querySelector('.main-content');
      expect(mainContent).not.toHaveClass('main-content-collapsed');
    });

    it('should apply collapsed class when sidebar is closed on desktop', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: false,
        isMobile: false,
      });

      const { container } = render(
        <AppShell>
          <div>Content</div>
        </AppShell>
      );

      const mainContent = container.querySelector('.main-content');
      expect(mainContent).toHaveClass('main-content-collapsed');
    });

    it('should have transition classes for smooth animations', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      const { container } = render(
        <AppShell>
          <div>Content</div>
        </AppShell>
      );

      const mainContent = container.querySelector('.main-content');
      expect(mainContent).toHaveClass('transition-all');
      expect(mainContent).toHaveClass('duration-300');
      expect(mainContent).toHaveClass('ease-in-out');
    });
  });

  describe('Sidebar State - Mobile', () => {
    it('should not apply collapsed class on mobile regardless of sidebar state', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: false,
        isMobile: true,
      });

      const { container } = render(
        <AppShell>
          <div>Content</div>
        </AppShell>
      );

      const mainContent = container.querySelector('.main-content');
      expect(mainContent).not.toHaveClass('main-content-collapsed');
    });

    it('should not apply collapsed class when sidebar is open on mobile', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: true,
      });

      const { container } = render(
        <AppShell>
          <div>Content</div>
        </AppShell>
      );

      const mainContent = container.querySelector('.main-content');
      expect(mainContent).not.toHaveClass('main-content-collapsed');
    });
  });

  describe('Content Rendering', () => {
    it('should render text content correctly', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      render(
        <AppShell>
          <p>This is test content</p>
        </AppShell>
      );

      expect(screen.getByText('This is test content')).toBeInTheDocument();
    });

    it('should render complex nested components', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      const ComplexComponent = () => (
        <div>
          <header data-testid="header">Header</header>
          <main data-testid="main">
            <section>Section 1</section>
            <section>Section 2</section>
          </main>
          <footer data-testid="footer">Footer</footer>
        </div>
      );

      render(
        <AppShell>
          <ComplexComponent />
        </AppShell>
      );

      expect(screen.getByTestId('header')).toBeInTheDocument();
      expect(screen.getByTestId('main')).toBeInTheDocument();
      expect(screen.getByTestId('footer')).toBeInTheDocument();
      expect(screen.getByText('Section 1')).toBeInTheDocument();
      expect(screen.getByText('Section 2')).toBeInTheDocument();
    });

    it('should render null children without errors', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      expect(() => {
        render(
          <AppShell>
            {null}
          </AppShell>
        );
      }).not.toThrow();
    });

    it('should render conditional content', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      const showContent = true;

      render(
        <AppShell>
          {showContent && <div data-testid="conditional">Conditional Content</div>}
        </AppShell>
      );

      expect(screen.getByTestId('conditional')).toBeInTheDocument();
    });
  });

  describe('State Transitions', () => {
    it('should update layout when sidebar state changes from open to closed', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      const { container, rerender } = render(
        <AppShell>
          <div>Content</div>
        </AppShell>
      );

      let mainContent = container.querySelector('.main-content');
      expect(mainContent).not.toHaveClass('main-content-collapsed');

      // Update to closed state
      mockUseSidebar.mockReturnValue({
        isOpen: false,
        isMobile: false,
      });

      rerender(
        <AppShell>
          <div>Content</div>
        </AppShell>
      );

      mainContent = container.querySelector('.main-content');
      expect(mainContent).toHaveClass('main-content-collapsed');
    });

    it('should update layout when changing from desktop to mobile', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: false,
        isMobile: false,
      });

      const { container, rerender } = render(
        <AppShell>
          <div>Content</div>
        </AppShell>
      );

      let mainContent = container.querySelector('.main-content');
      expect(mainContent).toHaveClass('main-content-collapsed');

      // Update to mobile
      mockUseSidebar.mockReturnValue({
        isOpen: false,
        isMobile: true,
      });

      rerender(
        <AppShell>
          <div>Content</div>
        </AppShell>
      );

      mainContent = container.querySelector('.main-content');
      expect(mainContent).not.toHaveClass('main-content-collapsed');
    });
  });

  describe('Responsive Behavior', () => {
    it('should handle desktop viewport correctly', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      const { container } = render(
        <AppShell>
          <div>Desktop Content</div>
        </AppShell>
      );

      const mainContent = container.querySelector('.main-content');
      expect(mainContent).toBeInTheDocument();
      expect(screen.getByText('Desktop Content')).toBeInTheDocument();
    });

    it('should handle mobile viewport correctly', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: true,
      });

      const { container } = render(
        <AppShell>
          <div>Mobile Content</div>
        </AppShell>
      );

      const mainContent = container.querySelector('.main-content');
      expect(mainContent).toBeInTheDocument();
      expect(screen.getByText('Mobile Content')).toBeInTheDocument();
    });
  });

  describe('Integration', () => {
    it('should work with sidebar context correctly', () => {
      const contextValue = {
        isOpen: true,
        isMobile: false,
        toggle: jest.fn(),
        open: jest.fn(),
        close: jest.fn(),
      };

      mockUseSidebar.mockReturnValue(contextValue);

      const { container } = render(
        <AppShell>
          <div>Content</div>
        </AppShell>
      );

      const mainContent = container.querySelector('.main-content');
      expect(mainContent).not.toHaveClass('main-content-collapsed');
    });

    it('should maintain sidebar and content integration', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      render(
        <AppShell>
          <div data-testid="app-content">Application Content</div>
        </AppShell>
      );

      // Both sidebar and content should be present
      expect(screen.getByTestId('mock-sidebar')).toBeInTheDocument();
      expect(screen.getByTestId('app-content')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty children', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      const { container } = render(
        <AppShell>
          {/* Empty children */}
        </AppShell>
      );

      const contentArea = container.querySelector('.content-area');
      expect(contentArea).toBeInTheDocument();
    });

    it('should handle fragments as children', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      render(
        <AppShell>
          <>
            <div>Fragment Child 1</div>
            <div>Fragment Child 2</div>
          </>
        </AppShell>
      );

      expect(screen.getByText('Fragment Child 1')).toBeInTheDocument();
      expect(screen.getByText('Fragment Child 2')).toBeInTheDocument();
    });

    it('should handle mixed content types', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        isMobile: false,
      });

      render(
        <AppShell>
          Text content
          <div>Component content</div>
          {true && <span>Conditional content</span>}
        </AppShell>
      );

      expect(screen.getByText('Text content')).toBeInTheDocument();
      expect(screen.getByText('Component content')).toBeInTheDocument();
      expect(screen.getByText('Conditional content')).toBeInTheDocument();
    });
  });
});
