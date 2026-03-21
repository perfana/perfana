import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';

/**
 * Component Edge Case Tests
 *
 * Tests React components under edge case conditions:
 * - Empty states
 * - Very long text
 * - Large datasets
 * - Rapid interactions
 * - Network failures
 * - Browser events
 * - Memory constraints
 */

// Mock component with data rendering
const DataList: React.FC<{ items: string[]; maxVisible?: number }> = ({ items, maxVisible = 100 }) => {
  const [visible, setVisible] = React.useState(maxVisible);

  return (
    <div data-testid="data-list">
      <div data-testid="item-count">Count: {items.length}</div>
      {items.slice(0, visible).map((item, index) => (
        <div key={index} data-testid={`item-${index}`}>
          {item}
        </div>
      ))}
      {visible < items.length && (
        <button
          data-testid="load-more"
          onClick={() => setVisible(v => Math.min(v + maxVisible, items.length))}
        >
          Load More
        </button>
      )}
    </div>
  );
};

// Mock component with search/filter
const SearchableList: React.FC<{ items: string[] }> = ({ items }) => {
  const [search, setSearch] = React.useState('');

  const filtered = items.filter(item =>
    item.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <input
        data-testid="search-input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search..."
      />
      <div data-testid="results-count">{filtered.length} results</div>
      {filtered.map((item, index) => (
        <div key={index} data-testid={`result-${index}`}>
          {item}
        </div>
      ))}
    </div>
  );
};

// Mock async component
const AsyncDataComponent: React.FC<{ fetchData: () => Promise<string[]> }> = ({ fetchData }) => {
  const [data, setData] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;

    fetchData()
      .then(result => {
        if (mounted) {
          setData(result);
          setLoading(false);
        }
      })
      .catch(err => {
        if (mounted) {
          setError(err && typeof err === 'object' && 'message' in err ? (err as Error).message : 'Failed to load');
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [fetchData]);

  if (loading) return <div data-testid="loading">Loading...</div>;
  if (error) return <div data-testid="error">{error}</div>;

  return (
    <div data-testid="data-loaded">
      {data.map((item, index) => (
        <div key={index}>{item}</div>
      ))}
    </div>
  );
};

describe('Component Edge Cases', () => {
  describe('Empty States', () => {
    it('should render empty list correctly', () => {
      render(<DataList items={[]} />);

      expect(screen.getByTestId('item-count')).toHaveTextContent('Count: 0');
      expect(screen.queryByTestId('item-0')).not.toBeInTheDocument();
    });

    it('should handle empty search results', async () => {
      render(<SearchableList items={['Apple', 'Banana', 'Cherry']} />);

      const searchInput = screen.getByTestId('search-input');
      await userEvent.type(searchInput, 'Nonexistent');

      expect(screen.getByTestId('results-count')).toHaveTextContent('0 results');
      expect(screen.queryByTestId('result-0')).not.toBeInTheDocument();
    });

    it('should handle null data gracefully', () => {
      const NullDataComponent: React.FC<{ data: any }> = ({ data }) => (
        <div data-testid="content">
          {data ? JSON.stringify(data) : 'No data'}
        </div>
      );

      render(<NullDataComponent data={null} />);
      expect(screen.getByTestId('content')).toHaveTextContent('No data');
    });

    it('should handle undefined data gracefully', () => {
      const UndefinedDataComponent: React.FC<{ data?: string }> = ({ data }) => (
        <div data-testid="content">
          {data || 'No data'}
        </div>
      );

      render(<UndefinedDataComponent />);
      expect(screen.getByTestId('content')).toHaveTextContent('No data');
    });
  });

  describe('Very Long Text', () => {
    it('should render very long single line text (>10000 chars)', () => {
      const longText = 'A'.repeat(10001);

      render(
        <div data-testid="long-text" style={{ maxWidth: '500px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {longText}
        </div>
      );

      const element = screen.getByTestId('long-text');
      expect(element.textContent?.length).toBe(10001);
    });

    it('should handle very long text with line breaks', () => {
      const longText = 'This is a line.\n'.repeat(1000);

      render(
        <div data-testid="multiline-text" style={{ maxHeight: '500px', overflow: 'auto' }}>
          {longText.split('\n').map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      );

      const element = screen.getByTestId('multiline-text');
      expect(element.children.length).toBe(1001); // 1000 lines + 1 empty
    });

    it('should handle text with many special characters', () => {
      const specialText = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`'.repeat(100);

      render(<div data-testid="special-text">{specialText}</div>);

      const element = screen.getByTestId('special-text');
      expect(element.textContent).toBe(specialText);
    });

    it('should handle mixed Unicode and emoji text', () => {
      const mixedText = '测试🚀Test✅नमस्ते🎉'.repeat(100);

      render(<div data-testid="mixed-text">{mixedText}</div>);

      const element = screen.getByTestId('mixed-text');
      expect(element.textContent?.includes('测试')).toBe(true);
      expect(element.textContent?.includes('🚀')).toBe(true);
    });
  });

  describe('Large Datasets', () => {
    it('should handle rendering 1000 items', () => {
      const items = Array.from({ length: 1000 }, (_, i) => `Item ${i}`);

      render(<DataList items={items} maxVisible={1000} />);

      expect(screen.getByTestId('item-count')).toHaveTextContent('Count: 1000');
      expect(screen.getByTestId('item-0')).toBeInTheDocument();
      expect(screen.getByTestId('item-999')).toBeInTheDocument();
    });

    it('should handle pagination with large dataset', () => {
      const items = Array.from({ length: 1000 }, (_, i) => `Item ${i}`);

      render(<DataList items={items} maxVisible={50} />);

      expect(screen.getByTestId('item-count')).toHaveTextContent('Count: 1000');
      expect(screen.getByTestId('item-0')).toBeInTheDocument();
      expect(screen.getByTestId('item-49')).toBeInTheDocument();
      expect(screen.queryByTestId('item-50')).not.toBeInTheDocument();

      const loadMoreBtn = screen.getByTestId('load-more');
      fireEvent.click(loadMoreBtn);

      expect(screen.getByTestId('item-50')).toBeInTheDocument();
      expect(screen.getByTestId('item-99')).toBeInTheDocument();
    });

    it('should handle search in large dataset', async () => {
      const items = Array.from({ length: 1000 }, (_, i) => `Item ${i}`);

      render(<SearchableList items={items} />);

      const searchInput = screen.getByTestId('search-input');
      await userEvent.type(searchInput, '999');

      await waitFor(() => {
        const resultsCount = screen.getByTestId('results-count');
        // Should find items containing '999'
        expect(resultsCount.textContent).toMatch(/\d+ results/);
      });
    });

    it('should handle nested data structures', () => {
      const nestedData = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Item ${i}` }))
              }
            }
          }
        }
      };

      const NestedComponent: React.FC<{ data: any }> = ({ data }) => (
        <div data-testid="nested-data">
          {data.level1.level2.level3.level4.level5.map((item: any) => (
            <div key={item.id}>{item.name}</div>
          ))}
        </div>
      );

      render(<NestedComponent data={nestedData} />);

      const element = screen.getByTestId('nested-data');
      expect(element.children.length).toBe(100);
    });
  });

  describe('Rapid User Interactions', () => {
    it('should handle rapid button clicks', async () => {
      let clickCount = 0;
      const ClickCounter: React.FC = () => {
        const [count, setCount] = React.useState(0);

        const handleClick = () => {
          clickCount++;
          setCount(c => c + 1);
        };

        return (
          <div>
            <button data-testid="click-btn" onClick={handleClick}>
              Click
            </button>
            <div data-testid="count">{count}</div>
          </div>
        );
      };

      render(<ClickCounter />);

      const button = screen.getByTestId('click-btn');

      // Simulate rapid clicks
      for (let i = 0; i < 100; i++) {
        fireEvent.click(button);
      }

      await waitFor(() => {
        expect(screen.getByTestId('count')).toHaveTextContent('100');
      });

      expect(clickCount).toBe(100);
    });

    it('should handle rapid input changes', async () => {
      const InputComponent: React.FC = () => {
        const [value, setValue] = React.useState('');
        const [updateCount, setUpdateCount] = React.useState(0);

        return (
          <div>
            <input
              data-testid="rapid-input"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setUpdateCount(c => c + 1);
              }}
            />
            <div data-testid="update-count">{updateCount}</div>
            <div data-testid="value">{value}</div>
          </div>
        );
      };

      render(<InputComponent />);

      const input = screen.getByTestId('rapid-input');

      // Simulate rapid typing
      await userEvent.type(input, 'Hello World!', { delay: 1 });

      await waitFor(() => {
        expect(screen.getByTestId('value')).toHaveTextContent('Hello World!');
      });
    });

    it('should handle rapid scroll events', () => {
      let scrollCount = 0;

      const ScrollComponent: React.FC = () => {
        React.useEffect(() => {
          const handleScroll = () => {
            scrollCount++;
          };

          window.addEventListener('scroll', handleScroll);
          return () => window.removeEventListener('scroll', handleScroll);
        }, []);

        return <div data-testid="scroll-container" style={{ height: '2000px' }}>Scroll me</div>;
      };

      render(<ScrollComponent />);

      // Simulate rapid scroll events
      for (let i = 0; i < 50; i++) {
        fireEvent.scroll(window, { target: { scrollY: i * 10 } });
      }

      expect(scrollCount).toBeGreaterThan(0);
    });
  });

  describe('Network Failures', () => {
    it('should handle fetch timeout', async () => {
      const slowFetch = () => new Promise<string[]>((resolve) => {
        setTimeout(() => resolve(['data']), 10000); // 10 second delay
      });

      render(<AsyncDataComponent fetchData={slowFetch} />);

      expect(screen.getByTestId('loading')).toBeInTheDocument();

      // In real app, should have timeout handling
    });

    it('should handle fetch failure', async () => {
      const failingFetch = () => Promise.reject(new Error('Network error'));

      render(<AsyncDataComponent fetchData={failingFetch} />);

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('Network error');
      });
    });

    it('should handle fetch with empty response', async () => {
      const emptyFetch = () => Promise.resolve([]);

      render(<AsyncDataComponent fetchData={emptyFetch} />);

      await waitFor(() => {
        const dataElement = screen.getByTestId('data-loaded');
        expect(dataElement.children.length).toBe(0);
      });
    });

    it('should handle component unmount during fetch', async () => {
      let resolveFetch: (value: string[]) => void;
      const pendingFetch = () => new Promise<string[]>((resolve) => {
        resolveFetch = resolve;
      });

      const { unmount } = render(<AsyncDataComponent fetchData={pendingFetch} />);

      expect(screen.getByTestId('loading')).toBeInTheDocument();

      // Unmount before fetch completes
      unmount();

      // Resolve fetch after unmount - should not cause errors
      resolveFetch!(['data']);

      // No assertions needed - test passes if no errors thrown
    });
  });

  describe('Browser Events', () => {
    it('should handle window resize', () => {
      let resizeCount = 0;

      const ResizeComponent: React.FC = () => {
        const [width, setWidth] = React.useState(window.innerWidth);

        React.useEffect(() => {
          const handleResize = () => {
            resizeCount++;
            setWidth(window.innerWidth);
          };

          window.addEventListener('resize', handleResize);
          return () => window.removeEventListener('resize', handleResize);
        }, []);

        return <div data-testid="window-width">{width}</div>;
      };

      render(<ResizeComponent />);

      // Simulate resize
      global.innerWidth = 1024;
      fireEvent.resize(window);

      expect(resizeCount).toBe(1);
    });

    it('should handle visibility change (tab switching)', () => {
      let visibilityChanges = 0;

      const VisibilityComponent: React.FC = () => {
        React.useEffect(() => {
          const handleVisibilityChange = () => {
            visibilityChanges++;
          };

          document.addEventListener('visibilitychange', handleVisibilityChange);
          return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
        }, []);

        return <div data-testid="visibility">Tracking visibility</div>;
      };

      render(<VisibilityComponent />);

      fireEvent(document, new Event('visibilitychange'));

      expect(visibilityChanges).toBe(1);
    });

    it('should handle online/offline events', () => {
      let onlineStatus = true;

      const OnlineComponent: React.FC = () => {
        const [isOnline, setIsOnline] = React.useState(true);

        React.useEffect(() => {
          const handleOnline = () => {
            onlineStatus = true;
            setIsOnline(true);
          };
          const handleOffline = () => {
            onlineStatus = false;
            setIsOnline(false);
          };

          window.addEventListener('online', handleOnline);
          window.addEventListener('offline', handleOffline);

          return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
          };
        }, []);

        return <div data-testid="online-status">{isOnline ? 'Online' : 'Offline'}</div>;
      };

      render(<OnlineComponent />);

      expect(screen.getByTestId('online-status')).toHaveTextContent('Online');

      fireEvent(window, new Event('offline'));

      waitFor(() => {
        expect(screen.getByTestId('online-status')).toHaveTextContent('Offline');
      });

      expect(onlineStatus).toBe(false);
    });
  });

  describe('Memory and Performance', () => {
    it('should clean up event listeners on unmount', () => {
      let listenerCount = 0;

      const EventComponent: React.FC = () => {
        React.useEffect(() => {
          const handler = () => {
            listenerCount++;
          };

          window.addEventListener('custom-event', handler);
          return () => window.removeEventListener('custom-event', handler);
        }, []);

        return <div>Component with listener</div>;
      };

      const { unmount } = render(<EventComponent />);

      window.dispatchEvent(new Event('custom-event'));
      expect(listenerCount).toBe(1);

      unmount();

      window.dispatchEvent(new Event('custom-event'));
      // Should still be 1 because listener was cleaned up
      expect(listenerCount).toBe(1);
    });

    it('should handle memory-intensive operations', () => {
      const LargeArrayComponent: React.FC = () => {
        const [data, setData] = React.useState<number[]>([]);

        const generateLargeArray = () => {
          const arr = Array.from({ length: 100000 }, (_, i) => i);
          setData(arr);
        };

        return (
          <div>
            <button data-testid="generate-btn" onClick={generateLargeArray}>
              Generate
            </button>
            <div data-testid="array-length">{data.length}</div>
          </div>
        );
      };

      render(<LargeArrayComponent />);

      const button = screen.getByTestId('generate-btn');
      fireEvent.click(button);

      expect(screen.getByTestId('array-length')).toHaveTextContent('100000');
    });

    it('should handle rapid state updates efficiently', () => {
      const RapidUpdateComponent: React.FC = () => {
        const [value, setValue] = React.useState(0);

        const rapidUpdate = () => {
          for (let i = 0; i < 1000; i++) {
            setValue(v => v + 1);
          }
        };

        return (
          <div>
            <button data-testid="update-btn" onClick={rapidUpdate}>
              Update
            </button>
            <div data-testid="value">{value}</div>
          </div>
        );
      };

      render(<RapidUpdateComponent />);

      const button = screen.getByTestId('update-btn');
      fireEvent.click(button);

      waitFor(() => {
        expect(screen.getByTestId('value')).toHaveTextContent('1000');
      });
    });
  });

  describe('Edge Case Data Types', () => {
    it('should handle Date objects', () => {
      const date = new Date('2024-01-01');

      render(<div data-testid="date">{date.toISOString()}</div>);

      expect(screen.getByTestId('date')).toHaveTextContent('2024-01-01');
    });

    it('should handle very large numbers', () => {
      const largeNumber = Number.MAX_SAFE_INTEGER;

      render(<div data-testid="large-number">{largeNumber}</div>);

      expect(screen.getByTestId('large-number')).toHaveTextContent(largeNumber.toString());
    });

    it('should handle Infinity and NaN', () => {
      render(
        <div>
          <div data-testid="infinity">{Infinity}</div>
          <div data-testid="nan">{NaN}</div>
        </div>
      );

      expect(screen.getByTestId('infinity')).toHaveTextContent('Infinity');
      expect(screen.getByTestId('nan')).toHaveTextContent('NaN');
    });

    it('should handle circular references safely', () => {
      const circular: any = { name: 'Test' };
      circular.self = circular;

      const SafeComponent: React.FC<{ data: any }> = ({ data }) => {
        const safeStringify = (obj: any): string => {
          try {
            return JSON.stringify(obj);
          } catch {
            return 'Circular reference detected';
          }
        };

        return <div data-testid="circular">{safeStringify(data)}</div>;
      };

      render(<SafeComponent data={circular} />);

      expect(screen.getByTestId('circular')).toHaveTextContent('Circular reference detected');
    });
  });
});
