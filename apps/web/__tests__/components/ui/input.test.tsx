import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input, Textarea } from '@/components/ui/input';

describe('Input Component', () => {
  describe('Basic Rendering', () => {
    it('should render an input element', () => {
      render(<Input />);
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('should apply base input class', () => {
      render(<Input data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveClass('input');
    });

    it('should render with custom className', () => {
      render(<Input className="custom-class" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveClass('input', 'custom-class');
    });

    it('should render with placeholder', () => {
      render(<Input placeholder="Enter text..." />);
      expect(screen.getByPlaceholderText('Enter text...')).toBeInTheDocument();
    });
  });

  describe('Input Types', () => {
    const types = ['text', 'email', 'password', 'number', 'tel', 'url'] as const;

    it.each(types)('should render with type %s', (type) => {
      render(<Input type={type} data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveAttribute('type', type);
    });

    it('should default to text type', () => {
      render(<Input data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveAttribute('type', 'text');
    });
  });

  describe('Variants', () => {
    const variants = [
      { variant: 'default' as const, shouldHaveClass: false, className: 'input-error' },
      { variant: 'error' as const, shouldHaveClass: true, className: 'input-error' },
      { variant: 'success' as const, shouldHaveClass: true, className: 'input-success' },
    ];

    it.each(variants)('should apply correct classes for $variant variant', ({ variant, shouldHaveClass, className }) => {
      render(<Input variant={variant} data-testid="input" />);
      const input = screen.getByTestId('input');
      if (shouldHaveClass) {
        expect(input).toHaveClass(className);
      } else {
        expect(input).not.toHaveClass('input-error', 'input-success');
      }
    });

    it('should default to default variant', () => {
      render(<Input data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input).not.toHaveClass('input-error', 'input-success');
    });
  });

  describe('Sizes', () => {
    const sizes = [
      { size: 'sm' as const, expectedClass: 'input-sm' },
      { size: 'base' as const, expectedClass: '' },
      { size: 'lg' as const, expectedClass: 'input-lg' },
    ];

    it.each(sizes)('should apply correct classes for $size size', ({ size, expectedClass }) => {
      render(<Input inputSize={size} data-testid="input" />);
      const input = screen.getByTestId('input');
      if (expectedClass) {
        expect(input).toHaveClass(expectedClass);
      } else {
        expect(input).not.toHaveClass('input-sm', 'input-lg');
      }
    });

    it('should default to base size', () => {
      render(<Input data-testid="input" />);
      const input = screen.getByTestId('input');
      expect(input).not.toHaveClass('input-sm', 'input-lg');
    });
  });

  describe('Icons', () => {
    it('should render left icon when provided', () => {
      render(<Input leftIcon={<span data-testid="left-icon">←</span>} />);
      expect(screen.getByTestId('left-icon')).toBeInTheDocument();
    });

    it('should render right icon when provided', () => {
      render(<Input rightIcon={<span data-testid="right-icon">→</span>} />);
      expect(screen.getByTestId('right-icon')).toBeInTheDocument();
    });

    it('should render both icons when provided', () => {
      render(
        <Input
          leftIcon={<span data-testid="left-icon">←</span>}
          rightIcon={<span data-testid="right-icon">→</span>}
        />
      );
      expect(screen.getByTestId('left-icon')).toBeInTheDocument();
      expect(screen.getByTestId('right-icon')).toBeInTheDocument();
    });

    it('should apply padding classes when left icon is present', () => {
      render(<Input leftIcon={<span>←</span>} data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveClass('pl-10');
    });

    it('should apply padding classes when right icon is present', () => {
      render(<Input rightIcon={<span>→</span>} data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveClass('pr-10');
    });

    it('should apply both padding classes when both icons are present', () => {
      render(
        <Input
          leftIcon={<span>←</span>}
          rightIcon={<span>→</span>}
          data-testid="input"
        />
      );
      const input = screen.getByTestId('input');
      expect(input).toHaveClass('pl-10', 'pr-10');
    });

    it('should wrap input in div when icons are present', () => {
      const { container } = render(<Input leftIcon={<span>←</span>} />);
      const wrapper = container.querySelector('.relative');
      expect(wrapper).toBeInTheDocument();
    });

    it('should not wrap input in div when no icons are present', () => {
      const { container } = render(<Input />);
      const wrapper = container.querySelector('.relative');
      expect(wrapper).not.toBeInTheDocument();
    });
  });

  describe('Disabled State', () => {
    it('should be disabled when disabled prop is true', () => {
      render(<Input disabled data-testid="input" />);
      expect(screen.getByTestId('input')).toBeDisabled();
    });

    it('should not accept user input when disabled', async () => {
      const user = userEvent.setup();
      render(<Input disabled data-testid="input" />);
      const input = screen.getByTestId('input') as HTMLInputElement;
      await user.type(input, 'test');
      expect(input.value).toBe('');
    });
  });

  describe('User Interactions', () => {
    it('should accept user input', async () => {
      const user = userEvent.setup();
      render(<Input data-testid="input" />);
      const input = screen.getByTestId('input') as HTMLInputElement;
      await user.type(input, 'Hello World');
      expect(input.value).toBe('Hello World');
    });

    it('should call onChange handler', async () => {
      const user = userEvent.setup();
      const handleChange = jest.fn();
      render(<Input onChange={handleChange} data-testid="input" />);
      await user.type(screen.getByTestId('input'), 'test');
      expect(handleChange).toHaveBeenCalled();
    });

    it('should call onFocus handler', async () => {
      const user = userEvent.setup();
      const handleFocus = jest.fn();
      render(<Input onFocus={handleFocus} />);
      await user.tab();
      expect(handleFocus).toHaveBeenCalledTimes(1);
    });

    it('should call onBlur handler', async () => {
      const handleBlur = jest.fn();
      render(<Input onBlur={handleBlur} data-testid="input" />);
      const input = screen.getByTestId('input');
      input.focus();
      input.blur();
      expect(handleBlur).toHaveBeenCalledTimes(1);
    });

    it('should support controlled input', async () => {
      const user = userEvent.setup();
      const ControlledInput = () => {
        const [value, setValue] = React.useState('');
        return (
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid="input"
          />
        );
      };
      render(<ControlledInput />);
      const input = screen.getByTestId('input') as HTMLInputElement;
      await user.type(input, 'test');
      expect(input.value).toBe('test');
    });
  });

  describe('Forward Ref', () => {
    it('should forward ref to input element', () => {
      const ref = React.createRef<HTMLInputElement>();
      render(<Input ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });

    it('should allow ref methods to be called', () => {
      const ref = React.createRef<HTMLInputElement>();
      render(<Input ref={ref} />);
      ref.current?.focus();
      expect(ref.current).toHaveFocus();
    });

    it('should forward ref correctly when icons are present', () => {
      const ref = React.createRef<HTMLInputElement>();
      render(<Input ref={ref} leftIcon={<span>←</span>} />);
      expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });
  });

  describe('HTML Attributes', () => {
    it('should accept name attribute', () => {
      render(<Input name="username" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveAttribute('name', 'username');
    });

    it('should accept required attribute', () => {
      render(<Input required data-testid="input" />);
      expect(screen.getByTestId('input')).toBeRequired();
    });

    it('should accept maxLength attribute', () => {
      render(<Input maxLength={10} data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveAttribute('maxLength', '10');
    });

    it('should accept aria-label attribute', () => {
      render(<Input aria-label="Username" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveAttribute('aria-label', 'Username');
    });

    it('should accept data attributes', () => {
      render(<Input data-testid="custom-input" />);
      expect(screen.getByTestId('custom-input')).toBeInTheDocument();
    });
  });

  describe('Value and DefaultValue', () => {
    it('should render with defaultValue', () => {
      render(<Input defaultValue="Default Text" data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveValue('Default Text');
    });

    it('should render with value prop (controlled)', () => {
      render(<Input value="Controlled Value" onChange={() => {}} data-testid="input" />);
      expect(screen.getByTestId('input')).toHaveValue('Controlled Value');
    });
  });
});

describe('Textarea Component', () => {
  describe('Basic Rendering', () => {
    it('should render a textarea element', () => {
      render(<Textarea />);
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('should apply base input class', () => {
      render(<Textarea data-testid="textarea" />);
      const textarea = screen.getByTestId('textarea');
      expect(textarea).toHaveClass('input');
    });

    it('should apply resize and min-height classes', () => {
      render(<Textarea data-testid="textarea" />);
      const textarea = screen.getByTestId('textarea');
      expect(textarea).toHaveClass('min-h-[80px]', 'resize-y');
    });

    it('should render with custom className', () => {
      render(<Textarea className="custom-class" data-testid="textarea" />);
      expect(screen.getByTestId('textarea')).toHaveClass('input', 'custom-class');
    });

    it('should render as textarea element', () => {
      render(<Textarea data-testid="textarea" />);
      expect(screen.getByTestId('textarea').tagName).toBe('TEXTAREA');
    });
  });

  describe('Variants', () => {
    const variants = [
      { variant: 'default' as const, shouldHaveClass: false, className: 'input-error' },
      { variant: 'error' as const, shouldHaveClass: true, className: 'input-error' },
      { variant: 'success' as const, shouldHaveClass: true, className: 'input-success' },
    ];

    it.each(variants)('should apply correct classes for $variant variant', ({ variant, shouldHaveClass, className }) => {
      render(<Textarea variant={variant} data-testid="textarea" />);
      const textarea = screen.getByTestId('textarea');
      if (shouldHaveClass) {
        expect(textarea).toHaveClass(className);
      } else {
        expect(textarea).not.toHaveClass('input-error', 'input-success');
      }
    });
  });

  describe('Sizes', () => {
    const sizes = [
      { size: 'sm' as const, expectedClass: 'input-sm' },
      { size: 'base' as const, expectedClass: '' },
      { size: 'lg' as const, expectedClass: 'input-lg' },
    ];

    it.each(sizes)('should apply correct classes for $size size', ({ size, expectedClass }) => {
      render(<Textarea inputSize={size} data-testid="textarea" />);
      const textarea = screen.getByTestId('textarea');
      if (expectedClass) {
        expect(textarea).toHaveClass(expectedClass);
      } else {
        expect(textarea).not.toHaveClass('input-sm', 'input-lg');
      }
    });
  });

  describe('User Interactions', () => {
    it('should accept user input', async () => {
      const user = userEvent.setup();
      render(<Textarea data-testid="textarea" />);
      const textarea = screen.getByTestId('textarea') as HTMLTextAreaElement;
      await user.type(textarea, 'Multi-line\ntext input');
      expect(textarea.value).toBe('Multi-line\ntext input');
    });

    it('should call onChange handler', async () => {
      const user = userEvent.setup();
      const handleChange = jest.fn();
      render(<Textarea onChange={handleChange} data-testid="textarea" />);
      await user.type(screen.getByTestId('textarea'), 'test');
      expect(handleChange).toHaveBeenCalled();
    });

    it('should call onFocus handler', async () => {
      const user = userEvent.setup();
      const handleFocus = jest.fn();
      render(<Textarea onFocus={handleFocus} />);
      await user.tab();
      expect(handleFocus).toHaveBeenCalledTimes(1);
    });

    it('should call onBlur handler', async () => {
      const handleBlur = jest.fn();
      render(<Textarea onBlur={handleBlur} data-testid="textarea" />);
      const textarea = screen.getByTestId('textarea');
      textarea.focus();
      textarea.blur();
      expect(handleBlur).toHaveBeenCalledTimes(1);
    });
  });

  describe('Disabled State', () => {
    it('should be disabled when disabled prop is true', () => {
      render(<Textarea disabled data-testid="textarea" />);
      expect(screen.getByTestId('textarea')).toBeDisabled();
    });

    it('should not accept user input when disabled', async () => {
      const user = userEvent.setup();
      render(<Textarea disabled data-testid="textarea" />);
      const textarea = screen.getByTestId('textarea') as HTMLTextAreaElement;
      await user.type(textarea, 'test');
      expect(textarea.value).toBe('');
    });
  });

  describe('Forward Ref', () => {
    it('should forward ref to textarea element', () => {
      const ref = React.createRef<HTMLTextAreaElement>();
      render(<Textarea ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    });

    it('should allow ref methods to be called', () => {
      const ref = React.createRef<HTMLTextAreaElement>();
      render(<Textarea ref={ref} />);
      ref.current?.focus();
      expect(ref.current).toHaveFocus();
    });
  });

  describe('HTML Attributes', () => {
    it('should accept rows attribute', () => {
      render(<Textarea rows={5} data-testid="textarea" />);
      expect(screen.getByTestId('textarea')).toHaveAttribute('rows', '5');
    });

    it('should accept placeholder attribute', () => {
      render(<Textarea placeholder="Enter description..." />);
      expect(screen.getByPlaceholderText('Enter description...')).toBeInTheDocument();
    });

    it('should accept required attribute', () => {
      render(<Textarea required data-testid="textarea" />);
      expect(screen.getByTestId('textarea')).toBeRequired();
    });

    it('should accept maxLength attribute', () => {
      render(<Textarea maxLength={100} data-testid="textarea" />);
      expect(screen.getByTestId('textarea')).toHaveAttribute('maxLength', '100');
    });
  });

  describe('Value and DefaultValue', () => {
    it('should render with defaultValue', () => {
      render(<Textarea defaultValue="Default text" data-testid="textarea" />);
      expect(screen.getByTestId('textarea')).toHaveValue('Default text');
    });

    it('should render with value prop (controlled)', () => {
      render(<Textarea value="Controlled value" onChange={() => {}} data-testid="textarea" />);
      expect(screen.getByTestId('textarea')).toHaveValue('Controlled value');
    });
  });
});
