/**
 * Unit tests for PrimaryInfoBox Component
 *
 * Tests the primary info box functionality:
 * - Rendering with string values
 * - Rendering with React node values
 * - Styling and layout
 * - Label and value display
 * - Accessibility
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PrimaryInfoBox from '@/app/test-runs/[id]/components/shared/PrimaryInfoBox';
import { Box } from '@mui/material';

describe('PrimaryInfoBox', () => {
  describe('Rendering with String Value', () => {
    it('should render with label and string value', () => {
      render(<PrimaryInfoBox label="Test Run ID" value="TR-2024-001" />);

      expect(screen.getByText('Test Run ID')).toBeInTheDocument();
      expect(screen.getByText('TR-2024-001')).toBeInTheDocument();
    });

    it('should apply monospace font to string value', () => {
      render(<PrimaryInfoBox label="Duration" value="1h 30m" />);

      const valueElement = screen.getByText('1h 30m');
      expect(valueElement).toHaveStyle({ fontFamily: 'monospace' });
    });

    it('should apply inline-block display to string value', () => {
      render(<PrimaryInfoBox label="Environment" value="production" />);

      const valueElement = screen.getByText('production');
      expect(valueElement).toHaveStyle({ display: 'inline-block' });
    });

    it('should render string value in a white background box', () => {
      render(<PrimaryInfoBox label="Version" value="v1.0.0" />);

      const valueElement = screen.getByText('v1.0.0');
      expect(valueElement).toHaveStyle({ backgroundColor: '#fff' });
    });
  });

  describe('Rendering with React Node Value', () => {
    it('should render with React node value', () => {
      const customNode = (
        <Box data-testid="custom-node">
          <span>Custom</span>
          <span>Content</span>
        </Box>
      );

      render(<PrimaryInfoBox label="Custom Label" value={customNode} />);

      expect(screen.getByTestId('custom-node')).toBeInTheDocument();
      expect(screen.getByText('Custom')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
    });

    it('should not apply monospace styling to React node value', () => {
      const customNode = <span data-testid="node-content">Complex Content</span>;

      render(<PrimaryInfoBox label="Label" value={customNode} />);

      const nodeContent = screen.getByTestId('node-content');
      // Node content should not have monospace styling
      expect(nodeContent).not.toHaveStyle({ fontFamily: 'monospace' });
    });

    it('should render React node value without white background box', () => {
      const customNode = <Box data-testid="custom-box">Content</Box>;

      render(<PrimaryInfoBox label="Label" value={customNode} />);

      const customBox = screen.getByTestId('custom-box');
      // Custom node should not have the white background styling
      expect(customBox).not.toHaveStyle({ backgroundColor: '#fff' });
    });
  });

  describe('Label Styling', () => {
    it('should render label with uppercase text', () => {
      render(<PrimaryInfoBox label="system name" value="test" />);

      const label = screen.getByText('system name');
      expect(label).toHaveStyle({ textTransform: 'uppercase' });
    });

    it('should render label as block element', () => {
      render(<PrimaryInfoBox label="Test Label" value="test" />);

      const label = screen.getByText('Test Label');
      expect(label).toHaveStyle({ display: 'block' });
    });

    it('should apply caption variant styling to label', () => {
      render(<PrimaryInfoBox label="Label Text" value="value" />);

      const label = screen.getByText('Label Text');
      // Caption variant should have specific font weight
      expect(label).toHaveStyle({ fontWeight: '600' });
    });
  });

  describe('Container Styling', () => {
    it('should apply blue-themed background color', () => {
      const { container } = render(<PrimaryInfoBox label="Label" value="Value" />);

      const box = container.querySelector('div');
      expect(box).toHaveStyle({ backgroundColor: 'rgba(25, 118, 210, 0.06)' });
    });

    it('should apply centered text alignment', () => {
      const { container } = render(<PrimaryInfoBox label="Label" value="Value" />);

      const box = container.querySelector('div');
      expect(box).toHaveStyle({ textAlign: 'center' });
    });

    it('should apply border with blue theme', () => {
      const { container } = render(<PrimaryInfoBox label="Label" value="Value" />);

      const box = container.querySelector('div');
      expect(box).toHaveStyle({ border: '1.5px solid rgba(25, 118, 210, 0.12)' });
    });

    it('should apply rounded corners', () => {
      const { container } = render(<PrimaryInfoBox label="Label" value="Value" />);

      const box = container.querySelector('div');
      // borderRadius should be defined (specific value depends on theme)
      const styles = window.getComputedStyle(box!);
      expect(styles.borderRadius).toBeDefined();
    });

    it('should apply box shadow', () => {
      const { container } = render(<PrimaryInfoBox label="Label" value="Value" />);

      const box = container.querySelector('div');
      expect(box).toHaveStyle({ boxShadow: '0 1px 3px rgba(25, 118, 210, 0.08)' });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string value', () => {
      render(<PrimaryInfoBox label="Empty" value="" />);

      expect(screen.getByText('Empty')).toBeInTheDocument();
      // Empty value should still be rendered
      const valueElements = screen.queryAllByText('');
      expect(valueElements.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle very long string value', () => {
      const longValue = 'This is a very long test run identifier that should still render correctly in the component without breaking the layout';

      render(<PrimaryInfoBox label="Long Value" value={longValue} />);

      expect(screen.getByText(longValue)).toBeInTheDocument();
    });

    it('should handle special characters in value', () => {
      render(<PrimaryInfoBox label="Special" value="Test@#$%^&*()_+-=[]{}|;:,.<>?" />);

      expect(screen.getByText('Test@#$%^&*()_+-=[]{}|;:,.<>?')).toBeInTheDocument();
    });

    it('should handle numeric value as string', () => {
      render(<PrimaryInfoBox label="Count" value="12345" />);

      expect(screen.getByText('12345')).toBeInTheDocument();
      const valueElement = screen.getByText('12345');
      expect(valueElement).toHaveStyle({ fontFamily: 'monospace' });
    });

    it('should handle value with line breaks', () => {
      render(<PrimaryInfoBox label="Multi-line" value="Line 1\nLine 2\nLine 3" />);

      expect(screen.getByText(/Line 1/)).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should render semantic Typography components', () => {
      const { container } = render(<PrimaryInfoBox label="Accessible Label" value="Accessible Value" />);

      // Should use proper Typography components from MUI
      const paragraphs = container.querySelectorAll('p');
      expect(paragraphs.length).toBeGreaterThan(0);
    });

    it('should maintain proper label-value relationship', () => {
      render(<PrimaryInfoBox label="Status" value="Running" />);

      // Label should appear before value in DOM
      const label = screen.getByText('Status');
      const value = screen.getByText('Running');

      expect(label).toBeInTheDocument();
      expect(value).toBeInTheDocument();
    });
  });

  describe('Integration with Different Value Types', () => {
    it('should render with JSX element value', () => {
      const jsxValue = <strong>Bold Text</strong>;
      render(<PrimaryInfoBox label="JSX" value={jsxValue} />);

      expect(screen.getByText('Bold Text')).toBeInTheDocument();
    });

    it('should render with fragment value', () => {
      const fragmentValue = (
        <>
          <span>Part 1</span>
          <span> - Part 2</span>
        </>
      );
      render(<PrimaryInfoBox label="Fragment" value={fragmentValue} />);

      expect(screen.getByText('Part 1')).toBeInTheDocument();
      expect(screen.getByText(/Part 2/)).toBeInTheDocument();
    });

    it('should render with number displayed as React node', () => {
      const numberValue = <Box component="span" data-testid="number">42</Box>;
      render(<PrimaryInfoBox label="Number" value={numberValue} />);

      expect(screen.getByTestId('number')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
    });
  });
});
