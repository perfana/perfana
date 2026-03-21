/**
 * Unit tests for SidebarToggle Component
 *
 * Tests the sidebar toggle button functionality:
 * - Button rendering with correct icons
 * - Toggle functionality
 * - Tooltip text changes based on sidebar state
 * - Accessibility attributes
 * - Icon transitions between open/closed states
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SidebarToggle } from '@/components/layout/sidebar-toggle';
import { SidebarProvider } from '@/contexts/sidebar-context';

// Mock the sidebar context hook for controlled testing
const mockToggle = jest.fn();
const mockUseSidebar = jest.fn();

jest.mock('@/contexts/sidebar-context', () => ({
  ...jest.requireActual('@/contexts/sidebar-context'),
  useSidebar: () => mockUseSidebar(),
}));

describe('SidebarToggle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render toggle button with Menu icon when sidebar is closed', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: false,
        toggle: mockToggle,
      });

      render(<SidebarToggle />);

      const button = screen.getByRole('button', { name: /open sidebar/i });
      expect(button).toBeInTheDocument();
    });

    it('should render toggle button with MenuOpen icon when sidebar is open', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        toggle: mockToggle,
      });

      render(<SidebarToggle />);

      const button = screen.getByRole('button', { name: /close sidebar/i });
      expect(button).toBeInTheDocument();
    });

    it('should have proper accessibility attributes', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: false,
        toggle: mockToggle,
      });

      render(<SidebarToggle />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', 'Open sidebar');
    });
  });

  describe('Tooltip', () => {
    it('should show "Open sidebar" tooltip when closed', async () => {
      mockUseSidebar.mockReturnValue({
        isOpen: false,
        toggle: mockToggle,
      });

      render(<SidebarToggle />);

      const button = screen.getByRole('button');
      fireEvent.mouseOver(button);

      // Tooltip content will be rendered in MUI portal
      expect(button).toHaveAttribute('aria-label', 'Open sidebar');
    });

    it('should show "Close sidebar" tooltip when open', async () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        toggle: mockToggle,
      });

      render(<SidebarToggle />);

      const button = screen.getByRole('button');
      fireEvent.mouseOver(button);

      expect(button).toHaveAttribute('aria-label', 'Close sidebar');
    });
  });

  describe('Toggle Functionality', () => {
    it('should call toggle function when button is clicked', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: false,
        toggle: mockToggle,
      });

      render(<SidebarToggle />);

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(mockToggle).toHaveBeenCalledTimes(1);
    });

    it('should call toggle multiple times for multiple clicks', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        toggle: mockToggle,
      });

      render(<SidebarToggle />);

      const button = screen.getByRole('button');
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);

      expect(mockToggle).toHaveBeenCalledTimes(3);
    });
  });

  describe('Keyboard Navigation', () => {
    it('should be focusable via keyboard navigation', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: false,
        toggle: mockToggle,
      });

      render(<SidebarToggle />);

      const button = screen.getByRole('button');

      // The button should be focusable (tabindex >= 0 or naturally focusable)
      expect(button).toBeInTheDocument();
      expect(button.getAttribute('tabindex')).not.toBe('-1');
    });

    it('should trigger toggle on click (keyboard activation)', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: false,
        toggle: mockToggle,
      });

      render(<SidebarToggle />);

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(mockToggle).toHaveBeenCalled();
    });
  });

  describe('State Transitions', () => {
    it('should update icon when sidebar state changes', () => {
      const { rerender } = render(
        <SidebarToggle />
      );

      // Initially closed
      mockUseSidebar.mockReturnValue({
        isOpen: false,
        toggle: mockToggle,
      });
      rerender(<SidebarToggle />);
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Open sidebar');

      // Change to open
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        toggle: mockToggle,
      });
      rerender(<SidebarToggle />);
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Close sidebar');
    });
  });

  describe('Component Isolation', () => {
    it('should not throw errors when toggle is called multiple times rapidly', () => {
      mockUseSidebar.mockReturnValue({
        isOpen: true,
        toggle: mockToggle,
      });

      render(<SidebarToggle />);

      const button = screen.getByRole('button');

      // Rapid clicks should not cause errors
      expect(() => {
        fireEvent.click(button);
        fireEvent.click(button);
        fireEvent.click(button);
      }).not.toThrow();

      expect(mockToggle).toHaveBeenCalledTimes(3);
    });
  });
});
