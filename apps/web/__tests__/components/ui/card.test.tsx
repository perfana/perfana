import React from 'react';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardSubtitle, CardContent, CardFooter } from '@/components/ui/card';

describe('Card Component', () => {
  describe('Basic Rendering', () => {
    it('should render a card with children', () => {
      render(<Card>Card Content</Card>);
      expect(screen.getByText('Card Content')).toBeInTheDocument();
    });

    it('should apply base card class by default', () => {
      render(<Card data-testid="card">Test</Card>);
      const card = screen.getByTestId('card');
      expect(card).toHaveClass('card');
    });

    it('should render as a div element', () => {
      render(<Card data-testid="card">Test</Card>);
      const card = screen.getByTestId('card');
      expect(card.tagName).toBe('DIV');
    });

    it('should render with custom className', () => {
      render(<Card className="custom-class" data-testid="card">Test</Card>);
      expect(screen.getByTestId('card')).toHaveClass('custom-class');
    });
  });

  describe('Variants', () => {
    const variants = [
      { variant: 'default' as const, expectedClasses: ['card'] },
      { variant: 'bordered' as const, expectedClasses: ['card', 'card-bordered'] },
      { variant: 'elevated' as const, expectedClasses: ['card', 'card-elevated'] },
      { variant: 'flush' as const, expectedClasses: ['card', 'card-flush'] },
    ];

    it.each(variants)('should apply correct classes for $variant variant', ({ variant, expectedClasses }) => {
      render(<Card variant={variant} data-testid="card">Test</Card>);
      const card = screen.getByTestId('card');
      expectedClasses.forEach(className => {
        expect(card).toHaveClass(className);
      });
    });

    it('should default to default variant', () => {
      render(<Card data-testid="card">Test</Card>);
      expect(screen.getByTestId('card')).toHaveClass('card');
      expect(screen.getByTestId('card')).not.toHaveClass('card-bordered', 'card-elevated', 'card-flush');
    });
  });

  describe('HTML Attributes', () => {
    it('should accept id attribute', () => {
      render(<Card id="test-card">Test</Card>);
      expect(screen.getByText('Test').closest('div')).toHaveAttribute('id', 'test-card');
    });

    it('should accept data attributes', () => {
      render(<Card data-testid="custom-card">Test</Card>);
      expect(screen.getByTestId('custom-card')).toBeInTheDocument();
    });

    it('should accept aria attributes', () => {
      render(<Card aria-label="Test Card" data-testid="card">Test</Card>);
      expect(screen.getByTestId('card')).toHaveAttribute('aria-label', 'Test Card');
    });

    it('should accept onClick handler', () => {
      const handleClick = jest.fn();
      render(<Card onClick={handleClick} data-testid="card">Test</Card>);
      screen.getByTestId('card').click();
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('Forward Ref', () => {
    it('should forward ref to div element', () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<Card ref={ref}>Test</Card>);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
      expect(ref.current?.tagName).toBe('DIV');
    });

    it('should allow ref methods to be called', () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<Card ref={ref} tabIndex={0}>Test</Card>);
      ref.current?.focus();
      expect(ref.current).toHaveFocus();
    });
  });

  describe('Composition', () => {
    it('should render complex card with all sub-components', () => {
      render(
        <Card variant="bordered" data-testid="card">
          <CardHeader>
            <CardTitle>Title</CardTitle>
            <CardSubtitle>Subtitle</CardSubtitle>
          </CardHeader>
          <CardContent>Content</CardContent>
          <CardFooter>Footer</CardFooter>
        </Card>
      );

      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByText('Subtitle')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
      expect(screen.getByText('Footer')).toBeInTheDocument();
    });
  });
});

describe('CardHeader Component', () => {
  describe('Basic Rendering', () => {
    it('should render header with children', () => {
      render(<CardHeader>Header Content</CardHeader>);
      expect(screen.getByText('Header Content')).toBeInTheDocument();
    });

    it('should apply card-header class', () => {
      render(<CardHeader data-testid="header">Test</CardHeader>);
      expect(screen.getByTestId('header')).toHaveClass('card-header');
    });

    it('should render as a div element', () => {
      render(<CardHeader data-testid="header">Test</CardHeader>);
      expect(screen.getByTestId('header').tagName).toBe('DIV');
    });

    it('should render with custom className', () => {
      render(<CardHeader className="custom-class" data-testid="header">Test</CardHeader>);
      const header = screen.getByTestId('header');
      expect(header).toHaveClass('card-header', 'custom-class');
    });
  });

  describe('Forward Ref', () => {
    it('should forward ref to div element', () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<CardHeader ref={ref}>Test</CardHeader>);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe('HTML Attributes', () => {
    it('should accept data attributes', () => {
      render(<CardHeader data-testid="custom-header">Test</CardHeader>);
      expect(screen.getByTestId('custom-header')).toBeInTheDocument();
    });
  });
});

describe('CardTitle Component', () => {
  describe('Basic Rendering', () => {
    it('should render title with children', () => {
      render(<CardTitle>Card Title</CardTitle>);
      expect(screen.getByText('Card Title')).toBeInTheDocument();
    });

    it('should apply card-title class', () => {
      render(<CardTitle data-testid="title">Test</CardTitle>);
      expect(screen.getByTestId('title')).toHaveClass('card-title');
    });

    it('should render as an h3 element', () => {
      render(<CardTitle>Test</CardTitle>);
      const title = screen.getByText('Test');
      expect(title.tagName).toBe('H3');
    });

    it('should render with custom className', () => {
      render(<CardTitle className="custom-class" data-testid="title">Test</CardTitle>);
      const title = screen.getByTestId('title');
      expect(title).toHaveClass('card-title', 'custom-class');
    });
  });

  describe('Forward Ref', () => {
    it('should forward ref to h3 element', () => {
      const ref = React.createRef<HTMLHeadingElement>();
      render(<CardTitle ref={ref}>Test</CardTitle>);
      expect(ref.current).toBeInstanceOf(HTMLHeadingElement);
      expect(ref.current?.tagName).toBe('H3');
    });
  });

  describe('Accessibility', () => {
    it('should be a heading element for proper document outline', () => {
      render(<CardTitle>Important Title</CardTitle>);
      const heading = screen.getByRole('heading', { level: 3 });
      expect(heading).toBeInTheDocument();
      expect(heading).toHaveTextContent('Important Title');
    });
  });
});

describe('CardSubtitle Component', () => {
  describe('Basic Rendering', () => {
    it('should render subtitle with children', () => {
      render(<CardSubtitle>Card Subtitle</CardSubtitle>);
      expect(screen.getByText('Card Subtitle')).toBeInTheDocument();
    });

    it('should apply card-subtitle class', () => {
      render(<CardSubtitle data-testid="subtitle">Test</CardSubtitle>);
      expect(screen.getByTestId('subtitle')).toHaveClass('card-subtitle');
    });

    it('should render as a p element', () => {
      render(<CardSubtitle>Test</CardSubtitle>);
      const subtitle = screen.getByText('Test');
      expect(subtitle.tagName).toBe('P');
    });

    it('should render with custom className', () => {
      render(<CardSubtitle className="custom-class" data-testid="subtitle">Test</CardSubtitle>);
      const subtitle = screen.getByTestId('subtitle');
      expect(subtitle).toHaveClass('card-subtitle', 'custom-class');
    });
  });

  describe('Forward Ref', () => {
    it('should forward ref to p element', () => {
      const ref = React.createRef<HTMLParagraphElement>();
      render(<CardSubtitle ref={ref}>Test</CardSubtitle>);
      expect(ref.current).toBeInstanceOf(HTMLParagraphElement);
      expect(ref.current?.tagName).toBe('P');
    });
  });
});

describe('CardContent Component', () => {
  describe('Basic Rendering', () => {
    it('should render content with children', () => {
      render(<CardContent>Card Content</CardContent>);
      expect(screen.getByText('Card Content')).toBeInTheDocument();
    });

    it('should apply card-content class', () => {
      render(<CardContent data-testid="content">Test</CardContent>);
      expect(screen.getByTestId('content')).toHaveClass('card-content');
    });

    it('should render as a div element', () => {
      render(<CardContent data-testid="content">Test</CardContent>);
      expect(screen.getByTestId('content').tagName).toBe('DIV');
    });

    it('should render with custom className', () => {
      render(<CardContent className="custom-class" data-testid="content">Test</CardContent>);
      const content = screen.getByTestId('content');
      expect(content).toHaveClass('card-content', 'custom-class');
    });
  });

  describe('Forward Ref', () => {
    it('should forward ref to div element', () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<CardContent ref={ref}>Test</CardContent>);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe('Complex Content', () => {
    it('should render nested elements', () => {
      render(
        <CardContent>
          <p>Paragraph 1</p>
          <p>Paragraph 2</p>
          <div>Nested div</div>
        </CardContent>
      );
      expect(screen.getByText('Paragraph 1')).toBeInTheDocument();
      expect(screen.getByText('Paragraph 2')).toBeInTheDocument();
      expect(screen.getByText('Nested div')).toBeInTheDocument();
    });
  });
});

describe('CardFooter Component', () => {
  describe('Basic Rendering', () => {
    it('should render footer with children', () => {
      render(<CardFooter>Card Footer</CardFooter>);
      expect(screen.getByText('Card Footer')).toBeInTheDocument();
    });

    it('should apply card-footer class', () => {
      render(<CardFooter data-testid="footer">Test</CardFooter>);
      expect(screen.getByTestId('footer')).toHaveClass('card-footer');
    });

    it('should render as a div element', () => {
      render(<CardFooter data-testid="footer">Test</CardFooter>);
      expect(screen.getByTestId('footer').tagName).toBe('DIV');
    });

    it('should render with custom className', () => {
      render(<CardFooter className="custom-class" data-testid="footer">Test</CardFooter>);
      const footer = screen.getByTestId('footer');
      expect(footer).toHaveClass('card-footer', 'custom-class');
    });
  });

  describe('Forward Ref', () => {
    it('should forward ref to div element', () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<CardFooter ref={ref}>Test</CardFooter>);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe('Common Use Cases', () => {
    it('should render action buttons in footer', () => {
      render(
        <CardFooter>
          <button>Cancel</button>
          <button>Save</button>
        </CardFooter>
      );
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    });
  });
});
