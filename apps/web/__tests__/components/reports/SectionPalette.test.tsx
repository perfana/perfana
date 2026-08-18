/**
 * Unit tests for SectionPalette.
 *
 * The catalogue of section types, extracted from GenerateReportDialog so it can give way to the
 * canvas. The dialog's own tests cover adding, collapsing and searching from the outside; these
 * cover the branches only reachable inside the palette itself: an empty search result, the
 * search matching a description rather than a label, the menu resetting after an add, and the
 * whole thing going inert at the section cap.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SectionPalette } from '@/components/reports/report-generation/SectionPalette';

const renderPalette = (props: Partial<React.ComponentProps<typeof SectionPalette>> = {}) => {
  const onAdd = jest.fn();
  const onToggleCollapsed = jest.fn();
  render(
    <SectionPalette
      onAdd={onAdd}
      collapsed={false}
      onToggleCollapsed={onToggleCollapsed}
      {...props}
    />,
  );
  return { onAdd, onToggleCollapsed };
};

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Add section' }));

describe('SectionPalette search (collapsed menu)', () => {
  it('says so when nothing matches, rather than showing an empty menu', () => {
    renderPalette({ collapsed: true });
    openMenu();

    fireEvent.change(screen.getByPlaceholderText('Search sections'), {
      target: { value: 'zzzz' },
    });

    expect(screen.getByText('No section matches "zzzz"')).toBeInTheDocument();
    expect(screen.queryByText('SLO Summary')).not.toBeInTheDocument();
  });

  it('matches on the description, not only the label', () => {
    // "Oracle" appears nowhere in a label; someone looking for the AWR section is likelier to
    // remember what it is than what it is called.
    renderPalette({ collapsed: true });
    openMenu();

    fireEvent.change(screen.getByPlaceholderText('Search sections'), {
      target: { value: 'oracle' },
    });

    expect(screen.getByText('AWR Analysis')).toBeInTheDocument();
    expect(screen.queryByText('SLO Summary')).not.toBeInTheDocument();
  });

  it('ignores case and surrounding whitespace', () => {
    renderPalette({ collapsed: true });
    openMenu();

    fireEvent.change(screen.getByPlaceholderText('Search sections'), {
      target: { value: '  APDEX  ' },
    });

    expect(screen.getByText('Apdex Scores')).toBeInTheDocument();
  });

  it('lists every type again once the search is cleared', () => {
    renderPalette({ collapsed: true });
    openMenu();
    const search = screen.getByPlaceholderText('Search sections');

    fireEvent.change(search, { target: { value: 'apdex' } });
    fireEvent.change(search, { target: { value: '' } });

    expect(screen.getByText('SLO Summary')).toBeInTheDocument();
    expect(screen.getByText('AWR Analysis')).toBeInTheDocument();
  });

  it('adds the picked type and leaves the next search empty', () => {
    // A stale filter would greet the next add with a menu already narrowed to something else.
    const { onAdd } = renderPalette({ collapsed: true });
    openMenu();
    fireEvent.change(screen.getByPlaceholderText('Search sections'), {
      target: { value: 'apdex' },
    });

    fireEvent.click(screen.getByText('Apdex Scores'));

    expect(onAdd).toHaveBeenCalledWith('apdex');
    openMenu();
    expect(screen.getByPlaceholderText('Search sections')).toHaveValue('');
    expect(screen.getByText('SLO Summary')).toBeInTheDocument();
  });

  it('keeps typing inside the field instead of jumping to a menu item', () => {
    // A Menu treats keystrokes as type-ahead over its items, which moves focus to whichever one
    // starts with that letter and makes the field impossible to use. The field stops the event
    // before it reaches any ancestor — including the MenuList that would act on it.
    const keyDown = jest.fn();
    render(
      <div onKeyDown={keyDown}>
        <SectionPalette onAdd={jest.fn()} collapsed onToggleCollapsed={jest.fn()} />
      </div>,
    );
    openMenu();

    fireEvent.keyDown(screen.getByPlaceholderText('Search sections'), { key: 'a' });

    expect(keyDown).not.toHaveBeenCalled();
  });
});

describe('SectionPalette at the section cap', () => {
  it('adds nothing when the report is full', () => {
    const { onAdd } = renderPalette({ disabled: true });

    fireEvent.click(screen.getByLabelText('Add SLO Summary section'));

    expect(onAdd).not.toHaveBeenCalled();
  });

  it('still lets the catalogue be read', () => {
    // Disabled is not hidden: the list is what tells you what a report can contain.
    renderPalette({ disabled: true });

    expect(screen.getByText('Available Sections')).toBeInTheDocument();
    expect(screen.getByLabelText('Add AWR Analysis section')).toBeDisabled();
  });

  it('disables the collapsed add control too', () => {
    renderPalette({ collapsed: true, disabled: true });

    expect(screen.getByRole('button', { name: 'Add section' })).toBeDisabled();
  });

  it('leaves the collapse control working at the cap', () => {
    // Being full is no reason to trap the palette open.
    const { onToggleCollapsed } = renderPalette({ collapsed: true, disabled: true });

    fireEvent.click(screen.getByLabelText('Show section list'));

    expect(onToggleCollapsed).toHaveBeenCalled();
  });
});
