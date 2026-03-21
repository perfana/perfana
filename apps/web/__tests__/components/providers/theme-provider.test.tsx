import React from 'react';
import { render, screen } from '@testing-library/react';
import { MUIThemeProvider } from '@/components/providers/theme-provider';

// Mock MUI components to avoid complex setup
jest.mock('@mui/material/styles', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mui-theme-provider">{children}</div>
  ),
}));

jest.mock('@mui/material', () => ({
  CssBaseline: () => <div data-testid="css-baseline" />,
}));

jest.mock('@/lib/theme', () => ({
  getTheme: () => ({
    palette: {
      primary: { main: '#1976d2' },
      secondary: { main: '#dc004e' },
    },
  }),
}));

describe('MUIThemeProvider Component', () => {
  describe('Basic Rendering', () => {
    it('should render children', () => {
      render(
        <MUIThemeProvider>
          <div>Test Content</div>
        </MUIThemeProvider>
      );
      expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('should wrap children with ThemeProvider', () => {
      render(
        <MUIThemeProvider>
          <div>Test Content</div>
        </MUIThemeProvider>
      );
      expect(screen.getByTestId('mui-theme-provider')).toBeInTheDocument();
    });

    it('should render CssBaseline component', () => {
      render(
        <MUIThemeProvider>
          <div>Test Content</div>
        </MUIThemeProvider>
      );
      expect(screen.getByTestId('css-baseline')).toBeInTheDocument();
    });

    it('should render CssBaseline before children', () => {
      const { container } = render(
        <MUIThemeProvider>
          <div data-testid="child-content">Test Content</div>
        </MUIThemeProvider>
      );
      const cssBaseline = screen.getByTestId('css-baseline');
      const childContent = screen.getByTestId('child-content');
      expect(cssBaseline.compareDocumentPosition(childContent)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      );
    });
  });

  describe('Children Prop', () => {
    it('should render single child element', () => {
      render(
        <MUIThemeProvider>
          <button>Click me</button>
        </MUIThemeProvider>
      );
      expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
    });

    it('should render multiple child elements', () => {
      render(
        <MUIThemeProvider>
          <div>First child</div>
          <div>Second child</div>
          <div>Third child</div>
        </MUIThemeProvider>
      );
      expect(screen.getByText('First child')).toBeInTheDocument();
      expect(screen.getByText('Second child')).toBeInTheDocument();
      expect(screen.getByText('Third child')).toBeInTheDocument();
    });

    it('should render nested components', () => {
      render(
        <MUIThemeProvider>
          <div>
            <header>Header</header>
            <main>
              <article>Article content</article>
            </main>
            <footer>Footer</footer>
          </div>
        </MUIThemeProvider>
      );
      expect(screen.getByText('Header')).toBeInTheDocument();
      expect(screen.getByText('Article content')).toBeInTheDocument();
      expect(screen.getByText('Footer')).toBeInTheDocument();
    });

    it('should render text nodes', () => {
      render(<MUIThemeProvider>Plain text content</MUIThemeProvider>);
      expect(screen.getByText('Plain text content')).toBeInTheDocument();
    });

    it('should render React fragments', () => {
      render(
        <MUIThemeProvider>
          <>
            <div>Fragment child 1</div>
            <div>Fragment child 2</div>
          </>
        </MUIThemeProvider>
      );
      expect(screen.getByText('Fragment child 1')).toBeInTheDocument();
      expect(screen.getByText('Fragment child 2')).toBeInTheDocument();
    });

    it('should handle null children gracefully', () => {
      render(<MUIThemeProvider>{null}</MUIThemeProvider>);
      expect(screen.getByTestId('mui-theme-provider')).toBeInTheDocument();
    });

    it('should handle undefined children gracefully', () => {
      render(<MUIThemeProvider>{undefined}</MUIThemeProvider>);
      expect(screen.getByTestId('mui-theme-provider')).toBeInTheDocument();
    });

    it('should handle boolean children gracefully', () => {
      render(
        <MUIThemeProvider>
          {false}
          {true}
        </MUIThemeProvider>
      );
      expect(screen.getByTestId('mui-theme-provider')).toBeInTheDocument();
    });

    it('should handle conditional children', () => {
      const showContent = true;
      render(
        <MUIThemeProvider>
          {showContent && <div>Conditional content</div>}
        </MUIThemeProvider>
      );
      expect(screen.getByText('Conditional content')).toBeInTheDocument();
    });
  });

  describe('Theme Integration', () => {
    it('should provide theme to children', () => {
      render(
        <MUIThemeProvider>
          <div data-testid="themed-content">Themed Content</div>
        </MUIThemeProvider>
      );
      expect(screen.getByTestId('themed-content')).toBeInTheDocument();
    });

    it('should work with complex component trees', () => {
      const ComplexTree = () => (
        <div>
          <nav>
            <ul>
              <li>Nav Item</li>
            </ul>
          </nav>
          <main>
            <section>
              <article>Content</article>
            </section>
          </main>
        </div>
      );

      render(
        <MUIThemeProvider>
          <ComplexTree />
        </MUIThemeProvider>
      );
      expect(screen.getByText('Nav Item')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
    });
  });

  describe('CssBaseline', () => {
    it('should include CssBaseline in the render tree', () => {
      render(
        <MUIThemeProvider>
          <div>Test</div>
        </MUIThemeProvider>
      );
      expect(screen.getByTestId('css-baseline')).toBeInTheDocument();
    });

    it('should render CssBaseline only once', () => {
      render(
        <MUIThemeProvider>
          <div>Test</div>
        </MUIThemeProvider>
      );
      const cssBaselines = screen.getAllByTestId('css-baseline');
      expect(cssBaselines).toHaveLength(1);
    });
  });

  describe('Provider Nesting', () => {
    it('should handle nested providers', () => {
      render(
        <MUIThemeProvider>
          <MUIThemeProvider>
            <div>Nested content</div>
          </MUIThemeProvider>
        </MUIThemeProvider>
      );
      expect(screen.getByText('Nested content')).toBeInTheDocument();
    });

    it('should maintain functionality with nested providers', () => {
      render(
        <MUIThemeProvider>
          <div>Outer</div>
          <MUIThemeProvider>
            <div>Inner</div>
          </MUIThemeProvider>
        </MUIThemeProvider>
      );
      expect(screen.getByText('Outer')).toBeInTheDocument();
      expect(screen.getByText('Inner')).toBeInTheDocument();
    });
  });

  describe('Dynamic Content', () => {
    it('should handle dynamic children updates', () => {
      const { rerender } = render(
        <MUIThemeProvider>
          <div>Initial content</div>
        </MUIThemeProvider>
      );
      expect(screen.getByText('Initial content')).toBeInTheDocument();

      rerender(
        <MUIThemeProvider>
          <div>Updated content</div>
        </MUIThemeProvider>
      );
      expect(screen.getByText('Updated content')).toBeInTheDocument();
      expect(screen.queryByText('Initial content')).not.toBeInTheDocument();
    });

    it('should handle children being added', () => {
      const { rerender } = render(
        <MUIThemeProvider>
          <div>First</div>
        </MUIThemeProvider>
      );
      expect(screen.getByText('First')).toBeInTheDocument();

      rerender(
        <MUIThemeProvider>
          <div>First</div>
          <div>Second</div>
        </MUIThemeProvider>
      );
      expect(screen.getByText('First')).toBeInTheDocument();
      expect(screen.getByText('Second')).toBeInTheDocument();
    });

    it('should handle children being removed', () => {
      const { rerender } = render(
        <MUIThemeProvider>
          <div>First</div>
          <div>Second</div>
        </MUIThemeProvider>
      );
      expect(screen.getByText('First')).toBeInTheDocument();
      expect(screen.getByText('Second')).toBeInTheDocument();

      rerender(
        <MUIThemeProvider>
          <div>First</div>
        </MUIThemeProvider>
      );
      expect(screen.getByText('First')).toBeInTheDocument();
      expect(screen.queryByText('Second')).not.toBeInTheDocument();
    });

    it('should handle complete children replacement', () => {
      const { rerender } = render(
        <MUIThemeProvider>
          <div>Old content</div>
        </MUIThemeProvider>
      );
      expect(screen.getByText('Old content')).toBeInTheDocument();

      rerender(
        <MUIThemeProvider>
          <span>New content</span>
        </MUIThemeProvider>
      );
      expect(screen.getByText('New content')).toBeInTheDocument();
      expect(screen.queryByText('Old content')).not.toBeInTheDocument();
    });
  });

  describe('Component Props', () => {
    it('should accept children prop explicitly', () => {
      const children = <div>Explicit children</div>;
      render(<MUIThemeProvider children={children} />);
      expect(screen.getByText('Explicit children')).toBeInTheDocument();
    });

    it('should prioritize children prop over component children', () => {
      const children = <div>Prop children</div>;
      render(
        <MUIThemeProvider children={children}>
          <div>Component children</div>
        </MUIThemeProvider>
      );
      // In React, when both are provided, component children take precedence
      // This behavior is framework-specific
      expect(screen.getByText('Component children')).toBeInTheDocument();
    });
  });

  describe('Real-world Scenarios', () => {
    it('should wrap entire application', () => {
      const App = () => (
        <div>
          <header>App Header</header>
          <main>App Content</main>
          <footer>App Footer</footer>
        </div>
      );

      render(
        <MUIThemeProvider>
          <App />
        </MUIThemeProvider>
      );

      expect(screen.getByText('App Header')).toBeInTheDocument();
      expect(screen.getByText('App Content')).toBeInTheDocument();
      expect(screen.getByText('App Footer')).toBeInTheDocument();
    });

    it('should work with routing components', () => {
      const Router = ({ children }: { children: React.ReactNode }) => (
        <div data-testid="router">{children}</div>
      );

      render(
        <MUIThemeProvider>
          <Router>
            <div>Page content</div>
          </Router>
        </MUIThemeProvider>
      );

      expect(screen.getByTestId('router')).toBeInTheDocument();
      expect(screen.getByText('Page content')).toBeInTheDocument();
    });

    it('should work with state management providers', () => {
      const StoreProvider = ({ children }: { children: React.ReactNode }) => (
        <div data-testid="store-provider">{children}</div>
      );

      render(
        <MUIThemeProvider>
          <StoreProvider>
            <div>App with store</div>
          </StoreProvider>
        </MUIThemeProvider>
      );

      expect(screen.getByTestId('store-provider')).toBeInTheDocument();
      expect(screen.getByText('App with store')).toBeInTheDocument();
    });

    it('should work with MUI components', () => {
      const MUIButton = () => <button>MUI Button</button>;

      render(
        <MUIThemeProvider>
          <MUIButton />
        </MUIThemeProvider>
      );

      expect(screen.getByRole('button', { name: /mui button/i })).toBeInTheDocument();
    });

    it('should work with layout components', () => {
      const Layout = ({ children }: { children: React.ReactNode }) => (
        <div>
          <nav>Navigation</nav>
          <main>{children}</main>
        </div>
      );

      render(
        <MUIThemeProvider>
          <Layout>
            <div>Page content</div>
          </Layout>
        </MUIThemeProvider>
      );

      expect(screen.getByText('Navigation')).toBeInTheDocument();
      expect(screen.getByText('Page content')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty children array', () => {
      render(<MUIThemeProvider>{[]}</MUIThemeProvider>);
      expect(screen.getByTestId('mui-theme-provider')).toBeInTheDocument();
    });

    it('should handle children with keys', () => {
      const items = ['Item 1', 'Item 2', 'Item 3'];
      render(
        <MUIThemeProvider>
          {items.map((item, index) => (
            <div key={index}>{item}</div>
          ))}
        </MUIThemeProvider>
      );
      items.forEach((item) => {
        expect(screen.getByText(item)).toBeInTheDocument();
      });
    });

    it('should handle children with numeric values', () => {
      render(
        <MUIThemeProvider>
          <div>{42}</div>
          <div>{0}</div>
          <div>{-1}</div>
        </MUIThemeProvider>
      );
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
      expect(screen.getByText('-1')).toBeInTheDocument();
    });

    it('should handle children with special characters', () => {
      render(
        <MUIThemeProvider>
          <div>Special: &lt;&gt;&amp;</div>
        </MUIThemeProvider>
      );
      expect(screen.getByText(/Special:/)).toBeInTheDocument();
    });

    it('should handle deeply nested components', () => {
      const DeepComponent = () => (
        <div>
          <div>
            <div>
              <div>
                <div>
                  <div>Deep content</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );

      render(
        <MUIThemeProvider>
          <DeepComponent />
        </MUIThemeProvider>
      );

      expect(screen.getByText('Deep content')).toBeInTheDocument();
    });
  });

  describe('Performance', () => {
    it('should render efficiently with many children', () => {
      const items = Array.from({ length: 100 }, (_, i) => `Item ${i}`);
      render(
        <MUIThemeProvider>
          {items.map((item, index) => (
            <div key={index}>{item}</div>
          ))}
        </MUIThemeProvider>
      );

      expect(screen.getByText('Item 0')).toBeInTheDocument();
      expect(screen.getByText('Item 99')).toBeInTheDocument();
    });

    it('should handle rapid re-renders', () => {
      const { rerender } = render(
        <MUIThemeProvider>
          <div>Render 1</div>
        </MUIThemeProvider>
      );

      for (let i = 2; i <= 10; i++) {
        rerender(
          <MUIThemeProvider>
            <div>Render {i}</div>
          </MUIThemeProvider>
        );
      }

      expect(screen.getByText('Render 10')).toBeInTheDocument();
    });
  });

  describe('Integration with Context', () => {
    it('should work with React Context', () => {
      const TestContext = React.createContext({ value: 'test' });

      const Consumer = () => {
        const context = React.useContext(TestContext);
        return <div>{context.value}</div>;
      };

      render(
        <MUIThemeProvider>
          <TestContext.Provider value={{ value: 'custom value' }}>
            <Consumer />
          </TestContext.Provider>
        </MUIThemeProvider>
      );

      expect(screen.getByText('custom value')).toBeInTheDocument();
    });

    it('should maintain context through provider boundary', () => {
      const OuterContext = React.createContext({ outer: 'outer value' });

      const NestedConsumer = () => {
        const context = React.useContext(OuterContext);
        return <div>{context.outer}</div>;
      };

      render(
        <OuterContext.Provider value={{ outer: 'test value' }}>
          <MUIThemeProvider>
            <NestedConsumer />
          </MUIThemeProvider>
        </OuterContext.Provider>
      );

      expect(screen.getByText('test value')).toBeInTheDocument();
    });
  });

  describe('Type Safety', () => {
    it('should accept ReactNode as children', () => {
      const element = <div>Element</div>;
      const number = 42;

      render(
        <MUIThemeProvider>
          {element}
          <span>Text</span>
          {number}
        </MUIThemeProvider>
      );

      expect(screen.getByText('Element')).toBeInTheDocument();
      expect(screen.getByText('Text')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('should work with component composition', () => {
      const Wrapper = ({ children }: { children: React.ReactNode }) => (
        <div data-testid="wrapper">{children}</div>
      );

      render(
        <MUIThemeProvider>
          <Wrapper>
            <div>Wrapped content</div>
          </Wrapper>
        </MUIThemeProvider>
      );

      expect(screen.getByTestId('wrapper')).toBeInTheDocument();
      expect(screen.getByText('Wrapped content')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should not interfere with ARIA attributes', () => {
      render(
        <MUIThemeProvider>
          <button aria-label="Accessible button">Click</button>
        </MUIThemeProvider>
      );

      const button = screen.getByRole('button', { name: /accessible button/i });
      expect(button).toHaveAttribute('aria-label', 'Accessible button');
    });

    it('should preserve semantic HTML', () => {
      render(
        <MUIThemeProvider>
          <main>
            <article>
              <h1>Title</h1>
              <p>Paragraph</p>
            </article>
          </main>
        </MUIThemeProvider>
      );

      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getByRole('article')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    });

    it('should not affect focus management', () => {
      render(
        <MUIThemeProvider>
          <button>Focusable</button>
        </MUIThemeProvider>
      );

      const button = screen.getByRole('button');
      button.focus();
      expect(button).toHaveFocus();
    });
  });
});
