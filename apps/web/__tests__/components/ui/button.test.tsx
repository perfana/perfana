import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, IconButton } from '@/components/ui/button';

describe('Button Component', () => {
  describe('Basic Rendering', () => {
    it('should render a button with children', () => {
      render(<Button>Click Me</Button>);
      expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
    });

    it('should apply base classes by default', () => {
      render(<Button>Test</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('btn', 'btn-primary');
    });

    it('should render with custom className', () => {
      render(<Button className="custom-class">Test</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('custom-class');
    });
  });

  describe('Variants', () => {
    const variants = ['primary', 'secondary', 'ghost', 'success', 'warning', 'error'] as const;

    it.each(variants)('should apply %s variant classes', (variant) => {
      render(<Button variant={variant}>Test</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('btn', `btn-${variant}`);
    });

    it('should default to primary variant', () => {
      render(<Button>Test</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('btn-primary');
    });
  });

  describe('Sizes', () => {
    const sizes = [
      { size: 'xs' as const, expectedClass: 'btn-xs' },
      { size: 'sm' as const, expectedClass: 'btn-sm' },
      { size: 'base' as const, expectedClass: '' },
      { size: 'lg' as const, expectedClass: 'btn-lg' },
      { size: 'xl' as const, expectedClass: 'btn-xl' },
    ];

    it.each(sizes)('should apply $size size classes', ({ size, expectedClass }) => {
      render(<Button size={size}>Test</Button>);
      const button = screen.getByRole('button');
      if (expectedClass) {
        expect(button).toHaveClass(expectedClass);
      } else {
        expect(button).toHaveClass('btn');
      }
    });

    it('should default to base size', () => {
      render(<Button>Test</Button>);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('btn');
      expect(button).not.toHaveClass('btn-xs', 'btn-sm', 'btn-lg', 'btn-xl');
    });
  });

  describe('Loading State', () => {
    it('should render spinner when isLoading is true', () => {
      render(<Button isLoading>Test</Button>);
      const spinner = screen.getByRole('button').querySelector('.spinner');
      expect(spinner).toBeInTheDocument();
      expect(spinner).toHaveClass('spinner-sm');
    });

    it('should disable button when isLoading is true', () => {
      render(<Button isLoading>Test</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('should hide icons when loading', () => {
      render(
        <Button isLoading leftIcon={<span data-testid="left-icon">L</span>} rightIcon={<span data-testid="right-icon">R</span>}>
          Test
        </Button>
      );
      expect(screen.queryByTestId('left-icon')).not.toBeInTheDocument();
      expect(screen.queryByTestId('right-icon')).not.toBeInTheDocument();
    });

    it('should show icons when not loading', () => {
      render(
        <Button leftIcon={<span data-testid="left-icon">L</span>} rightIcon={<span data-testid="right-icon">R</span>}>
          Test
        </Button>
      );
      expect(screen.getByTestId('left-icon')).toBeInTheDocument();
      expect(screen.getByTestId('right-icon')).toBeInTheDocument();
    });
  });

  describe('Icons', () => {
    it('should render left icon when provided', () => {
      render(<Button leftIcon={<span data-testid="left-icon">←</span>}>Test</Button>);
      expect(screen.getByTestId('left-icon')).toBeInTheDocument();
    });

    it('should render right icon when provided', () => {
      render(<Button rightIcon={<span data-testid="right-icon">→</span>}>Test</Button>);
      expect(screen.getByTestId('right-icon')).toBeInTheDocument();
    });

    it('should render both icons when provided', () => {
      render(
        <Button leftIcon={<span data-testid="left-icon">←</span>} rightIcon={<span data-testid="right-icon">→</span>}>
          Test
        </Button>
      );
      expect(screen.getByTestId('left-icon')).toBeInTheDocument();
      expect(screen.getByTestId('right-icon')).toBeInTheDocument();
    });
  });

  describe('Disabled State', () => {
    it('should be disabled when disabled prop is true', () => {
      render(<Button disabled>Test</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('should not call onClick when disabled', async () => {
      const user = userEvent.setup();
      const handleClick = jest.fn();
      render(<Button disabled onClick={handleClick}>Test</Button>);
      await user.click(screen.getByRole('button'));
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe('User Interactions', () => {
    it('should call onClick when clicked', async () => {
      const user = userEvent.setup();
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Test</Button>);
      await user.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should call onFocus when focused', async () => {
      const user = userEvent.setup();
      const handleFocus = jest.fn();
      render(<Button onFocus={handleFocus}>Test</Button>);
      await user.tab();
      expect(handleFocus).toHaveBeenCalledTimes(1);
    });

    it('should call onBlur when blurred', async () => {
      const user = userEvent.setup();
      const handleBlur = jest.fn();
      render(<Button onBlur={handleBlur}>Test</Button>);
      const button = screen.getByRole('button');
      button.focus();
      button.blur();
      expect(handleBlur).toHaveBeenCalledTimes(1);
    });

    it('should handle keyboard navigation', async () => {
      const user = userEvent.setup();
      const handleClick = jest.fn();
      render(<Button onClick={handleClick}>Test</Button>);
      await user.tab();
      await user.keyboard('{Enter}');
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('Forward Ref', () => {
    it('should forward ref to button element', () => {
      const ref = React.createRef<HTMLButtonElement>();
      render(<Button ref={ref}>Test</Button>);
      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
      expect(ref.current?.tagName).toBe('BUTTON');
    });

    it('should allow ref methods to be called', () => {
      const ref = React.createRef<HTMLButtonElement>();
      render(<Button ref={ref}>Test</Button>);
      ref.current?.focus();
      expect(ref.current).toHaveFocus();
    });
  });

  describe('HTML Attributes', () => {
    it('should accept type attribute', () => {
      render(<Button type="submit">Test</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
    });

    it('should accept aria-label attribute', () => {
      render(<Button aria-label="Custom Label">Test</Button>);
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Custom Label');
    });

    it('should accept data attributes', () => {
      render(<Button data-testid="custom-button">Test</Button>);
      expect(screen.getByTestId('custom-button')).toBeInTheDocument();
    });
  });
});

describe('IconButton Component', () => {
  describe('Basic Rendering', () => {
    it('should render icon button with icon', () => {
      render(<IconButton icon={<span data-testid="icon">★</span>} aria-label="Star" />);
      expect(screen.getByRole('button', { name: /star/i })).toBeInTheDocument();
      expect(screen.getByTestId('icon')).toBeInTheDocument();
    });

    it('should require aria-label for accessibility', () => {
      render(<IconButton icon={<span>★</span>} aria-label="Star Button" />);
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Star Button');
    });

    it('should render with custom className', () => {
      render(<IconButton icon={<span>★</span>} aria-label="Star" className="custom-class" />);
      expect(screen.getByRole('button')).toHaveClass('custom-class');
    });
  });

  describe('Sizes', () => {
    const sizes = [
      { size: 'xs' as const, expectedClass: 'btn-icon' },
      { size: 'sm' as const, expectedClass: 'btn-icon-sm' },
      { size: 'base' as const, expectedClass: 'btn-icon' },
      { size: 'lg' as const, expectedClass: 'btn-icon-lg' },
      { size: 'xl' as const, expectedClass: 'btn-icon-lg' },
    ];

    it.each(sizes)('should apply correct icon classes for $size size', ({ size, expectedClass }) => {
      render(<IconButton icon={<span>★</span>} aria-label="Star" size={size} />);
      expect(screen.getByRole('button')).toHaveClass(expectedClass);
    });

    it('should default to base size', () => {
      render(<IconButton icon={<span>★</span>} aria-label="Star" />);
      expect(screen.getByRole('button')).toHaveClass('btn-icon');
    });
  });

  describe('Variants', () => {
    const variants = ['primary', 'secondary', 'ghost', 'success', 'warning', 'error'] as const;

    it.each(variants)('should support %s variant', (variant) => {
      render(<IconButton icon={<span>★</span>} aria-label="Star" variant={variant} />);
      expect(screen.getByRole('button')).toHaveClass(`btn-${variant}`);
    });
  });

  describe('Disabled State', () => {
    it('should be disabled when disabled prop is true', () => {
      render(<IconButton icon={<span>★</span>} aria-label="Star" disabled />);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('should not call onClick when disabled', async () => {
      const user = userEvent.setup();
      const handleClick = jest.fn();
      render(<IconButton icon={<span>★</span>} aria-label="Star" disabled onClick={handleClick} />);
      await user.click(screen.getByRole('button'));
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe('User Interactions', () => {
    it('should call onClick when clicked', async () => {
      const user = userEvent.setup();
      const handleClick = jest.fn();
      render(<IconButton icon={<span>★</span>} aria-label="Star" onClick={handleClick} />);
      await user.click(screen.getByRole('button'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('Loading State', () => {
    it('should show spinner when loading', () => {
      render(<IconButton icon={<span data-testid="icon">★</span>} aria-label="Star" isLoading />);
      const spinner = screen.getByRole('button').querySelector('.spinner');
      expect(spinner).toBeInTheDocument();
    });

    it('should still render icon when loading (icon is children)', () => {
      render(<IconButton icon={<span data-testid="icon">★</span>} aria-label="Star" isLoading />);
      // IconButton passes icon as children to Button, so it will still be in DOM
      expect(screen.getByTestId('icon')).toBeInTheDocument();
    });

    it('should disable button when loading', () => {
      render(<IconButton icon={<span>★</span>} aria-label="Star" isLoading />);
      expect(screen.getByRole('button')).toBeDisabled();
    });
  });

  describe('Forward Ref', () => {
    it('should forward ref to button element', () => {
      const ref = React.createRef<HTMLButtonElement>();
      render(<IconButton icon={<span>★</span>} aria-label="Star" ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    });
  });
});
