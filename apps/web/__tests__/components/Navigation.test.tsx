/**
 * Unit tests for Navigation Component
 *
 * Tests the navigation bar:
 * - Rendering navigation items
 * - Active link highlighting
 * - Routing integration with Next.js
 * - Responsive layout
 * - Navigation item styling
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Navigation } from '@/components/navigation';
import { usePathname } from 'next/navigation';

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));

// Mock Next.js Link component
jest.mock('next/link', () => {
  return ({ children, href, className, ...props }: any) => {
    return (
      <a href={href} className={className} {...props}>
        {children}
      </a>
    );
  };
});

describe('Navigation Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render navigation bar', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      render(<Navigation />);

      const nav = screen.getByRole('navigation');
      expect(nav).toBeInTheDocument();
    });

    it('should render Perfana logo/brand', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      render(<Navigation />);

      const logo = screen.getByText('Perfana');
      expect(logo).toBeInTheDocument();
      expect(logo.closest('a')).toHaveAttribute('href', '/');
    });

    it('should render all navigation items', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      render(<Navigation />);

      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Test Runs')).toBeInTheDocument();
      expect(screen.getByText('Systems Under Test')).toBeInTheDocument();
    });

    it('should render navigation items as links', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      render(<Navigation />);

      const dashboardLink = screen.getByText('Dashboard').closest('a');
      const testRunsLink = screen.getByText('Test Runs').closest('a');
      const systemsLink = screen.getByText('Systems Under Test').closest('a');

      expect(dashboardLink).toHaveAttribute('href', '/');
      expect(testRunsLink).toHaveAttribute('href', '/test-runs');
      expect(systemsLink).toHaveAttribute('href', '/systems');
    });
  });

  describe('Active Link Highlighting', () => {
    it('should highlight Dashboard when on home page', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      render(<Navigation />);

      const dashboardLink = screen.getByText('Dashboard').closest('a');
      expect(dashboardLink).toHaveClass('text-blue-600');
      expect(dashboardLink).toHaveClass('bg-blue-50');
    });

    it('should highlight Test Runs when on test-runs page', () => {
      (usePathname as jest.Mock).mockReturnValue('/test-runs');

      render(<Navigation />);

      const testRunsLink = screen.getByText('Test Runs').closest('a');
      expect(testRunsLink).toHaveClass('text-blue-600');
      expect(testRunsLink).toHaveClass('bg-blue-50');
    });

    it('should highlight Systems when on systems page', () => {
      (usePathname as jest.Mock).mockReturnValue('/systems');

      render(<Navigation />);

      const systemsLink = screen.getByText('Systems Under Test').closest('a');
      expect(systemsLink).toHaveClass('text-blue-600');
      expect(systemsLink).toHaveClass('bg-blue-50');
    });

    it('should not highlight inactive links', () => {
      (usePathname as jest.Mock).mockReturnValue('/test-runs');

      render(<Navigation />);

      const dashboardLink = screen.getByText('Dashboard').closest('a');
      const systemsLink = screen.getByText('Systems Under Test').closest('a');

      expect(dashboardLink).toHaveClass('text-gray-700');
      expect(dashboardLink).not.toHaveClass('text-blue-600');
      expect(dashboardLink).not.toHaveClass('bg-blue-50');

      expect(systemsLink).toHaveClass('text-gray-700');
      expect(systemsLink).not.toHaveClass('text-blue-600');
      expect(systemsLink).not.toHaveClass('bg-blue-50');
    });

    it('should only highlight one link at a time', () => {
      (usePathname as jest.Mock).mockReturnValue('/test-runs');

      render(<Navigation />);

      const dashboardLink = screen.getByText('Dashboard').closest('a');
      const testRunsLink = screen.getByText('Test Runs').closest('a');
      const systemsLink = screen.getByText('Systems Under Test').closest('a');

      // Only test-runs should be highlighted
      expect(dashboardLink).not.toHaveClass('text-blue-600');
      expect(testRunsLink).toHaveClass('text-blue-600');
      expect(systemsLink).not.toHaveClass('text-blue-600');
    });
  });

  describe('Navigation Structure', () => {
    it('should render in correct order', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      render(<Navigation />);

      const links = screen.getAllByRole('link');
      const navLinks = links.filter((link) =>
        ['Dashboard', 'Test Runs', 'Systems Under Test'].includes(link.textContent || '')
      );

      expect(navLinks[0]).toHaveTextContent('Dashboard');
      expect(navLinks[1]).toHaveTextContent('Test Runs');
      expect(navLinks[2]).toHaveTextContent('Systems Under Test');
    });

    it('should contain logo link separate from nav items', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      render(<Navigation />);

      const allLinks = screen.getAllByRole('link');
      const logoLinks = allLinks.filter((link) => link.textContent === 'Perfana');

      expect(logoLinks).toHaveLength(1);
      expect(logoLinks[0]).toHaveAttribute('href', '/');
    });
  });

  describe('Responsive Layout', () => {
    it('should have responsive container classes', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      const { container } = render(<Navigation />);

      const navContainer = container.querySelector('.container');
      expect(navContainer).toBeInTheDocument();
      expect(navContainer).toHaveClass('mx-auto');
    });

    it('should hide navigation items on mobile with md breakpoint', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      const { container } = render(<Navigation />);

      const navItemsContainer = container.querySelector('.md\\:flex');
      expect(navItemsContainer).toBeInTheDocument();
      expect(navItemsContainer).toHaveClass('hidden');
    });

    it('should show navigation items on desktop', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      const { container } = render(<Navigation />);

      const navItemsContainer = container.querySelector('.md\\:flex');
      expect(navItemsContainer).toHaveClass('md:flex');
    });
  });

  describe('Styling', () => {
    it('should apply base styles to navigation bar', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      render(<Navigation />);

      const nav = screen.getByRole('navigation');
      expect(nav).toHaveClass('bg-white');
      expect(nav).toHaveClass('border-b');
      expect(nav).toHaveClass('border-gray-200');
    });

    it('should apply correct styles to active link', () => {
      (usePathname as jest.Mock).mockReturnValue('/test-runs');

      render(<Navigation />);

      const activeLink = screen.getByText('Test Runs').closest('a');
      expect(activeLink).toHaveClass('px-3');
      expect(activeLink).toHaveClass('py-2');
      expect(activeLink).toHaveClass('text-sm');
      expect(activeLink).toHaveClass('font-medium');
      expect(activeLink).toHaveClass('rounded-md');
      expect(activeLink).toHaveClass('text-blue-600');
      expect(activeLink).toHaveClass('bg-blue-50');
    });

    it('should apply correct styles to inactive links', () => {
      (usePathname as jest.Mock).mockReturnValue('/test-runs');

      render(<Navigation />);

      const inactiveLink = screen.getByText('Dashboard').closest('a');
      expect(inactiveLink).toHaveClass('px-3');
      expect(inactiveLink).toHaveClass('py-2');
      expect(inactiveLink).toHaveClass('text-sm');
      expect(inactiveLink).toHaveClass('font-medium');
      expect(inactiveLink).toHaveClass('rounded-md');
      expect(inactiveLink).toHaveClass('text-gray-700');
      expect(inactiveLink).toHaveClass('hover:text-blue-600');
      expect(inactiveLink).toHaveClass('hover:bg-gray-50');
    });

    it('should apply logo styles', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      render(<Navigation />);

      const logo = screen.getByText('Perfana');
      expect(logo).toHaveClass('text-xl');
      expect(logo).toHaveClass('font-bold');
      expect(logo).toHaveClass('text-gray-900');
    });
  });

  describe('Pathname Variations', () => {
    it('should handle root path', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      render(<Navigation />);

      const dashboardLink = screen.getByText('Dashboard').closest('a');
      expect(dashboardLink).toHaveClass('text-blue-600');
    });

    it('should handle nested paths', () => {
      (usePathname as jest.Mock).mockReturnValue('/test-runs/123');

      render(<Navigation />);

      // Should not highlight Test Runs for nested path
      const testRunsLink = screen.getByText('Test Runs').closest('a');
      expect(testRunsLink).not.toHaveClass('text-blue-600');
    });

    it('should handle exact path matching', () => {
      (usePathname as jest.Mock).mockReturnValue('/test-runs');

      render(<Navigation />);

      const testRunsLink = screen.getByText('Test Runs').closest('a');
      expect(testRunsLink).toHaveClass('text-blue-600');
    });

    it('should handle unknown paths', () => {
      (usePathname as jest.Mock).mockReturnValue('/unknown-page');

      render(<Navigation />);

      const dashboardLink = screen.getByText('Dashboard').closest('a');
      const testRunsLink = screen.getByText('Test Runs').closest('a');
      const systemsLink = screen.getByText('Systems Under Test').closest('a');

      // No links should be highlighted
      expect(dashboardLink).not.toHaveClass('text-blue-600');
      expect(testRunsLink).not.toHaveClass('text-blue-600');
      expect(systemsLink).not.toHaveClass('text-blue-600');
    });
  });

  describe('Link Attributes', () => {
    it('should have correct href attributes', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      render(<Navigation />);

      const links = {
        'Dashboard': '/',
        'Test Runs': '/test-runs',
        'Systems Under Test': '/systems',
      };

      Object.entries(links).forEach(([text, href]) => {
        const link = screen.getByText(text).closest('a');
        expect(link).toHaveAttribute('href', href);
      });
    });

    it('should render as anchor tags', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      render(<Navigation />);

      const dashboardLink = screen.getByText('Dashboard').closest('a');
      expect(dashboardLink?.tagName).toBe('A');
    });
  });

  describe('Re-rendering on Pathname Change', () => {
    it('should update active link when pathname changes', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      const { rerender } = render(<Navigation />);

      // Initially Dashboard is active
      let dashboardLink = screen.getByText('Dashboard').closest('a');
      expect(dashboardLink).toHaveClass('text-blue-600');

      // Change pathname
      (usePathname as jest.Mock).mockReturnValue('/test-runs');
      rerender(<Navigation />);

      // Now Test Runs should be active
      const testRunsLink = screen.getByText('Test Runs').closest('a');
      dashboardLink = screen.getByText('Dashboard').closest('a');

      expect(testRunsLink).toHaveClass('text-blue-600');
      expect(dashboardLink).not.toHaveClass('text-blue-600');
    });
  });

  describe('Navigation Items Count', () => {
    it('should render exactly 3 navigation items', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      render(<Navigation />);

      const navItems = ['Dashboard', 'Test Runs', 'Systems Under Test'];
      navItems.forEach((item) => {
        expect(screen.getByText(item)).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('should use semantic nav element', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      render(<Navigation />);

      const nav = screen.getByRole('navigation');
      expect(nav).toBeInTheDocument();
    });

    it('should render links with proper semantics', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      render(<Navigation />);

      const links = screen.getAllByRole('link');
      expect(links.length).toBeGreaterThan(0);
    });

    it('should have text content for all links', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      render(<Navigation />);

      const dashboardLink = screen.getByText('Dashboard');
      const testRunsLink = screen.getByText('Test Runs');
      const systemsLink = screen.getByText('Systems Under Test');

      expect(dashboardLink).toBeVisible();
      expect(testRunsLink).toBeVisible();
      expect(systemsLink).toBeVisible();
    });
  });

  describe('Layout Structure', () => {
    it('should have proper container hierarchy', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      const { container } = render(<Navigation />);

      const nav = container.querySelector('nav');
      const innerContainer = nav?.querySelector('.container');
      const flexContainer = innerContainer?.querySelector('.flex');

      expect(nav).toBeInTheDocument();
      expect(innerContainer).toBeInTheDocument();
      expect(flexContainer).toBeInTheDocument();
    });

    it('should separate logo and nav items with flex', () => {
      (usePathname as jest.Mock).mockReturnValue('/');

      const { container } = render(<Navigation />);

      const flexContainer = container.querySelector('.flex.items-center.space-x-8');
      expect(flexContainer).toBeInTheDocument();
    });
  });
});
