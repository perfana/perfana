import React from 'react';
import { render, screen } from '@testing-library/react';
import { MetricCard } from '@/components/ui/metric-card';

describe('MetricCard Component', () => {
  describe('Basic Rendering', () => {
    it('should render a metric card with value and label', () => {
      render(<MetricCard value="1,234" label="Total Users" />);
      expect(screen.getByText('1,234')).toBeInTheDocument();
      expect(screen.getByText('Total Users')).toBeInTheDocument();
    });

    it('should render as a div element', () => {
      const { container } = render(<MetricCard value="100" label="Count" />);
      const card = container.querySelector('.metric-card');
      expect(card?.tagName).toBe('DIV');
    });

    it('should apply metric-card class', () => {
      const { container } = render(<MetricCard value="100" label="Count" />);
      expect(container.querySelector('.metric-card')).toBeInTheDocument();
    });

    it('should render with custom className', () => {
      const { container } = render(
        <MetricCard value="100" label="Count" className="custom-class" />
      );
      const card = container.querySelector('.metric-card');
      expect(card).toHaveClass('metric-card', 'custom-class');
    });
  });

  describe('Value Prop', () => {
    it('should render string value', () => {
      render(<MetricCard value="1,234" label="Users" />);
      expect(screen.getByText('1,234')).toBeInTheDocument();
    });

    it('should render numeric value', () => {
      render(<MetricCard value={42} label="Count" />);
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('should render zero value', () => {
      render(<MetricCard value={0} label="Errors" />);
      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('should render large numbers', () => {
      render(<MetricCard value={1234567890} label="Revenue" />);
      expect(screen.getByText('1234567890')).toBeInTheDocument();
    });

    it('should render decimal values', () => {
      render(<MetricCard value="99.99%" label="Success Rate" />);
      expect(screen.getByText('99.99%')).toBeInTheDocument();
    });

    it('should render negative numbers', () => {
      render(<MetricCard value={-100} label="Loss" />);
      expect(screen.getByText('-100')).toBeInTheDocument();
    });

    it('should apply metric-value class', () => {
      const { container } = render(<MetricCard value="100" label="Count" />);
      const valueElement = container.querySelector('.metric-value');
      expect(valueElement).toBeInTheDocument();
      expect(valueElement).toHaveTextContent('100');
    });
  });

  describe('Label Prop', () => {
    it('should render label text', () => {
      render(<MetricCard value="100" label="Active Sessions" />);
      expect(screen.getByText('Active Sessions')).toBeInTheDocument();
    });

    it('should apply metric-label class', () => {
      const { container } = render(<MetricCard value="100" label="Count" />);
      const labelElement = container.querySelector('.metric-label');
      expect(labelElement).toBeInTheDocument();
      expect(labelElement).toHaveTextContent('Count');
    });

    it('should render label with special characters', () => {
      render(<MetricCard value="100" label="Users (Active)" />);
      expect(screen.getByText('Users (Active)')).toBeInTheDocument();
    });

    it('should render long label text', () => {
      const longLabel = 'This is a very long label that might wrap';
      render(<MetricCard value="100" label={longLabel} />);
      expect(screen.getByText(longLabel)).toBeInTheDocument();
    });
  });

  describe('Change Prop', () => {
    it('should not render change when not provided', () => {
      const { container } = render(<MetricCard value="100" label="Count" />);
      expect(container.querySelector('.metric-change')).not.toBeInTheDocument();
    });

    it('should render positive change', () => {
      render(
        <MetricCard
          value="100"
          label="Users"
          change={{ value: '12.5%', direction: 'positive' }}
        />
      );
      expect(screen.getByText('+12.5%')).toBeInTheDocument();
    });

    it('should render negative change', () => {
      render(
        <MetricCard
          value="100"
          label="Users"
          change={{ value: '8.3%', direction: 'negative' }}
        />
      );
      expect(screen.getByText('-8.3%')).toBeInTheDocument();
    });

    it('should render neutral change', () => {
      render(
        <MetricCard
          value="100"
          label="Users"
          change={{ value: '0%', direction: 'neutral' }}
        />
      );
      expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('should render numeric change value', () => {
      render(
        <MetricCard
          value="100"
          label="Users"
          change={{ value: 15, direction: 'positive' }}
        />
      );
      expect(screen.getByText('+15')).toBeInTheDocument();
    });

    it('should render "vs last period" text', () => {
      render(
        <MetricCard
          value="100"
          label="Users"
          change={{ value: '10%', direction: 'positive' }}
        />
      );
      expect(screen.getByText('vs last period')).toBeInTheDocument();
    });

    it('should not show + or - for neutral direction', () => {
      render(
        <MetricCard
          value="100"
          label="Users"
          change={{ value: '0', direction: 'neutral' }}
        />
      );
      const changeText = screen.getByText('0');
      expect(changeText.textContent).toBe('0');
      expect(changeText.textContent).not.toContain('+');
      expect(changeText.textContent).not.toContain('-');
    });
  });

  describe('Change Direction Styling', () => {
    it('should apply positive change classes', () => {
      const { container } = render(
        <MetricCard
          value="100"
          label="Users"
          change={{ value: '10%', direction: 'positive' }}
        />
      );
      const changeElement = container.querySelector('.metric-change');
      expect(changeElement).toHaveClass('metric-change-positive');
    });

    it('should apply negative change classes', () => {
      const { container } = render(
        <MetricCard
          value="100"
          label="Users"
          change={{ value: '5%', direction: 'negative' }}
        />
      );
      const changeElement = container.querySelector('.metric-change');
      expect(changeElement).toHaveClass('metric-change-negative');
    });

    it('should apply neutral change classes', () => {
      const { container } = render(
        <MetricCard
          value="100"
          label="Users"
          change={{ value: '0%', direction: 'neutral' }}
        />
      );
      const changeElement = container.querySelector('.metric-change');
      expect(changeElement).toHaveClass('metric-change-neutral');
    });

    it('should apply base metric-change class', () => {
      const { container } = render(
        <MetricCard
          value="100"
          label="Users"
          change={{ value: '10%', direction: 'positive' }}
        />
      );
      const changeElement = container.querySelector('.metric-change');
      expect(changeElement).toHaveClass('metric-change');
    });
  });

  describe('Icon Prop', () => {
    it('should not render icon when not provided', () => {
      render(<MetricCard value="100" label="Count" />);
      expect(screen.queryByTestId('metric-icon')).not.toBeInTheDocument();
    });

    it('should render icon when provided', () => {
      const icon = <span data-testid="metric-icon">📊</span>;
      render(<MetricCard value="100" label="Count" icon={icon} />);
      expect(screen.getByTestId('metric-icon')).toBeInTheDocument();
    });

    it('should render custom SVG icon', () => {
      const icon = (
        <svg data-testid="custom-svg">
          <circle cx="10" cy="10" r="5" />
        </svg>
      );
      render(<MetricCard value="100" label="Count" icon={icon} />);
      expect(screen.getByTestId('custom-svg')).toBeInTheDocument();
    });

    it('should render icon with correct styling wrapper', () => {
      const icon = <span data-testid="metric-icon">📊</span>;
      const { container } = render(<MetricCard value="100" label="Count" icon={icon} />);
      const iconWrapper = screen.getByTestId('metric-icon').parentElement;
      expect(iconWrapper).toHaveClass('text-gray-400');
    });
  });

  describe('Layout and Structure', () => {
    it('should have label and icon in same row', () => {
      const icon = <span data-testid="metric-icon">📊</span>;
      const { container } = render(<MetricCard value="100" label="Count" icon={icon} />);
      const topRow = container.querySelector('.flex.items-start.justify-between');
      expect(topRow).toBeInTheDocument();
    });

    it('should apply margin bottom to label section', () => {
      const { container } = render(<MetricCard value="100" label="Count" />);
      const labelSection = container.querySelector('.flex.items-start');
      expect(labelSection).toHaveClass('mb-4');
    });

    it('should render label before value in DOM', () => {
      const { container } = render(<MetricCard value="100" label="Count" />);
      const label = container.querySelector('.metric-label');
      const value = container.querySelector('.metric-value');
      expect(label?.compareDocumentPosition(value!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      );
    });

    it('should render value before change in DOM', () => {
      const { container } = render(
        <MetricCard
          value="100"
          label="Count"
          change={{ value: '10%', direction: 'positive' }}
        />
      );
      const value = container.querySelector('.metric-value');
      const change = container.querySelector('.metric-change');
      expect(value?.compareDocumentPosition(change!)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      );
    });
  });

  describe('Forward Ref', () => {
    it('should forward ref to div element', () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<MetricCard value="100" label="Count" ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
      expect(ref.current?.className).toContain('metric-card');
    });

    it('should allow ref methods to be called', () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<MetricCard value="100" label="Count" ref={ref} tabIndex={0} />);
      ref.current?.focus();
      expect(ref.current).toHaveFocus();
    });

    it('should allow ref to access DOM properties', () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<MetricCard value="100" label="Count" ref={ref} />);
      expect(ref.current?.tagName).toBe('DIV');
    });
  });

  describe('HTML Attributes', () => {
    it('should accept id attribute', () => {
      const { container } = render(<MetricCard value="100" label="Count" id="test-card" />);
      const card = container.querySelector('#test-card');
      expect(card).toBeInTheDocument();
    });

    it('should accept data-testid attribute', () => {
      render(<MetricCard value="100" label="Count" data-testid="metric-card" />);
      expect(screen.getByTestId('metric-card')).toBeInTheDocument();
    });

    it('should accept aria-label attribute', () => {
      const { container } = render(
        <MetricCard value="100" label="Count" aria-label="User count metric" />
      );
      const card = container.querySelector('.metric-card');
      expect(card).toHaveAttribute('aria-label', 'User count metric');
    });

    it('should accept onClick handler', () => {
      const handleClick = jest.fn();
      const { container } = render(
        <MetricCard value="100" label="Count" onClick={handleClick} />
      );
      const card = container.querySelector('.metric-card');
      card?.click();
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should accept style attribute', () => {
      const { container } = render(
        <MetricCard value="100" label="Count" style={{ backgroundColor: 'red' }} />
      );
      const card = container.querySelector('.metric-card');
      expect(card).toHaveStyle({ backgroundColor: 'red' });
    });

    it('should accept title attribute', () => {
      const { container } = render(
        <MetricCard value="100" label="Count" title="Tooltip text" />
      );
      const card = container.querySelector('.metric-card');
      expect(card).toHaveAttribute('title', 'Tooltip text');
    });
  });

  describe('Display Name', () => {
    it('should have correct display name', () => {
      expect(MetricCard.displayName).toBe('MetricCard');
    });
  });

  describe('Complex Scenarios', () => {
    it('should render all props together', () => {
      const icon = <span data-testid="metric-icon">📊</span>;
      const { container } = render(
        <MetricCard
          value="1,234"
          label="Total Users"
          change={{ value: '12.5%', direction: 'positive' }}
          icon={icon}
          className="custom-class"
          data-testid="full-card"
        />
      );

      expect(screen.getByText('1,234')).toBeInTheDocument();
      expect(screen.getByText('Total Users')).toBeInTheDocument();
      expect(screen.getByText('+12.5%')).toBeInTheDocument();
      expect(screen.getByTestId('metric-icon')).toBeInTheDocument();
      expect(container.querySelector('.custom-class')).toBeInTheDocument();
    });

    it('should handle dynamic value updates', () => {
      const { rerender } = render(<MetricCard value="100" label="Count" />);
      expect(screen.getByText('100')).toBeInTheDocument();

      rerender(<MetricCard value="200" label="Count" />);
      expect(screen.getByText('200')).toBeInTheDocument();
      expect(screen.queryByText('100')).not.toBeInTheDocument();
    });

    it('should handle dynamic change direction', () => {
      const { container, rerender } = render(
        <MetricCard
          value="100"
          label="Count"
          change={{ value: '10%', direction: 'positive' }}
        />
      );
      expect(container.querySelector('.metric-change-positive')).toBeInTheDocument();

      rerender(
        <MetricCard
          value="100"
          label="Count"
          change={{ value: '10%', direction: 'negative' }}
        />
      );
      expect(container.querySelector('.metric-change-negative')).toBeInTheDocument();
    });

    it('should handle change being added dynamically', () => {
      const { container, rerender } = render(<MetricCard value="100" label="Count" />);
      expect(container.querySelector('.metric-change')).not.toBeInTheDocument();

      rerender(
        <MetricCard
          value="100"
          label="Count"
          change={{ value: '10%', direction: 'positive' }}
        />
      );
      expect(container.querySelector('.metric-change')).toBeInTheDocument();
    });

    it('should handle change being removed dynamically', () => {
      const { container, rerender } = render(
        <MetricCard
          value="100"
          label="Count"
          change={{ value: '10%', direction: 'positive' }}
        />
      );
      expect(container.querySelector('.metric-change')).toBeInTheDocument();

      rerender(<MetricCard value="100" label="Count" />);
      expect(container.querySelector('.metric-change')).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string value', () => {
      render(<MetricCard value="" label="Count" />);
      const valueElement = screen.getByText((content, element) => {
        return element?.classList.contains('metric-value') === true;
      });
      expect(valueElement).toBeInTheDocument();
    });

    it('should handle very long value strings', () => {
      const longValue = '9,999,999,999,999';
      render(<MetricCard value={longValue} label="Count" />);
      expect(screen.getByText(longValue)).toBeInTheDocument();
    });

    it('should handle special characters in values', () => {
      render(<MetricCard value="$1,234.56" label="Revenue" />);
      expect(screen.getByText('$1,234.56')).toBeInTheDocument();
    });

    it('should handle unicode characters in label', () => {
      render(<MetricCard value="100" label="Users 👥" />);
      expect(screen.getByText('Users 👥')).toBeInTheDocument();
    });

    it('should handle zero change value', () => {
      render(
        <MetricCard
          value="100"
          label="Count"
          change={{ value: 0, direction: 'neutral' }}
        />
      );
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should be semantically appropriate as a div', () => {
      const { container } = render(<MetricCard value="100" label="Count" />);
      const card = container.querySelector('.metric-card');
      expect(card?.tagName).toBe('DIV');
    });

    it('should support aria-label for screen readers', () => {
      const { container } = render(
        <MetricCard
          value="1,234"
          label="Users"
          aria-label="Total user count: 1,234"
        />
      );
      const card = container.querySelector('.metric-card');
      expect(card).toHaveAttribute('aria-label', 'Total user count: 1,234');
    });

    it('should be focusable when tabIndex is provided', () => {
      const { container } = render(<MetricCard value="100" label="Count" tabIndex={0} />);
      const card = container.querySelector('.metric-card');
      card?.focus();
      expect(card).toHaveFocus();
    });

    it('should support role attribute', () => {
      const { container } = render(
        <MetricCard value="100" label="Count" role="region" />
      );
      const card = container.querySelector('.metric-card');
      expect(card).toHaveAttribute('role', 'region');
    });
  });
});
