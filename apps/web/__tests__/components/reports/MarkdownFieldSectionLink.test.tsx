import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownField } from '@/components/reports/report-generation/MarkdownField';

const targets = [
  { title: 'SLO Results', anchor: 'slo-results' },
  { title: 'Trends', anchor: 'trends' },
];

function setup(props: Partial<React.ComponentProps<typeof MarkdownField>> = {}) {
  const onChange = jest.fn();
  render(
    <MarkdownField
      label="Text"
      value=""
      onChange={onChange}
      markdown
      linkTargets={targets}
      {...props}
    />,
  );
  return { onChange };
}

describe('MarkdownField section links', () => {
  it('offers the button when there are targets', () => {
    setup();
    expect(screen.getByLabelText('Link to section')).toBeInTheDocument();
  });

  it('hides the button when there are none', () => {
    setup({ linkTargets: [] });
    expect(screen.queryByLabelText('Link to section')).not.toBeInTheDocument();
  });

  it('inserts markdown pointing at the chosen section', () => {
    const { onChange } = setup();

    fireEvent.click(screen.getByLabelText('Link to section'));
    fireEvent.click(screen.getByText('SLO Results'));

    expect(onChange).toHaveBeenCalledWith('[SLO Results](#slo-results)');
  });

  it('inserts at the caret, keeping the text on both sides', () => {
    const onChange = jest.fn();
    render(
      <MarkdownField
        label="Text"
        value="Before after"
        onChange={onChange}
        markdown
        linkTargets={targets}
      />,
    );
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    textarea.setSelectionRange(7, 7);

    fireEvent.click(screen.getByLabelText('Link to section'));
    fireEvent.click(screen.getByText('Trends'));

    expect(onChange).toHaveBeenCalledWith('Before [Trends](#trends)after');
  });

  it('replaces an active selection instead of duplicating it', () => {
    const onChange = jest.fn();
    render(
      <MarkdownField
        label="Text"
        value="Before after"
        onChange={onChange}
        markdown
        linkTargets={targets}
      />,
    );
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 6);

    fireEvent.click(screen.getByLabelText('Link to section'));
    fireEvent.click(screen.getByText('Trends'));

    expect(onChange).toHaveBeenCalledWith('[Trends](#trends) after');
  });

  it('marks sections that share a title, so the author can tell them apart', () => {
    setup({
      linkTargets: [
        { title: 'Graphs', anchor: 'graphs' },
        { title: 'Graphs', anchor: 'graphs-2' },
      ],
    });

    fireEvent.click(screen.getByLabelText('Link to section'));
    expect(screen.getByText(/duplicate title/i)).toBeInTheDocument();
  });

  it('disambiguates each duplicate-titled row by its own anchor', () => {
    setup({
      linkTargets: [
        { title: 'Graphs', anchor: 'graphs' },
        { title: 'Graphs', anchor: 'graphs-2' },
      ],
    });

    fireEvent.click(screen.getByLabelText('Link to section'));

    expect(screen.getByText(/duplicate title/i)).toBeInTheDocument();
    expect(screen.getByText('(#graphs)')).toBeInTheDocument();
    expect(screen.getByText('(#graphs-2)')).toBeInTheDocument();
  });
});
