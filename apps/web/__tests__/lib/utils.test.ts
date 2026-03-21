/**
 * Unit tests for General Utility Functions
 *
 * Tests the cn() utility function for combining class names.
 * Uses clsx for conditional classes and tailwind-merge for merging Tailwind classes.
 */

import { cn } from '@/lib/utils';

describe('Utility Functions', () => {
  describe('cn()', () => {
    it('should combine multiple class names', () => {
      // Act
      const result = cn('class1', 'class2', 'class3');

      // Assert
      expect(result).toBe('class1 class2 class3');
    });

    it('should handle single class name', () => {
      // Act
      const result = cn('single-class');

      // Assert
      expect(result).toBe('single-class');
    });

    it('should handle conditional classes', () => {
      // Act
      const result = cn('base', true && 'included', false && 'excluded');

      // Assert
      expect(result).toBe('base included');
    });

    it('should handle object syntax for conditional classes', () => {
      // Act
      const result = cn({
        'class-a': true,
        'class-b': false,
        'class-c': true,
      });

      // Assert
      expect(result).toContain('class-a');
      expect(result).toContain('class-c');
      expect(result).not.toContain('class-b');
    });

    it('should merge Tailwind CSS conflicting classes', () => {
      // Act - tailwind-merge should keep only the last padding class
      const result = cn('px-2', 'px-4');

      // Assert
      expect(result).toBe('px-4');
      expect(result).not.toContain('px-2');
    });

    it('should merge multiple conflicting Tailwind utilities', () => {
      // Act
      const result = cn('text-sm text-lg', 'bg-red-500 bg-blue-500');

      // Assert
      expect(result).toBe('text-lg bg-blue-500');
    });

    it('should handle empty input', () => {
      // Act
      const result = cn();

      // Assert
      expect(result).toBe('');
    });

    it('should handle undefined and null values', () => {
      // Act
      const result = cn('class1', undefined, 'class2', null, 'class3');

      // Assert
      expect(result).toBe('class1 class2 class3');
    });

    it('should handle arrays of class names', () => {
      // Act
      const result = cn(['class1', 'class2'], 'class3');

      // Assert
      expect(result).toContain('class1');
      expect(result).toContain('class2');
      expect(result).toContain('class3');
    });

    it('should combine conditional and regular classes', () => {
      // Arrange
      const isActive = true;
      const isDisabled = false;

      // Act
      const result = cn('base-class', isActive && 'active', isDisabled && 'disabled');

      // Assert
      expect(result).toContain('base-class');
      expect(result).toContain('active');
      expect(result).not.toContain('disabled');
    });

    it('should handle Tailwind responsive classes correctly', () => {
      // Act
      const result = cn('w-full md:w-1/2 lg:w-1/3');

      // Assert
      expect(result).toBe('w-full md:w-1/2 lg:w-1/3');
    });

    it('should merge hover and focus states', () => {
      // Act
      const result = cn('hover:bg-gray-100', 'hover:bg-gray-200');

      // Assert
      expect(result).toBe('hover:bg-gray-200');
    });

    it('should handle complex real-world scenarios', () => {
      // Arrange
      const isSelected = true;
      const hasError = false;
      const size = 'large';

      // Act
      const result = cn(
        'button',
        'rounded',
        isSelected && 'bg-blue-500 text-white',
        hasError && 'border-red-500',
        {
          'px-4 py-2': size === 'medium',
          'px-6 py-3': size === 'large',
        }
      );

      // Assert
      expect(result).toContain('button');
      expect(result).toContain('rounded');
      expect(result).toContain('bg-blue-500');
      expect(result).toContain('text-white');
      expect(result).toContain('px-6');
      expect(result).toContain('py-3');
      expect(result).not.toContain('border-red-500');
      expect(result).not.toContain('px-4');
      expect(result).not.toContain('py-2');
    });

    it('should handle MUI and Tailwind classes together', () => {
      // Act
      const result = cn('MuiButton-root', 'bg-blue-500', 'hover:bg-blue-600');

      // Assert
      expect(result).toContain('MuiButton-root');
      expect(result).toContain('bg-blue-500');
      expect(result).toContain('hover:bg-blue-600');
    });

    it('should handle duplicate classes (clsx behavior)', () => {
      // Act
      const result = cn('button', 'rounded', 'button');

      // Assert - clsx does not deduplicate, it's not a primary concern
      expect(result).toContain('button');
      expect(result).toContain('rounded');
    });
  });
});
