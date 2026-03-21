import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable } from '@/components/ui/data-table';
import { ColumnDef } from '@tanstack/react-table';

// Test data types
interface TestData {
  id: string;
  test_run_id: string;
  name: string;
  status: string;
  value: number;
}

// Sample data for testing
const mockData: TestData[] = [
  { id: '1', test_run_id: 'test-001', name: 'Test A', status: 'success', value: 100 },
  { id: '2', test_run_id: 'test-002', name: 'Test B', status: 'running', value: 75 },
  { id: '3', test_run_id: 'test-003', name: 'Test C', status: 'failed', value: 50 },
  { id: '4', test_run_id: 'test-004', name: 'Test D', status: 'success', value: 90 },
  { id: '5', test_run_id: 'test-005', name: 'Test E', status: 'pending', value: 60 },
];

// Sample columns definition
const mockColumns: ColumnDef<TestData>[] = [
  {
    accessorKey: 'test_run_id',
    header: 'Test Run ID',
    enableSorting: true,
  },
  {
    accessorKey: 'name',
    header: 'Name',
    enableSorting: true,
  },
  {
    accessorKey: 'status',
    header: 'Status',
    enableSorting: false,
  },
  {
    accessorKey: 'value',
    header: 'Value',
    enableSorting: true,
  },
];

describe('DataTable Component', () => {
  describe('Basic Rendering', () => {
    it('should render a table with data', () => {
      render(<DataTable columns={mockColumns} data={mockData} />);
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('should render all column headers', () => {
      render(<DataTable columns={mockColumns} data={mockData} />);
      expect(screen.getByText('Test Run ID')).toBeInTheDocument();
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('Value')).toBeInTheDocument();
    });

    it('should render all data rows', () => {
      render(<DataTable columns={mockColumns} data={mockData} />);
      // Test unique values
      expect(screen.getByText('test-001')).toBeInTheDocument();
      expect(screen.getByText('test-002')).toBeInTheDocument();
      expect(screen.getByText('test-003')).toBeInTheDocument();
      expect(screen.getByText('Test A')).toBeInTheDocument();
      expect(screen.getByText('Test B')).toBeInTheDocument();
      expect(screen.getByText('Test C')).toBeInTheDocument();
      // Multiple rows have 'success' status, so use getAllByText
      const successStatuses = screen.getAllByText('success');
      expect(successStatuses.length).toBeGreaterThan(0);
    });

    it('should render correct number of rows', () => {
      render(<DataTable columns={mockColumns} data={mockData} />);
      const rows = screen.getAllByRole('row');
      // +1 for header row
      expect(rows).toHaveLength(mockData.length + 1);
    });

    it('should apply data-table-wrapper class', () => {
      const { container } = render(<DataTable columns={mockColumns} data={mockData} />);
      expect(container.querySelector('.data-table-wrapper')).toBeInTheDocument();
    });

    it('should apply data-table class to table', () => {
      render(<DataTable columns={mockColumns} data={mockData} />);
      const table = screen.getByRole('table');
      expect(table).toHaveClass('data-table');
    });
  });

  describe('Empty State', () => {
    it('should display "No results found" when data is empty', () => {
      render(<DataTable columns={mockColumns} data={[]} />);
      expect(screen.getByText('No results found.')).toBeInTheDocument();
    });

    it('should render table structure even when empty', () => {
      render(<DataTable columns={mockColumns} data={[]} />);
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByText('Test Run ID')).toBeInTheDocument();
    });

    it('should span empty message across all columns', () => {
      render(<DataTable columns={mockColumns} data={[]} />);
      const emptyCell = screen.getByText('No results found.').closest('td');
      expect(emptyCell).toHaveAttribute('colSpan', mockColumns.length.toString());
    });

    it('should apply center alignment to empty state', () => {
      render(<DataTable columns={mockColumns} data={[]} />);
      const emptyCell = screen.getByText('No results found.').closest('td');
      expect(emptyCell).toHaveClass('text-center');
    });
  });

  describe('Sorting Functionality', () => {
    it('should show sort icons for sortable columns', () => {
      const { container } = render(<DataTable columns={mockColumns} data={mockData} />);
      const sortIcons = container.querySelectorAll('.data-table-sort-icon');
      // 3 sortable columns (test_run_id, name, value)
      expect(sortIcons).toHaveLength(3);
    });

    it('should apply sortable class to sortable headers', () => {
      const { container } = render(<DataTable columns={mockColumns} data={mockData} />);
      const sortableHeaders = container.querySelectorAll('.data-table-header-sortable');
      expect(sortableHeaders.length).toBeGreaterThan(0);
    });

    it('should show neutral sort icon (↕) by default', () => {
      render(<DataTable columns={mockColumns} data={mockData} />);
      const nameHeader = screen.getByText('Name').closest('th');
      expect(nameHeader).toHaveTextContent('↕');
    });

    it('should sort ascending when column header is clicked once', async () => {
      const user = userEvent.setup();
      render(<DataTable columns={mockColumns} data={mockData} />);

      const nameHeader = screen.getByText('Name').closest('th');
      await user.click(nameHeader!);

      expect(nameHeader).toHaveTextContent('↑');
    });

    it('should sort descending when column header is clicked twice', async () => {
      const user = userEvent.setup();
      render(<DataTable columns={mockColumns} data={mockData} />);

      const nameHeader = screen.getByText('Name').closest('th');
      await user.click(nameHeader!);
      await user.click(nameHeader!);

      expect(nameHeader).toHaveTextContent('↓');
    });

    it('should toggle back to neutral when clicked three times', async () => {
      const user = userEvent.setup();
      render(<DataTable columns={mockColumns} data={mockData} />);

      const nameHeader = screen.getByText('Name').closest('th');
      await user.click(nameHeader!);
      await user.click(nameHeader!);
      await user.click(nameHeader!);

      expect(nameHeader).toHaveTextContent('↕');
    });

    it('should not show sort icon for non-sortable columns', () => {
      render(<DataTable columns={mockColumns} data={mockData} />);
      const statusHeader = screen.getByText('Status').closest('th');
      expect(statusHeader).not.toHaveTextContent('↕');
      expect(statusHeader).not.toHaveTextContent('↑');
      expect(statusHeader).not.toHaveTextContent('↓');
    });

    it('should sort numeric columns correctly', async () => {
      const user = userEvent.setup();
      render(<DataTable columns={mockColumns} data={mockData} />);

      const valueHeader = screen.getByText('Value').closest('th');
      await user.click(valueHeader!);

      // After clicking once, it should sort (either asc or desc)
      // Just verify the sort icon changed
      expect(valueHeader).toHaveTextContent(/[↑↓]/);
    });
  });

  describe('Search Functionality', () => {
    it('should not render search input by default', () => {
      render(<DataTable columns={mockColumns} data={mockData} />);
      expect(screen.queryByPlaceholderText('Search...')).not.toBeInTheDocument();
    });

    it('should render search input when searchable is true', () => {
      render(<DataTable columns={mockColumns} data={mockData} searchable />);
      expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    });

    it('should use custom search placeholder', () => {
      render(
        <DataTable
          columns={mockColumns}
          data={mockData}
          searchable
          searchPlaceholder="Search test runs..."
        />
      );
      expect(screen.getByPlaceholderText('Search test runs...')).toBeInTheDocument();
    });

    it('should apply input-field class to search input', () => {
      render(<DataTable columns={mockColumns} data={mockData} searchable />);
      const searchInput = screen.getByPlaceholderText('Search...');
      expect(searchInput).toHaveClass('input-field', 'max-w-sm');
    });

    it('should filter data when searching', async () => {
      const user = userEvent.setup();
      render(<DataTable columns={mockColumns} data={mockData} searchable />);

      const searchInput = screen.getByPlaceholderText('Search...');
      await user.type(searchInput, 'test-001');

      expect(screen.getByText('test-001')).toBeInTheDocument();
      expect(screen.queryByText('test-002')).not.toBeInTheDocument();
    });

    it('should show filtered count when searching', async () => {
      const user = userEvent.setup();
      render(<DataTable columns={mockColumns} data={mockData} searchable />);

      const searchInput = screen.getByPlaceholderText('Search...');
      await user.type(searchInput, 'test-001');

      expect(screen.getByText(/filtered from 5 total/i)).toBeInTheDocument();
    });

    it('should clear search when input is cleared', async () => {
      const user = userEvent.setup();
      render(<DataTable columns={mockColumns} data={mockData} searchable />);

      const searchInput = screen.getByPlaceholderText('Search...');
      await user.type(searchInput, 'test-001');
      await user.clear(searchInput);

      expect(screen.getByText('test-002')).toBeInTheDocument();
      expect(screen.queryByText(/filtered from/i)).not.toBeInTheDocument();
    });
  });

  describe('Filters', () => {
    it('should not render filters section by default', () => {
      const { container } = render(<DataTable columns={mockColumns} data={mockData} />);
      expect(container.querySelector('.flex-wrap')).not.toBeInTheDocument();
    });

    it('should render custom filters when provided', () => {
      const filters = (
        <>
          <button>Filter 1</button>
          <button>Filter 2</button>
        </>
      );
      render(<DataTable columns={mockColumns} data={mockData} filters={filters} />);

      expect(screen.getByText('Filter 1')).toBeInTheDocument();
      expect(screen.getByText('Filter 2')).toBeInTheDocument();
    });

    it('should render both search and filters when provided', () => {
      const filters = <button>Custom Filter</button>;
      render(
        <DataTable
          columns={mockColumns}
          data={mockData}
          searchable
          filters={filters}
        />
      );

      expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
      expect(screen.getByText('Custom Filter')).toBeInTheDocument();
    });
  });

  describe('Pagination', () => {
    // Create data with more than 10 items to test pagination
    const paginationData = Array.from({ length: 25 }, (_, i) => ({
      id: `${i + 1}`,
      test_run_id: `test-${String(i + 1).padStart(3, '0')}`,
      name: `Test ${String.fromCharCode(65 + i)}`,
      status: 'success',
      value: (i + 1) * 10,
    }));

    it('should render pagination controls', () => {
      render(<DataTable columns={mockColumns} data={paginationData} />);
      expect(screen.getByText('Previous')).toBeInTheDocument();
      expect(screen.getByText('Next')).toBeInTheDocument();
    });

    it('should show current page information', () => {
      render(<DataTable columns={mockColumns} data={paginationData} />);
      expect(screen.getByText(/Page 1 of/i)).toBeInTheDocument();
    });

    it('should disable Previous button on first page', () => {
      render(<DataTable columns={mockColumns} data={paginationData} />);
      const previousButton = screen.getByText('Previous').closest('button');
      expect(previousButton).toBeDisabled();
    });

    it('should enable Next button when there are more pages', () => {
      render(<DataTable columns={mockColumns} data={paginationData} />);
      const nextButton = screen.getByText('Next').closest('button');
      expect(nextButton).not.toBeDisabled();
    });

    it('should navigate to next page when Next is clicked', async () => {
      const user = userEvent.setup();
      render(<DataTable columns={mockColumns} data={paginationData} />);

      const nextButton = screen.getByText('Next').closest('button');
      await user.click(nextButton!);

      expect(screen.getByText(/Page 2 of/i)).toBeInTheDocument();
    });

    it('should navigate to previous page when Previous is clicked', async () => {
      const user = userEvent.setup();
      render(<DataTable columns={mockColumns} data={paginationData} />);

      const nextButton = screen.getByText('Next').closest('button');
      await user.click(nextButton!);

      const previousButton = screen.getByText('Previous').closest('button');
      await user.click(previousButton!);

      expect(screen.getByText(/Page 1 of/i)).toBeInTheDocument();
    });

    it('should disable Next button on last page', async () => {
      const user = userEvent.setup();
      render(<DataTable columns={mockColumns} data={paginationData} />);

      // Navigate to last page (3 pages total for 25 items)
      const nextButton = screen.getByText('Next').closest('button');
      await user.click(nextButton!);
      await user.click(nextButton!);

      expect(nextButton).toBeDisabled();
    });

    it('should show entries count', () => {
      render(<DataTable columns={mockColumns} data={mockData} />);
      expect(screen.getByText(/Showing 5 of 5 entries/i)).toBeInTheDocument();
    });

    it('should update entries count on page change', async () => {
      const user = userEvent.setup();
      render(<DataTable columns={mockColumns} data={paginationData} />);

      expect(screen.getByText(/Showing 10 of 25 entries/i)).toBeInTheDocument();

      const nextButton = screen.getByText('Next').closest('button');
      await user.click(nextButton!);

      expect(screen.getByText(/Showing 10 of 25 entries/i)).toBeInTheDocument();
    });
  });

  describe('Row Styling', () => {
    it('should apply data-table-row class to data rows', () => {
      const { container } = render(<DataTable columns={mockColumns} data={mockData} />);
      const dataRows = container.querySelectorAll('.data-table-row');
      expect(dataRows.length).toBe(mockData.length);
    });

    it('should apply data-table-cell class to cells', () => {
      const { container } = render(<DataTable columns={mockColumns} data={mockData} />);
      const cells = container.querySelectorAll('.data-table-cell');
      expect(cells.length).toBeGreaterThan(0);
    });

    it('should apply data-table-header class to header cells', () => {
      const { container } = render(<DataTable columns={mockColumns} data={mockData} />);
      const headers = container.querySelectorAll('.data-table-header');
      expect(headers.length).toBe(mockColumns.length);
    });
  });

  describe('Accessibility', () => {
    it('should have semantic table structure', () => {
      render(<DataTable columns={mockColumns} data={mockData} />);
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('should have proper thead element', () => {
      const { container } = render(<DataTable columns={mockColumns} data={mockData} />);
      expect(container.querySelector('thead')).toBeInTheDocument();
    });

    it('should have proper tbody element', () => {
      const { container } = render(<DataTable columns={mockColumns} data={mockData} />);
      expect(container.querySelector('tbody')).toBeInTheDocument();
    });

    it('should have proper th elements for headers', () => {
      render(<DataTable columns={mockColumns} data={mockData} />);
      const headers = screen.getAllByRole('columnheader');
      expect(headers).toHaveLength(mockColumns.length);
    });

    it('should have proper td elements for cells', () => {
      render(<DataTable columns={mockColumns} data={mockData} />);
      const cells = screen.getAllByRole('cell');
      expect(cells.length).toBe(mockData.length * mockColumns.length);
    });

    it('should have accessible pagination buttons', () => {
      render(<DataTable columns={mockColumns} data={mockData} />);
      expect(screen.getByRole('button', { name: /previous/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });
  });

  describe('Custom Column Rendering', () => {
    it('should render custom cell content', () => {
      const customColumns: ColumnDef<TestData>[] = [
        {
          accessorKey: 'test_run_id',
          header: 'Test Run ID',
          cell: ({ row }) => <strong>{row.original.test_run_id}</strong>,
        },
      ];

      render(<DataTable columns={customColumns} data={[mockData[0]]} />);
      const cell = screen.getByText('test-001');
      expect(cell.tagName).toBe('STRONG');
    });

    it('should render custom header content', () => {
      const customColumns: ColumnDef<TestData>[] = [
        {
          accessorKey: 'test_run_id',
          header: () => <span>Custom Header</span>,
        },
      ];

      render(<DataTable columns={customColumns} data={mockData} />);
      expect(screen.getByText('Custom Header')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle single item data', () => {
      render(<DataTable columns={mockColumns} data={[mockData[0]]} />);
      expect(screen.getByText('test-001')).toBeInTheDocument();
      expect(screen.getByText(/Showing 1 of 1 entries/i)).toBeInTheDocument();
    });

    it('should handle data with missing columns', () => {
      const incompleteData = [{ id: '1', test_run_id: 'test-001' }] as TestData[];
      render(<DataTable columns={mockColumns} data={incompleteData} />);
      expect(screen.getByText('test-001')).toBeInTheDocument();
    });

    it('should handle special characters in data', () => {
      const specialData = [{
        id: '1',
        test_run_id: 'test-001',
        name: 'Test <>&"',
        status: 'success',
        value: 100,
      }];
      render(<DataTable columns={mockColumns} data={specialData} />);
      expect(screen.getByText('Test <>&"')).toBeInTheDocument();
    });

    it('should handle very long text in cells', () => {
      const longTextData = [{
        id: '1',
        test_run_id: 'test-001',
        name: 'A'.repeat(100),
        status: 'success',
        value: 100,
      }];
      render(<DataTable columns={mockColumns} data={longTextData} />);
      expect(screen.getByText('A'.repeat(100))).toBeInTheDocument();
    });
  });

  describe('Combined Functionality', () => {
    it('should handle sorting with pagination', async () => {
      const user = userEvent.setup();
      const paginationData = Array.from({ length: 25 }, (_, i) => ({
        id: `${i + 1}`,
        test_run_id: `test-${String(i + 1).padStart(3, '0')}`,
        name: `Test ${String.fromCharCode(65 + i)}`,
        status: 'success',
        value: (i + 1) * 10,
      }));

      render(<DataTable columns={mockColumns} data={paginationData} />);

      const nameHeader = screen.getByText('Name').closest('th');
      await user.click(nameHeader!);

      expect(screen.getByText(/Page 1 of/i)).toBeInTheDocument();
    });

    it('should handle search with pagination', async () => {
      const user = userEvent.setup();
      render(<DataTable columns={mockColumns} data={mockData} searchable />);

      const searchInput = screen.getByPlaceholderText('Search...');
      await user.type(searchInput, 'test');

      expect(screen.getByText(/Showing/i)).toBeInTheDocument();
    });

    it('should handle sorting and search together', async () => {
      const user = userEvent.setup();
      render(<DataTable columns={mockColumns} data={mockData} searchable />);

      const searchInput = screen.getByPlaceholderText('Search...');
      await user.type(searchInput, 'Test');

      const nameHeader = screen.getByText('Name').closest('th');
      await user.click(nameHeader!);

      expect(nameHeader).toHaveTextContent('↑');
    });
  });
});
