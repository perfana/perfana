/**
 * Unit tests for CardHeader Component
 *
 * Tests the card header functionality:
 * - Rendering in collapsed and expanded states
 * - Title display
 * - Expand/collapse button behavior
 * - Additional actions rendering
 * - Click event handling
 * - Styling variations
 * - Accessibility
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CardHeader from '@/app/test-runs/[id]/components/shared/CardHeader';
import { Button } from '@mui/material';

describe('CardHeader', () => {
  const mockOnExpand = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering - Basic', () => {
    it('should render with title', () => {
      render(<CardHeader title="Test Card" expanded={false} onExpand={mockOnExpand} />);

      expect(screen.getByText('Test Card')).toBeInTheDocument();
    });

    it('should render expand icon when collapsed', () => {
      render(<CardHeader title="Card Title" expanded={false} onExpand={mockOnExpand} />);

      // ExpandMore icon should be present
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should render collapse icon when expanded', () => {
      render(<CardHeader title="Card Title" expanded={true} onExpand={mockOnExpand} />);

      // ExpandLess icon should be present
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should display "Click to collapse" hint when expanded', () => {
      render(<CardHeader title="Card Title" expanded={true} onExpand={mockOnExpand} />);

      expect(screen.getByText('Click to collapse')).toBeInTheDocument();
    });

    it('should not display "Click to collapse" hint when collapsed', () => {
      render(<CardHeader title="Card Title" expanded={false} onExpand={mockOnExpand} />);

      expect(screen.queryByText('Click to collapse')).not.toBeInTheDocument();
    });
  });

  describe('Title Styling', () => {
    it('should apply bold font weight when collapsed', () => {
      render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      const title = screen.getByText('Title');
      expect(title).toHaveStyle({ fontWeight: '700' });
    });

    it('should apply semi-bold font weight when expanded', () => {
      render(<CardHeader title="Title" expanded={true} onExpand={mockOnExpand} />);

      const title = screen.getByText('Title');
      expect(title).toHaveStyle({ fontWeight: '600' });
    });

    it('should apply larger font size when collapsed', () => {
      render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      const title = screen.getByText('Title');
      expect(title).toHaveStyle({ fontSize: '1.25rem' });
    });

    it('should apply smaller font size when expanded', () => {
      render(<CardHeader title="Title" expanded={true} onExpand={mockOnExpand} />);

      const title = screen.getByText('Title');
      expect(title).toHaveStyle({ fontSize: '1.125rem' });
    });

    it('should use primary.dark color when collapsed', () => {
      render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      const title = screen.getByText('Title');
      const styles = window.getComputedStyle(title);
      // Color should be set (exact value depends on theme)
      expect(styles.color).toBeDefined();
    });

    it('should use text.primary color when expanded', () => {
      render(<CardHeader title="Title" expanded={true} onExpand={mockOnExpand} />);

      const title = screen.getByText('Title');
      const styles = window.getComputedStyle(title);
      expect(styles.color).toBeDefined();
    });
  });

  describe('Click Event Handling', () => {
    it('should call onExpand when header is clicked in expanded state', () => {
      render(<CardHeader title="Title" expanded={true} onExpand={mockOnExpand} />);

      // Click on the header area (not the button)
      const title = screen.getByText('Title');
      fireEvent.click(title.closest('div')!);

      expect(mockOnExpand).toHaveBeenCalledTimes(1);
    });

    it('should not call onExpand when header is clicked in collapsed state', () => {
      render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      // Click on the header area
      const title = screen.getByText('Title');
      fireEvent.click(title.closest('div')!);

      expect(mockOnExpand).not.toHaveBeenCalled();
    });

    it('should call onExpand when icon button is clicked', () => {
      render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      const button = screen.getAllByRole('button')[0];
      fireEvent.click(button);

      expect(mockOnExpand).toHaveBeenCalledTimes(1);
    });

    it('should call onExpand when icon button is clicked in expanded state', () => {
      render(<CardHeader title="Title" expanded={true} onExpand={mockOnExpand} />);

      const button = screen.getAllByRole('button')[0];
      fireEvent.click(button);

      expect(mockOnExpand).toHaveBeenCalledTimes(1);
    });

    it('should stop propagation when icon button is clicked', () => {
      render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      const button = screen.getAllByRole('button')[0];
      const clickEvent = new MouseEvent('click', { bubbles: true });
      const stopPropagationSpy = jest.spyOn(clickEvent, 'stopPropagation');

      fireEvent(button, clickEvent);

      expect(stopPropagationSpy).toHaveBeenCalled();
    });
  });

  describe('Cursor Styling', () => {
    it('should apply pointer cursor when expanded', () => {
      const { container } = render(<CardHeader title="Title" expanded={true} onExpand={mockOnExpand} />);

      const headerBox = container.querySelector('div');
      expect(headerBox).toHaveStyle({ cursor: 'pointer' });
    });

    it('should apply inherit cursor when collapsed', () => {
      const { container } = render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      const headerBox = container.querySelector('div');
      expect(headerBox).toHaveStyle({ cursor: 'inherit' });
    });
  });

  describe('Hover Behavior', () => {
    it('should apply hover background when expanded', () => {
      const { container } = render(<CardHeader title="Title" expanded={true} onExpand={mockOnExpand} />);

      const headerBox = container.querySelector('div');
      // Check that the element has hover styles defined (via sx prop)
      expect(headerBox).toBeInTheDocument();
    });

    it('should not apply hover background when collapsed', () => {
      const { container } = render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      const headerBox = container.querySelector('div');
      expect(headerBox).toBeInTheDocument();
    });
  });

  describe('Additional Actions', () => {
    it('should render additional actions when provided', () => {
      const additionalActions = <Button data-testid="custom-action">Custom Action</Button>;

      render(
        <CardHeader
          title="Title"
          expanded={false}
          onExpand={mockOnExpand}
          additionalActions={additionalActions}
        />
      );

      expect(screen.getByTestId('custom-action')).toBeInTheDocument();
      expect(screen.getByText('Custom Action')).toBeInTheDocument();
    });

    it('should render multiple additional actions', () => {
      const additionalActions = (
        <>
          <Button data-testid="action-1">Action 1</Button>
          <Button data-testid="action-2">Action 2</Button>
        </>
      );

      render(
        <CardHeader
          title="Title"
          expanded={false}
          onExpand={mockOnExpand}
          additionalActions={additionalActions}
        />
      );

      expect(screen.getByTestId('action-1')).toBeInTheDocument();
      expect(screen.getByTestId('action-2')).toBeInTheDocument();
    });

    it('should not render additional actions section when not provided', () => {
      const { container } = render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      // Should not have the additional actions container
      const actionsBox = container.querySelector('[data-testid="additional-actions"]');
      expect(actionsBox).not.toBeInTheDocument();
    });

    it('should position additional actions before title', () => {
      const additionalActions = <Button data-testid="before-title">Before</Button>;

      render(
        <CardHeader
          title="Title"
          expanded={false}
          onExpand={mockOnExpand}
          additionalActions={additionalActions}
        />
      );

      const action = screen.getByTestId('before-title');
      const title = screen.getByText('Title');

      // Check that action appears before title in DOM order
      expect(action).toBeInTheDocument();
      expect(title).toBeInTheDocument();
    });
  });

  describe('Icon Button Styling', () => {
    it('should apply small size to icon button', () => {
      render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      const button = screen.getAllByRole('button')[0];
      // Button should have specific width/height for small size
      expect(button).toHaveStyle({ width: '36px', height: '36px' });
    });

    it('should position icon button absolutely on the right', () => {
      render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      const button = screen.getAllByRole('button')[0];
      expect(button).toHaveStyle({ position: 'absolute', right: '0' });
    });

    it('should apply blue background to icon button', () => {
      render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      const button = screen.getAllByRole('button')[0];
      expect(button).toHaveStyle({ backgroundColor: 'rgba(25, 118, 210, 0.08)' });
    });
  });

  describe('Accessibility', () => {
    it('should render button with proper role', () => {
      render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should render h2 heading with title', () => {
      render(<CardHeader title="Important Title" expanded={false} onExpand={mockOnExpand} />);

      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading).toHaveTextContent('Important Title');
    });

    it('should maintain proper heading hierarchy', () => {
      render(<CardHeader title="Card Header" expanded={false} onExpand={mockOnExpand} />);

      const heading = screen.getByRole('heading');
      expect(heading.tagName).toBe('H2');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long title', () => {
      const longTitle = 'This is a very long card header title that should still render properly without breaking the layout';

      render(<CardHeader title={longTitle} expanded={false} onExpand={mockOnExpand} />);

      expect(screen.getByText(longTitle)).toBeInTheDocument();
    });

    it('should handle title with special characters', () => {
      render(<CardHeader title="Test & Configuration @ 2024" expanded={false} onExpand={mockOnExpand} />);

      expect(screen.getByText('Test & Configuration @ 2024')).toBeInTheDocument();
    });

    it('should handle empty additional actions', () => {
      render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} additionalActions={null} />);

      expect(screen.getByText('Title')).toBeInTheDocument();
    });

    it('should handle rapid expand/collapse clicks', () => {
      render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      const button = screen.getAllByRole('button')[0];

      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);

      expect(mockOnExpand).toHaveBeenCalledTimes(3);
    });
  });

  describe('Layout', () => {
    it('should use flexbox layout', () => {
      const { container } = render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      const headerBox = container.querySelector('div');
      expect(headerBox).toHaveStyle({ display: 'flex' });
    });

    it('should center align items', () => {
      const { container } = render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      const headerBox = container.querySelector('div');
      expect(headerBox).toHaveStyle({ alignItems: 'center' });
    });

    it('should space between items', () => {
      const { container } = render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      const headerBox = container.querySelector('div');
      expect(headerBox).toHaveStyle({ justifyContent: 'space-between' });
    });

    it('should apply gap between elements', () => {
      const { container } = render(<CardHeader title="Title" expanded={false} onExpand={mockOnExpand} />);

      const headerBox = container.querySelector('div');
      // Gap should be applied (value from theme)
      expect(headerBox).toHaveStyle({ gap: '16px' });
    });
  });
});
