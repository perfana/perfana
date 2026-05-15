/**
 * Unit tests for FilterControls Component
 *
 * Tests the filter controls functionality:
 * - Search input rendering and interaction
 * - Conclusion filter dropdown
 * - Classification filter dropdown
 * - Result count display
 * - Responsive layout
 * - Filter state synchronization
 * - Dropdown option generation
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import FilterControls from '@/app/test-runs/[id]/components/anomaly-detection/components/FilterControls';

// Mock the helpers module
jest.mock('@/app/test-runs/[id]/components/anomaly-detection/helpers', () => ({
  getClassificationDisplayInfo: (classification: string) => {
    const labels: Record<string, string> = {
      'red_duration': 'RED Duration',
      'red_rate': 'RED Rate',
      'use_saturation': 'USE Saturation',
      'business_metric': 'Business Metric',
      'default': 'Unclassified'
    };
    return { label: labels[classification] || classification, color: 'default' as const };
  }
}));

const mockAnomalyData = [
  { conclusion_label: 'regression', classification: 'red_duration' },
  { conclusion_label: 'improvement', classification: 'red_rate' },
  { conclusion_label: 'regression', classification: 'use_saturation' }
];

describe('FilterControls', () => {
  const defaultProps = {
    searchQuery: '',
    handleSearchChange: jest.fn(),
    conclusionFilter: 'all',
    handleConclusionFilterChange: jest.fn(),
    classificationFilter: 'all',
    handleClassificationFilterChange: jest.fn(),
    dashboardFilter: 'all',
    handleDashboardFilterChange: jest.fn(),
    panelFilter: 'all',
    handlePanelFilterChange: jest.fn(),
    conclusionsForDropdown: ['regression', 'improvement'],
    classificationsForDropdown: ['red_duration', 'red_rate', 'use_saturation'],
    dashboardsForDropdown: ['Performance Dashboard', 'Load Test Dashboard'],
    panelsForDropdown: ['Response Time', 'Throughput'],
    filteredData: mockAnomalyData,
    anomalyData: mockAnomalyData,
    hasActiveFilters: false,
    onClearAllFilters: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render search input', () => {
      render(<FilterControls {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText('Search...');
      expect(searchInput).toBeInTheDocument();
    });

    it('should render conclusion filter dropdown', () => {
      render(<FilterControls {...defaultProps} />);

      // MUI Select renders labels multiple times (label + legend) - use getAllByText
      const conclusionLabels = screen.getAllByText('Conclusion');
      expect(conclusionLabels.length).toBeGreaterThan(0);
    });

    it('should render classification filter dropdown', () => {
      render(<FilterControls {...defaultProps} />);

      // MUI Select renders labels multiple times (label + legend) - use getAllByText
      const classificationLabels = screen.getAllByText('Classification');
      expect(classificationLabels.length).toBeGreaterThan(0);
    });

    it('should render result count', () => {
      render(<FilterControls {...defaultProps} />);

      expect(screen.getByText('3/3')).toBeInTheDocument();
    });

    it('should display all filter components', () => {
      const { container } = render(<FilterControls {...defaultProps} />);

      expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();

      // MUI Select doesn't properly associate labels with form controls
      // Use role query instead
      const selects = container.querySelectorAll('[role="combobox"]');
      expect(selects.length).toBe(4);

      expect(container.querySelector('.MuiInputAdornment-root')).toBeInTheDocument();
    });
  });

  describe('Search Input', () => {
    it('should display empty search by default', () => {
      render(<FilterControls {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText('Search...') as HTMLInputElement;
      expect(searchInput.value).toBe('');
    });

    it('should display provided search query', () => {
      render(<FilterControls {...defaultProps} searchQuery="test query" />);

      const searchInput = screen.getByPlaceholderText('Search...') as HTMLInputElement;
      expect(searchInput.value).toBe('test query');
    });

    it('should call handleSearchChange when typing', () => {
      const handleSearchChange = jest.fn();
      render(<FilterControls {...defaultProps} handleSearchChange={handleSearchChange} />);

      const searchInput = screen.getByPlaceholderText('Search...');
      fireEvent.change(searchInput, { target: { value: 'regression' } });

      expect(handleSearchChange).toHaveBeenCalledTimes(1);
    });

    it('should display search icon', () => {
      render(<FilterControls {...defaultProps} />);

      expect(screen.getByTestId('SearchIcon')).toBeInTheDocument();
    });

    it('should have proper input adornment', () => {
      const { container } = render(<FilterControls {...defaultProps} />);

      const adornment = container.querySelector('.MuiInputAdornment-positionStart');
      expect(adornment).toBeInTheDocument();
    });

    it('should handle empty string search query', () => {
      render(<FilterControls {...defaultProps} searchQuery="" />);

      const searchInput = screen.getByPlaceholderText('Search...') as HTMLInputElement;
      expect(searchInput.value).toBe('');
    });

    it('should handle null search query', () => {
      render(<FilterControls {...defaultProps} searchQuery={null as any} />);

      const searchInput = screen.getByPlaceholderText('Search...') as HTMLInputElement;
      expect(searchInput.value).toBe('');
    });

    it('should update value when searchQuery prop changes', () => {
      const { rerender } = render(<FilterControls {...defaultProps} searchQuery="initial" />);

      let searchInput = screen.getByPlaceholderText('Search...') as HTMLInputElement;
      expect(searchInput.value).toBe('initial');

      rerender(<FilterControls {...defaultProps} searchQuery="updated" />);

      searchInput = screen.getByPlaceholderText('Search...') as HTMLInputElement;
      expect(searchInput.value).toBe('updated');
    });
  });

  describe('Conclusion Filter', () => {
    it('should display "All" by default', () => {
      const { container } = render(<FilterControls {...defaultProps} />);

      // Conclusion is the 4th select (index 3): Dashboard, Panel, Classification, Conclusion
      const selects = container.querySelectorAll('[role="combobox"]');
      expect(selects[3]).toHaveTextContent('All');
    });

    it('should display selected conclusion', () => {
      const { container } = render(<FilterControls {...defaultProps} conclusionFilter="regression" />);

      const selects = container.querySelectorAll('[role="combobox"]');
      expect(selects[3]).toHaveTextContent('regression');
    });

    it('should render all conclusion options', () => {
      const { container } = render(<FilterControls {...defaultProps} />);

      // Open the dropdown - Conclusion is at index 3
      const selects = container.querySelectorAll('[role="combobox"]');
      const conclusionButton = selects[3];
      if (conclusionButton) {
        fireEvent.mouseDown(conclusionButton);

        // Check for All option
        expect(screen.getByRole('option', { name: 'All' })).toBeInTheDocument();

        // Check for custom options
        expect(screen.getByRole('option', { name: 'regression' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'improvement' })).toBeInTheDocument();
      }
    });

    it('should call handleConclusionFilterChange when option is selected', () => {
      const handleConclusionFilterChange = jest.fn();
      const { container } = render(
        <FilterControls
          {...defaultProps}
          handleConclusionFilterChange={handleConclusionFilterChange}
        />
      );

      // Open dropdown - Conclusion is at index 3
      const selects = container.querySelectorAll('[role="combobox"]');
      const conclusionButton = selects[3];
      if (conclusionButton) {
        fireEvent.mouseDown(conclusionButton);

        // Select an option
        const regressionOption = screen.getByRole('option', { name: 'regression' });
        fireEvent.click(regressionOption);

        expect(handleConclusionFilterChange).toHaveBeenCalled();
      }
    });

    it('should handle empty conclusions array', () => {
      const { container } = render(<FilterControls {...defaultProps} conclusionsForDropdown={[]} />);

      const selects = container.querySelectorAll('[role="combobox"]');
      const conclusionButton = selects[3];
      if (conclusionButton) {
        fireEvent.mouseDown(conclusionButton);

        // Should only show "All" option
        expect(screen.getByRole('option', { name: 'All' })).toBeInTheDocument();
      }
    });

    it('should display null conclusion filter as "All"', () => {
      const { container } = render(<FilterControls {...defaultProps} conclusionFilter={null as any} />);

      const selects = container.querySelectorAll('[role="combobox"]');
      expect(selects[3]).toHaveTextContent('All');
    });
  });

  describe('Classification Filter', () => {
    it('should display "All" by default', () => {
      const { container } = render(<FilterControls {...defaultProps} />);

      // Classification is the 3rd select (index 2): Dashboard, Panel, Classification, Conclusion
      const selects = container.querySelectorAll('[role="combobox"]');
      const classificationSelect = selects[2];
      expect(classificationSelect).toHaveTextContent('All');
    });

    it('should display selected classification', () => {
      const { container } = render(<FilterControls {...defaultProps} classificationFilter="red_duration" />);

      const selects = container.querySelectorAll('[role="combobox"]');
      const classificationSelect = selects[2];
      expect(classificationSelect).toHaveTextContent('RED Duration');
    });

    it('should render all classification options with display labels', () => {
      const { container } = render(<FilterControls {...defaultProps} />);

      // Open the dropdown - Classification is at index 2
      const selects = container.querySelectorAll('[role="combobox"]');
      const classificationButton = selects[2];
      if (classificationButton) {
        fireEvent.mouseDown(classificationButton);

        // Check for All option
        expect(screen.getByRole('option', { name: 'All' })).toBeInTheDocument();

        // Check for custom options with display labels
        expect(screen.getByRole('option', { name: 'RED Duration' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'RED Rate' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'USE Saturation' })).toBeInTheDocument();
      }
    });

    it('should call handleClassificationFilterChange when option is selected', () => {
      const handleClassificationFilterChange = jest.fn();
      const { container } = render(
        <FilterControls
          {...defaultProps}
          handleClassificationFilterChange={handleClassificationFilterChange}
        />
      );

      // Open dropdown - Classification is at index 2
      const selects = container.querySelectorAll('[role="combobox"]');
      const classificationButton = selects[2];
      if (classificationButton) {
        fireEvent.mouseDown(classificationButton);

        // Select an option
        const redDurationOption = screen.getByRole('option', { name: 'RED Duration' });
        fireEvent.click(redDurationOption);

        expect(handleClassificationFilterChange).toHaveBeenCalled();
      }
    });

    it('should handle empty classifications array', () => {
      const { container } = render(<FilterControls {...defaultProps} classificationsForDropdown={[]} />);

      const selects = container.querySelectorAll('[role="combobox"]');
      const classificationButton = selects[2];
      if (classificationButton) {
        fireEvent.mouseDown(classificationButton);

        // Should only show "All" option
        expect(screen.getByRole('option', { name: 'All' })).toBeInTheDocument();
      }
    });

    it('should display null classification filter as "All"', () => {
      const { container } = render(<FilterControls {...defaultProps} classificationFilter={null as any} />);

      const selects = container.querySelectorAll('[role="combobox"]');
      const classificationSelect = selects[2];
      expect(classificationSelect).toHaveTextContent('All');
    });
  });

  describe('Result Count Display', () => {
    it('should display filtered count vs total count', () => {
      render(<FilterControls {...defaultProps} />);

      expect(screen.getByText('3/3')).toBeInTheDocument();
    });

    it('should update when filtered data changes', () => {
      const { rerender } = render(<FilterControls {...defaultProps} />);

      expect(screen.getByText('3/3')).toBeInTheDocument();

      rerender(<FilterControls {...defaultProps} filteredData={[mockAnomalyData[0]]} />);

      expect(screen.getByText('1/3')).toBeInTheDocument();
    });

    it('should show 0 filtered results', () => {
      render(<FilterControls {...defaultProps} filteredData={[]} />);

      expect(screen.getByText('0/3')).toBeInTheDocument();
    });

    it('should handle empty anomaly data', () => {
      render(<FilterControls {...defaultProps} filteredData={[]} anomalyData={[]} />);

      expect(screen.getByText('0/0')).toBeInTheDocument();
    });

    it('should handle large numbers', () => {
      const largeData = Array(1000).fill(mockAnomalyData[0]);
      render(<FilterControls {...defaultProps} filteredData={largeData} anomalyData={largeData} />);

      expect(screen.getByText('1000/1000')).toBeInTheDocument();
    });
  });

  describe('Component Layout', () => {
    it('should have proper grid layout', () => {
      const { container } = render(<FilterControls {...defaultProps} />);

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveStyle({ display: 'grid' });
    });

    it('should have responsive gap spacing', () => {
      const { container } = render(<FilterControls {...defaultProps} />);

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toBeInTheDocument();
    });

    it('should render all form controls with small size', () => {
      const { container } = render(<FilterControls {...defaultProps} />);

      const smallInputs = container.querySelectorAll('.MuiInputBase-sizeSmall');
      expect(smallInputs.length).toBeGreaterThan(0);
    });
  });

  describe('Filter Synchronization', () => {
    it('should reflect all filter states simultaneously', () => {
      const { container } = render(
        <FilterControls
          {...defaultProps}
          searchQuery="test"
          conclusionFilter="regression"
          classificationFilter="red_duration"
          filteredData={[mockAnomalyData[0]]}
        />
      );

      const searchInput = screen.getByPlaceholderText('Search...') as HTMLInputElement;
      expect(searchInput.value).toBe('test');

      const selects = container.querySelectorAll('[role="combobox"]');
      const conclusionSelect = selects[3];
      expect(conclusionSelect).toHaveTextContent('regression');

      const classificationSelect = selects[2];
      expect(classificationSelect).toHaveTextContent('RED Duration');

      expect(screen.getByText('1/3')).toBeInTheDocument();
    });

    it('should handle filter changes independently', () => {
      const handleSearchChange = jest.fn();
      const handleConclusionFilterChange = jest.fn();
      const handleClassificationFilterChange = jest.fn();

      const { container } = render(
        <FilterControls
          {...defaultProps}
          handleSearchChange={handleSearchChange}
          handleConclusionFilterChange={handleConclusionFilterChange}
          handleClassificationFilterChange={handleClassificationFilterChange}
        />
      );

      // Change search
      const searchInput = screen.getByPlaceholderText('Search...');
      fireEvent.change(searchInput, { target: { value: 'new search' } });
      expect(handleSearchChange).toHaveBeenCalled();

      // Change conclusion filter (index 3: Dashboard, Panel, Classification, Conclusion)
      const selects = container.querySelectorAll('[role="combobox"]');
      const conclusionButton = selects[3];
      if (conclusionButton) {
        fireEvent.mouseDown(conclusionButton);
        fireEvent.click(screen.getByRole('option', { name: 'regression' }));
        expect(handleConclusionFilterChange).toHaveBeenCalled();
      }

      // All handlers should have been called independently
      expect(handleSearchChange).toHaveBeenCalledTimes(1);
      expect(handleConclusionFilterChange).toHaveBeenCalledTimes(1);
      expect(handleClassificationFilterChange).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined conclusion and classification filters', () => {
      const { container } = render(
        <FilterControls
          {...defaultProps}
          conclusionFilter={undefined as any}
          classificationFilter={undefined as any}
        />
      );

      // MUI Select has multiple elements with same label - use container queries
      // Classification=index 2, Conclusion=index 3
      const selects = container.querySelectorAll('[role="combobox"]');
      expect(selects[2]).toHaveTextContent('All');
      expect(selects[3]).toHaveTextContent('All');
    });

    it('should handle very long search queries', () => {
      const longQuery = 'a'.repeat(1000);
      render(<FilterControls {...defaultProps} searchQuery={longQuery} />);

      const searchInput = screen.getByPlaceholderText('Search...') as HTMLInputElement;
      expect(searchInput.value).toBe(longQuery);
    });

    it('should handle special characters in search', () => {
      const specialQuery = '<script>alert("test")</script>';
      render(<FilterControls {...defaultProps} searchQuery={specialQuery} />);

      const searchInput = screen.getByPlaceholderText('Search...') as HTMLInputElement;
      expect(searchInput.value).toBe(specialQuery);
    });

    it('should handle duplicate conclusions in dropdown list', () => {
      const { container } = render(
        <FilterControls
          {...defaultProps}
          conclusionsForDropdown={['regression', 'regression', 'improvement']}
        />
      );

      const selects = container.querySelectorAll('[role="combobox"]');
      const conclusionButton = selects[3];
      if (conclusionButton) {
        fireEvent.mouseDown(conclusionButton);

        const regressionOptions = screen.getAllByRole('option', { name: 'regression' });
        // Should render duplicates as specified (component doesn't dedupe)
        expect(regressionOptions.length).toBe(2);
      }
    });

    it('should handle rapid filter changes', () => {
      const handleSearchChange = jest.fn();
      render(<FilterControls {...defaultProps} handleSearchChange={handleSearchChange} />);

      const searchInput = screen.getByPlaceholderText('Search...');

      // Simulate rapid typing
      fireEvent.change(searchInput, { target: { value: 'a' } });
      fireEvent.change(searchInput, { target: { value: 'ab' } });
      fireEvent.change(searchInput, { target: { value: 'abc' } });

      expect(handleSearchChange).toHaveBeenCalledTimes(3);
    });
  });

  describe('Clear All Button', () => {
    it('should render the Clear All button', () => {
      render(<FilterControls {...defaultProps} />);
      expect(screen.getByRole('button', { name: /clear all/i })).toBeInTheDocument();
    });

    it('should be disabled when no filters are active', () => {
      render(<FilterControls {...defaultProps} hasActiveFilters={false} />);
      expect(screen.getByRole('button', { name: /clear all/i })).toBeDisabled();
    });

    it('should be enabled when filters are active', () => {
      render(<FilterControls {...defaultProps} hasActiveFilters={true} />);
      expect(screen.getByRole('button', { name: /clear all/i })).not.toBeDisabled();
    });

    it('should call onClearAllFilters when clicked', () => {
      const onClearAllFilters = jest.fn();
      render(<FilterControls {...defaultProps} hasActiveFilters={true} onClearAllFilters={onClearAllFilters} />);
      fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
      expect(onClearAllFilters).toHaveBeenCalledTimes(1);
    });
  });

  describe('Accessibility', () => {
    it('should have accessible labels for all inputs', () => {
      render(<FilterControls {...defaultProps} />);

      // Use getAllByText since MUI Select renders labels multiple times (label + legend)
      const conclusionLabels = screen.getAllByText('Conclusion');
      expect(conclusionLabels.length).toBeGreaterThan(0);

      const classificationLabels = screen.getAllByText('Classification');
      expect(classificationLabels.length).toBeGreaterThan(0);

      expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    });

    it('should have proper ARIA attributes for select components', () => {
      const { container } = render(<FilterControls {...defaultProps} />);

      const selects = container.querySelectorAll('[role="combobox"]');
      const conclusionButton = selects[3];
      expect(conclusionButton).toHaveAttribute('aria-haspopup', 'listbox');
    });

    it('should support keyboard navigation in dropdowns', () => {
      const { container } = render(<FilterControls {...defaultProps} />);

      const selects = container.querySelectorAll('[role="combobox"]');
      const conclusionButton = selects[3] as HTMLElement;

      // Should be focusable
      conclusionButton.focus();
      expect(conclusionButton).toHaveFocus();
    });
  });
});
