import React from 'react';
import { render, screen } from '@testing-library/react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

describe('Alert Component', () => {
  describe('Basic Rendering', () => {
    it('should render an alert with children', () => {
      render(<Alert>Alert Content</Alert>);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Alert Content')).toBeInTheDocument();
    });

    it('should render as a div element with role="alert"', () => {
      render(<Alert data-testid="alert">Test</Alert>);
      const alert = screen.getByTestId('alert');
      expect(alert.tagName).toBe('DIV');
      expect(alert).toHaveAttribute('role', 'alert');
    });

    it('should apply base alert class', () => {
      render(<Alert data-testid="alert">Test</Alert>);
      expect(screen.getByTestId('alert')).toHaveClass('alert');
    });

    it('should render with custom className', () => {
      render(<Alert className="custom-class" data-testid="alert">Test</Alert>);
      expect(screen.getByTestId('alert')).toHaveClass('alert', 'custom-class');
    });
  });

  describe('Variants', () => {
    const variants = [
      { variant: 'info' as const, expectedClass: 'alert-info' },
      { variant: 'success' as const, expectedClass: 'alert-success' },
      { variant: 'warning' as const, expectedClass: 'alert-warning' },
      { variant: 'error' as const, expectedClass: 'alert-error' },
    ];

    it.each(variants)('should apply $variant variant classes', ({ variant, expectedClass }) => {
      render(<Alert variant={variant} data-testid="alert">Test</Alert>);
      expect(screen.getByTestId('alert')).toHaveClass('alert', expectedClass);
    });

    it('should default to info variant', () => {
      render(<Alert data-testid="alert">Test</Alert>);
      expect(screen.getByTestId('alert')).toHaveClass('alert-info');
    });
  });

  describe('Icon', () => {
    it('should render icon when provided', () => {
      render(<Alert icon={<span data-testid="alert-icon">ℹ</span>}>Test</Alert>);
      expect(screen.getByTestId('alert-icon')).toBeInTheDocument();
    });

    it('should apply flex-shrink-0 to icon wrapper', () => {
      const { container } = render(<Alert icon={<span>ℹ</span>}>Test</Alert>);
      const iconWrapper = container.querySelector('.flex-shrink-0');
      expect(iconWrapper).toBeInTheDocument();
    });

    it('should not render icon wrapper when icon is not provided', () => {
      const { container } = render(<Alert>Test</Alert>);
      const iconWrapper = container.querySelector('.flex-shrink-0');
      expect(iconWrapper).not.toBeInTheDocument();
    });
  });

  describe('Content Layout', () => {
    it('should wrap content in flex-1 div', () => {
      const { container } = render(<Alert>Content</Alert>);
      const contentWrapper = container.querySelector('.flex-1');
      expect(contentWrapper).toBeInTheDocument();
      expect(contentWrapper).toHaveTextContent('Content');
    });

    it('should render complex content structure', () => {
      render(
        <Alert>
          <div>Line 1</div>
          <div>Line 2</div>
        </Alert>
      );
      expect(screen.getByText('Line 1')).toBeInTheDocument();
      expect(screen.getByText('Line 2')).toBeInTheDocument();
    });
  });

  describe('HTML Attributes', () => {
    it('should accept id attribute', () => {
      render(<Alert id="test-alert" data-testid="alert">Test</Alert>);
      expect(screen.getByTestId('alert')).toHaveAttribute('id', 'test-alert');
    });

    it('should accept data attributes', () => {
      render(<Alert data-testid="custom-alert">Test</Alert>);
      expect(screen.getByTestId('custom-alert')).toBeInTheDocument();
    });

    it('should accept aria attributes', () => {
      render(<Alert aria-label="Important Alert" data-testid="alert">Test</Alert>);
      expect(screen.getByTestId('alert')).toHaveAttribute('aria-label', 'Important Alert');
    });

    it('should accept onClick handler', () => {
      const handleClick = jest.fn();
      render(<Alert onClick={handleClick} data-testid="alert">Test</Alert>);
      screen.getByTestId('alert').click();
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('Forward Ref', () => {
    it('should forward ref to div element', () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<Alert ref={ref}>Test</Alert>);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
      expect(ref.current?.tagName).toBe('DIV');
    });

    it('should allow ref methods to be called', () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<Alert ref={ref} tabIndex={0}>Test</Alert>);
      ref.current?.focus();
      expect(ref.current).toHaveFocus();
    });
  });

  describe('Accessibility', () => {
    it('should have role="alert" for screen readers', () => {
      render(<Alert>Important message</Alert>);
      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('role', 'alert');
    });

    it('should be announced to screen readers', () => {
      render(<Alert>Critical update</Alert>);
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
    });
  });

  describe('Composition with Icon and Content', () => {
    it('should render icon and content together', () => {
      render(
        <Alert icon={<span data-testid="icon">⚠</span>}>
          <div data-testid="content">Warning message</div>
        </Alert>
      );
      expect(screen.getByTestId('icon')).toBeInTheDocument();
      expect(screen.getByTestId('content')).toBeInTheDocument();
    });

    it('should maintain proper layout with icon', () => {
      const { container } = render(
        <Alert icon={<span>ℹ</span>}>Content</Alert>
      );
      const iconWrapper = container.querySelector('.flex-shrink-0');
      const contentWrapper = container.querySelector('.flex-1');
      expect(iconWrapper).toBeInTheDocument();
      expect(contentWrapper).toBeInTheDocument();
    });
  });
});

describe('AlertTitle Component', () => {
  describe('Basic Rendering', () => {
    it('should render title with children', () => {
      render(<AlertTitle>Alert Title</AlertTitle>);
      expect(screen.getByText('Alert Title')).toBeInTheDocument();
    });

    it('should render as an h4 element', () => {
      render(<AlertTitle>Test Title</AlertTitle>);
      const title = screen.getByText('Test Title');
      expect(title.tagName).toBe('H4');
    });

    it('should apply font-semibold and mb-1 classes', () => {
      render(<AlertTitle data-testid="title">Test</AlertTitle>);
      const title = screen.getByTestId('title');
      expect(title).toHaveClass('font-semibold', 'mb-1');
    });

    it('should render with custom className', () => {
      render(<AlertTitle className="custom-class" data-testid="title">Test</AlertTitle>);
      const title = screen.getByTestId('title');
      expect(title).toHaveClass('font-semibold', 'mb-1', 'custom-class');
    });
  });

  describe('Forward Ref', () => {
    it('should forward ref to h4 element', () => {
      const ref = React.createRef<HTMLHeadingElement>();
      render(<AlertTitle ref={ref}>Test</AlertTitle>);
      expect(ref.current).toBeInstanceOf(HTMLHeadingElement);
      expect(ref.current?.tagName).toBe('H4');
    });

    it('should allow ref methods to be called', () => {
      const ref = React.createRef<HTMLHeadingElement>();
      render(<AlertTitle ref={ref} tabIndex={0}>Test</AlertTitle>);
      ref.current?.focus();
      expect(ref.current).toHaveFocus();
    });
  });

  describe('HTML Attributes', () => {
    it('should accept id attribute', () => {
      render(<AlertTitle id="alert-title" data-testid="title">Test</AlertTitle>);
      expect(screen.getByTestId('title')).toHaveAttribute('id', 'alert-title');
    });

    it('should accept data attributes', () => {
      render(<AlertTitle data-testid="custom-title">Test</AlertTitle>);
      expect(screen.getByTestId('custom-title')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should be a heading element for proper document outline', () => {
      render(<AlertTitle>Important Alert</AlertTitle>);
      const heading = screen.getByRole('heading', { level: 4 });
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveTextContent('Important Alert');
    });
  });
});

describe('AlertDescription Component', () => {
  describe('Basic Rendering', () => {
    it('should render description with children', () => {
      render(<AlertDescription>Alert Description</AlertDescription>);
      expect(screen.getByText('Alert Description')).toBeInTheDocument();
    });

    it('should render as a div element', () => {
      render(<AlertDescription data-testid="description">Test</AlertDescription>);
      expect(screen.getByTestId('description').tagName).toBe('DIV');
    });

    it('should apply text-sm and opacity-90 classes', () => {
      render(<AlertDescription data-testid="description">Test</AlertDescription>);
      const description = screen.getByTestId('description');
      expect(description).toHaveClass('text-sm', 'opacity-90');
    });

    it('should render with custom className', () => {
      render(<AlertDescription className="custom-class" data-testid="description">Test</AlertDescription>);
      const description = screen.getByTestId('description');
      expect(description).toHaveClass('text-sm', 'opacity-90', 'custom-class');
    });
  });

  describe('Forward Ref', () => {
    it('should forward ref to div element', () => {
      const ref = React.createRef<HTMLParagraphElement>();
      render(<AlertDescription ref={ref}>Test</AlertDescription>);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
      expect(ref.current?.tagName).toBe('DIV');
    });

    it('should allow ref methods to be called', () => {
      const ref = React.createRef<HTMLParagraphElement>();
      render(<AlertDescription ref={ref} tabIndex={0}>Test</AlertDescription>);
      ref.current?.focus();
      expect(ref.current).toHaveFocus();
    });
  });

  describe('HTML Attributes', () => {
    it('should accept id attribute', () => {
      render(<AlertDescription id="alert-desc" data-testid="description">Test</AlertDescription>);
      expect(screen.getByTestId('description')).toHaveAttribute('id', 'alert-desc');
    });

    it('should accept data attributes', () => {
      render(<AlertDescription data-testid="custom-description">Test</AlertDescription>);
      expect(screen.getByTestId('custom-description')).toBeInTheDocument();
    });
  });

  describe('Content Rendering', () => {
    it('should render plain text content', () => {
      render(<AlertDescription>Simple description text</AlertDescription>);
      expect(screen.getByText('Simple description text')).toBeInTheDocument();
    });

    it('should render nested elements', () => {
      render(
        <AlertDescription>
          <span>Part 1</span>
          <span>Part 2</span>
        </AlertDescription>
      );
      expect(screen.getByText('Part 1')).toBeInTheDocument();
      expect(screen.getByText('Part 2')).toBeInTheDocument();
    });
  });
});

describe('Alert Composition', () => {
  describe('Complete Alert Structure', () => {
    it('should render alert with title and description', () => {
      render(
        <Alert variant="success">
          <AlertTitle>Success!</AlertTitle>
          <AlertDescription>Your action was completed successfully.</AlertDescription>
        </Alert>
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('Success!');
      expect(screen.getByText('Your action was completed successfully.')).toBeInTheDocument();
    });

    it('should render alert with icon, title, and description', () => {
      render(
        <Alert variant="warning" icon={<span data-testid="icon">⚠</span>}>
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>Please review the following issues.</AlertDescription>
        </Alert>
      );

      expect(screen.getByTestId('icon')).toBeInTheDocument();
      expect(screen.getByRole('heading')).toHaveTextContent('Warning');
      expect(screen.getByText('Please review the following issues.')).toBeInTheDocument();
    });

    it('should render alert with only description', () => {
      render(
        <Alert variant="info">
          <AlertDescription>Information message without a title.</AlertDescription>
        </Alert>
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Information message without a title.')).toBeInTheDocument();
    });

    it('should render alert with only title', () => {
      render(
        <Alert variant="error">
          <AlertTitle>Error occurred</AlertTitle>
        </Alert>
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('heading')).toHaveTextContent('Error occurred');
    });
  });

  describe('Variant-specific Compositions', () => {
    it('should render info alert correctly', () => {
      render(
        <Alert variant="info" data-testid="alert">
          <AlertTitle>Information</AlertTitle>
          <AlertDescription>This is an informational message.</AlertDescription>
        </Alert>
      );

      const alert = screen.getByTestId('alert');
      expect(alert).toHaveClass('alert-info');
      expect(screen.getByRole('heading')).toHaveTextContent('Information');
    });

    it('should render success alert correctly', () => {
      render(
        <Alert variant="success" data-testid="alert">
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>Operation completed successfully.</AlertDescription>
        </Alert>
      );

      const alert = screen.getByTestId('alert');
      expect(alert).toHaveClass('alert-success');
    });

    it('should render warning alert correctly', () => {
      render(
        <Alert variant="warning" data-testid="alert">
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>Please proceed with caution.</AlertDescription>
        </Alert>
      );

      const alert = screen.getByTestId('alert');
      expect(alert).toHaveClass('alert-warning');
    });

    it('should render error alert correctly', () => {
      render(
        <Alert variant="error" data-testid="alert">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>An error has occurred.</AlertDescription>
        </Alert>
      );

      const alert = screen.getByTestId('alert');
      expect(alert).toHaveClass('alert-error');
    });
  });

  describe('Complex Content Scenarios', () => {
    it('should render alert with multiple description paragraphs', () => {
      render(
        <Alert variant="info">
          <AlertTitle>Multi-paragraph Alert</AlertTitle>
          <AlertDescription>
            <p>First paragraph of information.</p>
            <p>Second paragraph of information.</p>
          </AlertDescription>
        </Alert>
      );

      expect(screen.getByText('First paragraph of information.')).toBeInTheDocument();
      expect(screen.getByText('Second paragraph of information.')).toBeInTheDocument();
    });

    it('should render alert with action buttons', () => {
      render(
        <Alert variant="warning">
          <AlertTitle>Confirmation Required</AlertTitle>
          <AlertDescription>
            <p>Are you sure you want to proceed?</p>
            <button>Confirm</button>
            <button>Cancel</button>
          </AlertDescription>
        </Alert>
      );

      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });
  });
});
