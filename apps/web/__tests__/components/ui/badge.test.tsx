import React from 'react';
import { render, screen } from '@testing-library/react';
import { Badge, StatusBadge } from '@/components/ui/badge';

describe('Badge Component', () => {
  describe('Basic Rendering', () => {
    it('should render a badge with children', () => {
      render(<Badge>Test Badge</Badge>);
      expect(screen.getByText('Test Badge')).toBeInTheDocument();
    });

    it('should render as a span element', () => {
      render(<Badge data-testid="badge">Test</Badge>);
      expect(screen.getByTestId('badge').tagName).toBe('SPAN');
    });

    it('should apply base badge class', () => {
      render(<Badge data-testid="badge">Test</Badge>);
      expect(screen.getByTestId('badge')).toHaveClass('badge');
    });

    it('should render with custom className', () => {
      render(<Badge className="custom-class" data-testid="badge">Test</Badge>);
      expect(screen.getByTestId('badge')).toHaveClass('badge', 'custom-class');
    });
  });

  describe('Variants', () => {
    const variants = [
      { variant: 'primary' as const, expectedClass: 'badge-primary' },
      { variant: 'success' as const, expectedClass: 'badge-success' },
      { variant: 'warning' as const, expectedClass: 'badge-warning' },
      { variant: 'error' as const, expectedClass: 'badge-error' },
      { variant: 'gray' as const, expectedClass: 'badge-gray' },
      { variant: 'performance-excellent' as const, expectedClass: 'badge-performance-excellent' },
      { variant: 'performance-good' as const, expectedClass: 'badge-performance-good' },
      { variant: 'performance-fair' as const, expectedClass: 'badge-performance-fair' },
      { variant: 'performance-poor' as const, expectedClass: 'badge-performance-poor' },
      { variant: 'performance-critical' as const, expectedClass: 'badge-performance-critical' },
    ];

    it.each(variants)('should apply $variant variant classes', ({ variant, expectedClass }) => {
      render(<Badge variant={variant} data-testid="badge">Test</Badge>);
      expect(screen.getByTestId('badge')).toHaveClass('badge', expectedClass);
    });

    it('should default to primary variant', () => {
      render(<Badge data-testid="badge">Test</Badge>);
      expect(screen.getByTestId('badge')).toHaveClass('badge-primary');
    });
  });

  describe('Sizes', () => {
    const sizes = [
      { size: 'sm' as const, expectedClass: 'badge-sm' },
      { size: 'base' as const, expectedClass: '' },
      { size: 'lg' as const, expectedClass: 'badge-lg' },
    ];

    it.each(sizes)('should apply correct classes for $size size', ({ size, expectedClass }) => {
      render(<Badge size={size} data-testid="badge">Test</Badge>);
      const badge = screen.getByTestId('badge');
      if (expectedClass) {
        expect(badge).toHaveClass(expectedClass);
      } else {
        expect(badge).not.toHaveClass('badge-sm', 'badge-lg');
      }
    });

    it('should default to base size', () => {
      render(<Badge data-testid="badge">Test</Badge>);
      const badge = screen.getByTestId('badge');
      expect(badge).not.toHaveClass('badge-sm', 'badge-lg');
    });
  });

  describe('Icons', () => {
    it('should render left icon when provided', () => {
      render(<Badge leftIcon={<span data-testid="left-icon">←</span>}>Test</Badge>);
      expect(screen.getByTestId('left-icon')).toBeInTheDocument();
    });

    it('should render right icon when provided', () => {
      render(<Badge rightIcon={<span data-testid="right-icon">→</span>}>Test</Badge>);
      expect(screen.getByTestId('right-icon')).toBeInTheDocument();
    });

    it('should render both icons when provided', () => {
      render(
        <Badge
          leftIcon={<span data-testid="left-icon">←</span>}
          rightIcon={<span data-testid="right-icon">→</span>}
        >
          Test
        </Badge>
      );
      expect(screen.getByTestId('left-icon')).toBeInTheDocument();
      expect(screen.getByTestId('right-icon')).toBeInTheDocument();
    });

    it('should not render icons when not provided', () => {
      render(<Badge>Test</Badge>);
      expect(screen.queryByTestId('left-icon')).not.toBeInTheDocument();
      expect(screen.queryByTestId('right-icon')).not.toBeInTheDocument();
    });
  });

  describe('HTML Attributes', () => {
    it('should accept onClick handler', () => {
      const handleClick = jest.fn();
      render(<Badge onClick={handleClick} data-testid="badge">Test</Badge>);
      screen.getByTestId('badge').click();
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should accept aria-label attribute', () => {
      render(<Badge aria-label="Status Badge" data-testid="badge">Test</Badge>);
      expect(screen.getByTestId('badge')).toHaveAttribute('aria-label', 'Status Badge');
    });

    it('should accept data attributes', () => {
      render(<Badge data-testid="custom-badge">Test</Badge>);
      expect(screen.getByTestId('custom-badge')).toBeInTheDocument();
    });

    it('should accept id attribute', () => {
      render(<Badge id="test-badge" data-testid="badge">Test</Badge>);
      expect(screen.getByTestId('badge')).toHaveAttribute('id', 'test-badge');
    });

    it('should accept title attribute', () => {
      render(<Badge title="Tooltip text" data-testid="badge">Test</Badge>);
      expect(screen.getByTestId('badge')).toHaveAttribute('title', 'Tooltip text');
    });
  });

  describe('Forward Ref', () => {
    it('should forward ref to span element', () => {
      const ref = React.createRef<HTMLSpanElement>();
      render(<Badge ref={ref}>Test</Badge>);
      expect(ref.current).toBeInstanceOf(HTMLSpanElement);
      expect(ref.current?.tagName).toBe('SPAN');
    });

    it('should allow ref methods to be called', () => {
      const ref = React.createRef<HTMLSpanElement>();
      render(<Badge ref={ref} tabIndex={0}>Test</Badge>);
      ref.current?.focus();
      expect(ref.current).toHaveFocus();
    });
  });

  describe('Variant and Size Combinations', () => {
    it('should combine variant and size classes correctly', () => {
      render(<Badge variant="success" size="lg" data-testid="badge">Test</Badge>);
      const badge = screen.getByTestId('badge');
      expect(badge).toHaveClass('badge', 'badge-success', 'badge-lg');
    });

    it('should combine performance variant with small size', () => {
      render(<Badge variant="performance-excellent" size="sm" data-testid="badge">Test</Badge>);
      const badge = screen.getByTestId('badge');
      expect(badge).toHaveClass('badge', 'badge-performance-excellent', 'badge-sm');
    });
  });

  describe('Content Rendering', () => {
    it('should render text content', () => {
      render(<Badge>Simple Text</Badge>);
      expect(screen.getByText('Simple Text')).toBeInTheDocument();
    });

    it('should render numeric content', () => {
      render(<Badge>42</Badge>);
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('should render nested elements', () => {
      render(
        <Badge>
          <span>Status: </span>
          <strong>Active</strong>
        </Badge>
      );
      expect(screen.getByText('Status:')).toBeInTheDocument();
      expect(screen.getByText('Active')).toBeInTheDocument();
    });
  });
});

describe('StatusBadge Component', () => {
  describe('Basic Rendering', () => {
    it('should render a status badge', () => {
      render(<StatusBadge status="excellent">Excellent</StatusBadge>);
      expect(screen.getByText('Excellent')).toBeInTheDocument();
    });

    it('should render as a span element', () => {
      render(<StatusBadge status="good" data-testid="status-badge">Good</StatusBadge>);
      expect(screen.getByTestId('status-badge').tagName).toBe('SPAN');
    });

    it('should render with custom className', () => {
      render(<StatusBadge status="excellent" className="custom-class" data-testid="status-badge">Test</StatusBadge>);
      expect(screen.getByTestId('status-badge')).toHaveClass('custom-class');
    });
  });

  describe('Status Mapping', () => {
    const statuses = [
      { status: 'excellent' as const, expectedVariant: 'badge-performance-excellent' },
      { status: 'good' as const, expectedVariant: 'badge-performance-good' },
      { status: 'fair' as const, expectedVariant: 'badge-performance-fair' },
      { status: 'poor' as const, expectedVariant: 'badge-performance-poor' },
      { status: 'critical' as const, expectedVariant: 'badge-performance-critical' },
    ];

    it.each(statuses)('should map $status status to correct variant', ({ status, expectedVariant }) => {
      render(<StatusBadge status={status} data-testid="status-badge">Test</StatusBadge>);
      expect(screen.getByTestId('status-badge')).toHaveClass(expectedVariant);
    });
  });

  describe('Props Inheritance', () => {
    it('should support size prop', () => {
      render(<StatusBadge status="excellent" size="lg" data-testid="status-badge">Test</StatusBadge>);
      expect(screen.getByTestId('status-badge')).toHaveClass('badge-lg');
    });

    it('should support leftIcon prop', () => {
      render(<StatusBadge status="good" leftIcon={<span data-testid="icon">★</span>}>Test</StatusBadge>);
      expect(screen.getByTestId('icon')).toBeInTheDocument();
    });

    it('should support rightIcon prop', () => {
      render(<StatusBadge status="fair" rightIcon={<span data-testid="icon">★</span>}>Test</StatusBadge>);
      expect(screen.getByTestId('icon')).toBeInTheDocument();
    });

    it('should support onClick handler', () => {
      const handleClick = jest.fn();
      render(<StatusBadge status="excellent" onClick={handleClick} data-testid="status-badge">Test</StatusBadge>);
      screen.getByTestId('status-badge').click();
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should support aria-label attribute', () => {
      render(<StatusBadge status="excellent" aria-label="Performance Status" data-testid="status-badge">Test</StatusBadge>);
      expect(screen.getByTestId('status-badge')).toHaveAttribute('aria-label', 'Performance Status');
    });
  });

  describe('Forward Ref', () => {
    it('should forward ref to span element', () => {
      const ref = React.createRef<HTMLSpanElement>();
      render(<StatusBadge status="excellent" ref={ref}>Test</StatusBadge>);
      expect(ref.current).toBeInstanceOf(HTMLSpanElement);
    });

    it('should allow ref methods to be called', () => {
      const ref = React.createRef<HTMLSpanElement>();
      render(<StatusBadge status="good" ref={ref} tabIndex={0}>Test</StatusBadge>);
      ref.current?.focus();
      expect(ref.current).toHaveFocus();
    });
  });

  describe('Common Use Cases', () => {
    it('should render performance status badges', () => {
      const { rerender } = render(<StatusBadge status="excellent">Excellent Performance</StatusBadge>);
      expect(screen.getByText('Excellent Performance')).toBeInTheDocument();

      rerender(<StatusBadge status="poor">Poor Performance</StatusBadge>);
      expect(screen.getByText('Poor Performance')).toBeInTheDocument();
    });

    it('should handle dynamic status changes', () => {
      const { rerender } = render(<StatusBadge status="excellent" data-testid="status-badge">Status</StatusBadge>);
      expect(screen.getByTestId('status-badge')).toHaveClass('badge-performance-excellent');

      rerender(<StatusBadge status="critical" data-testid="status-badge">Status</StatusBadge>);
      expect(screen.getByTestId('status-badge')).toHaveClass('badge-performance-critical');
    });

    it('should work with size combinations', () => {
      render(<StatusBadge status="excellent" size="sm" data-testid="status-badge">Small</StatusBadge>);
      const badge = screen.getByTestId('status-badge');
      expect(badge).toHaveClass('badge-performance-excellent', 'badge-sm');
    });
  });

  describe('Accessibility', () => {
    it('should be semantically appropriate as a span', () => {
      render(<StatusBadge status="excellent">Accessible Badge</StatusBadge>);
      const badge = screen.getByText('Accessible Badge');
      expect(badge.tagName).toBe('SPAN');
    });

    it('should support custom accessibility attributes', () => {
      render(
        <StatusBadge
          status="excellent"
          aria-label="Performance: Excellent"
          role="status"
          data-testid="status-badge"
        >
          Excellent
        </StatusBadge>
      );
      const badge = screen.getByTestId('status-badge');
      expect(badge).toHaveAttribute('aria-label', 'Performance: Excellent');
      expect(badge).toHaveAttribute('role', 'status');
    });
  });
});
