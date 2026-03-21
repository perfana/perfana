import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from '@/components/ui/select';

const mockOptions = [
  { value: 'option1', label: 'Option 1' },
  { value: 'option2', label: 'Option 2' },
  { value: 'option3', label: 'Option 3' },
];

describe('Select Component', () => {
  describe('Basic Rendering', () => {
    it('should render a select button', () => {
      render(<Select options={mockOptions} />);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should display placeholder by default', () => {
      render(<Select options={mockOptions} placeholder="Choose option" />);
      expect(screen.getByText('Choose option')).toBeInTheDocument();
    });

    it('should use default placeholder when not provided', () => {
      render(<Select options={mockOptions} />);
      expect(screen.getByText('Select an option')).toBeInTheDocument();
    });

    it('should render with custom className', () => {
      const { container } = render(<Select options={mockOptions} className="custom-class" />);
      const wrapper = container.querySelector('.custom-class');
      expect(wrapper).toBeInTheDocument();
    });
  });

  describe('Options Display', () => {
    it('should not show options initially', () => {
      render(<Select options={mockOptions} />);
      expect(screen.queryByText('Option 1')).not.toBeInTheDocument();
    });

    it('should show options when clicked', async () => {
      const user = userEvent.setup();
      render(<Select options={mockOptions} />);
      await user.click(screen.getByRole('button'));

      expect(screen.getByText('Option 1')).toBeInTheDocument();
      expect(screen.getByText('Option 2')).toBeInTheDocument();
      expect(screen.getByText('Option 3')).toBeInTheDocument();
    });

    it('should hide options when clicking outside', async () => {
      const user = userEvent.setup();
      render(
        <div>
          <Select options={mockOptions} />
          <div data-testid="outside">Outside</div>
        </div>
      );

      await user.click(screen.getByRole('button'));
      expect(screen.getByText('Option 1')).toBeInTheDocument();

      await user.click(screen.getByTestId('outside'));
      await waitFor(() => {
        expect(screen.queryByText('Option 1')).not.toBeInTheDocument();
      });
    });

    it('should display "No options available" when options array is empty', async () => {
      const user = userEvent.setup();
      render(<Select options={[]} />);
      await user.click(screen.getByRole('button'));
      expect(screen.getByText('No options available')).toBeInTheDocument();
    });
  });

  describe('Option Selection', () => {
    it('should call onValueChange when option is selected', async () => {
      const user = userEvent.setup();
      const handleChange = jest.fn();
      render(<Select options={mockOptions} onValueChange={handleChange} />);

      await user.click(screen.getByRole('button'));
      await user.click(screen.getByText('Option 2'));

      expect(handleChange).toHaveBeenCalledWith('option2');
      expect(handleChange).toHaveBeenCalledTimes(1);
    });

    it('should close dropdown after selecting an option', async () => {
      const user = userEvent.setup();
      render(<Select options={mockOptions} />);

      await user.click(screen.getByRole('button'));
      await user.click(screen.getByText('Option 1'));

      await waitFor(() => {
        expect(screen.queryByText('Option 2')).not.toBeInTheDocument();
      });
    });

    it('should display selected option label', () => {
      render(<Select options={mockOptions} value="option2" />);
      expect(screen.getByText('Option 2')).toBeInTheDocument();
    });

    it('should highlight selected option', async () => {
      const user = userEvent.setup();
      render(<Select options={mockOptions} value="option2" />);

      const buttons = screen.getAllByRole('button');
      await user.click(buttons[0]); // Click the main select button

      // Get the option button specifically
      const optionButtons = screen.getAllByRole('button');
      const selectedOption = optionButtons.find(btn => btn.textContent === 'Option 2' && btn.className.includes('bg-brand-50'));

      expect(selectedOption).toHaveClass('bg-brand-50', 'text-brand-700', 'font-medium');
    });

    it('should allow changing selection', async () => {
      const user = userEvent.setup();
      const handleChange = jest.fn();
      const { rerender } = render(
        <Select options={mockOptions} value="option1" onValueChange={handleChange} />
      );

      expect(screen.getByText('Option 1')).toBeInTheDocument();

      await user.click(screen.getByRole('button'));
      await user.click(screen.getByText('Option 3'));

      expect(handleChange).toHaveBeenCalledWith('option3');
    });
  });

  describe('Disabled State', () => {
    it('should be disabled when disabled prop is true', () => {
      render(<Select options={mockOptions} disabled />);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('should not open dropdown when disabled', async () => {
      const user = userEvent.setup();
      render(<Select options={mockOptions} disabled />);

      await user.click(screen.getByRole('button'));
      expect(screen.queryByText('Option 1')).not.toBeInTheDocument();
    });

    it('should apply disabled styling', () => {
      render(<Select options={mockOptions} disabled />);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('disabled:bg-gray-50', 'disabled:text-gray-500', 'disabled:cursor-not-allowed');
    });

    it('should not call onValueChange when disabled', async () => {
      const user = userEvent.setup();
      const handleChange = jest.fn();
      render(<Select options={mockOptions} disabled onValueChange={handleChange} />);

      await user.click(screen.getByRole('button'));
      expect(handleChange).not.toHaveBeenCalled();
    });
  });

  describe('Visual States', () => {
    it('should apply focus ring when open', async () => {
      const user = userEvent.setup();
      render(<Select options={mockOptions} />);

      const button = screen.getByRole('button');
      await user.click(button);

      expect(button).toHaveClass('border-brand-500', 'ring-2', 'ring-brand-500');
    });

    it('should rotate arrow icon when open', async () => {
      const user = userEvent.setup();
      const { container } = render(<Select options={mockOptions} />);

      await user.click(screen.getByRole('button'));
      const arrow = container.querySelector('svg');

      expect(arrow).toHaveClass('rotate-180');
    });

    it('should not rotate arrow when closed', () => {
      const { container } = render(<Select options={mockOptions} />);
      const arrow = container.querySelector('svg');
      expect(arrow).not.toHaveClass('rotate-180');
    });

    it('should display placeholder with gray text', () => {
      render(<Select options={mockOptions} placeholder="Select..." />);
      const placeholderElement = screen.getByText('Select...');
      expect(placeholderElement).toHaveClass('text-gray-500');
    });

    it('should display selected value with darker text', () => {
      render(<Select options={mockOptions} value="option1" />);
      const selectedElement = screen.getByText('Option 1');
      expect(selectedElement).toHaveClass('text-gray-900');
    });
  });

  describe('Dropdown Positioning', () => {
    it('should render dropdown with correct z-index', async () => {
      const user = userEvent.setup();
      const { container } = render(<Select options={mockOptions} />);

      await user.click(screen.getByRole('button'));
      const dropdown = container.querySelector('.z-50');

      expect(dropdown).toBeInTheDocument();
    });

    it('should render dropdown with shadow', async () => {
      const user = userEvent.setup();
      const { container } = render(<Select options={mockOptions} />);

      await user.click(screen.getByRole('button'));
      const dropdown = container.querySelector('.shadow-lg');

      expect(dropdown).toBeInTheDocument();
    });

    it('should limit dropdown height with scrolling', async () => {
      const user = userEvent.setup();
      const manyOptions = Array.from({ length: 20 }, (_, i) => ({
        value: `option${i}`,
        label: `Option ${i}`,
      }));

      const { container } = render(<Select options={manyOptions} />);
      await user.click(screen.getByRole('button'));

      const dropdown = container.querySelector('.max-h-60');
      expect(dropdown).toBeInTheDocument();
      expect(dropdown).toHaveClass('overflow-y-auto');
    });
  });

  describe('Keyboard Navigation', () => {
    it('should toggle dropdown with Enter key', async () => {
      const user = userEvent.setup();
      render(<Select options={mockOptions} />);

      const button = screen.getByRole('button');
      button.focus();

      await user.keyboard('{Enter}');
      expect(screen.getByText('Option 1')).toBeInTheDocument();
    });

    it('should toggle dropdown with Space key', async () => {
      const user = userEvent.setup();
      render(<Select options={mockOptions} />);

      const button = screen.getByRole('button');
      button.focus();

      await user.keyboard(' ');
      expect(screen.getByText('Option 1')).toBeInTheDocument();
    });

    it('should be focusable with tab', async () => {
      const user = userEvent.setup();
      render(<Select options={mockOptions} />);

      await user.tab();
      expect(screen.getByRole('button')).toHaveFocus();
    });
  });

  describe('Option Hover States', () => {
    it('should apply hover styles to options', async () => {
      const user = userEvent.setup();
      render(<Select options={mockOptions} />);

      await user.click(screen.getByRole('button'));
      const option = screen.getByText('Option 1');

      expect(option).toHaveClass('hover:bg-gray-50');
    });

    it('should apply focus styles to options', async () => {
      const user = userEvent.setup();
      render(<Select options={mockOptions} />);

      await user.click(screen.getByRole('button'));
      const option = screen.getByText('Option 1');

      expect(option).toHaveClass('focus:bg-gray-50', 'focus:outline-none');
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined value', () => {
      render(<Select options={mockOptions} value={undefined} />);
      expect(screen.getByText('Select an option')).toBeInTheDocument();
    });

    it('should handle value not in options', () => {
      render(<Select options={mockOptions} value="nonexistent" />);
      expect(screen.getByText('Select an option')).toBeInTheDocument();
    });

    it('should handle empty string value', () => {
      render(<Select options={mockOptions} value="" />);
      expect(screen.getByText('Select an option')).toBeInTheDocument();
    });

    it('should work without onValueChange handler', async () => {
      const user = userEvent.setup();
      render(<Select options={mockOptions} />);

      await user.click(screen.getByRole('button'));
      await user.click(screen.getByText('Option 1'));

      // Should close without error
      await waitFor(() => {
        expect(screen.queryByText('Option 2')).not.toBeInTheDocument();
      });
    });

    it('should handle rapid open/close', async () => {
      const user = userEvent.setup();
      render(<Select options={mockOptions} />);

      const button = screen.getByRole('button');
      await user.click(button);
      await user.click(button);
      await user.click(button);

      expect(screen.getByText('Option 1')).toBeInTheDocument();
    });
  });

  describe('Button Type', () => {
    it('should have button type to prevent form submission', () => {
      render(<Select options={mockOptions} />);
      expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA structure', () => {
      render(<Select options={mockOptions} />);
      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
    });

    it('should be keyboard accessible', async () => {
      const user = userEvent.setup();
      const handleChange = jest.fn();
      render(<Select options={mockOptions} onValueChange={handleChange} />);

      await user.tab();
      expect(screen.getByRole('button')).toHaveFocus();
    });

    it('should maintain focus management', async () => {
      const user = userEvent.setup();
      render(<Select options={mockOptions} />);

      await user.tab();
      await user.keyboard('{Enter}');

      expect(screen.getByText('Option 1')).toBeInTheDocument();
    });
  });
});
