import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownField } from '@/components/reports/report-generation/MarkdownField';
import { assignSectionAnchors } from '@perfana/shared/utils';
import { isLinkableSectionType } from '@perfana/shared/types';
import { buildLinkTargets } from '@/components/reports/report-generation/SectionConfigs';
import type { ReportSectionConfig } from '@/lib/api/reports';

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

describe('builder link targets', () => {
  it('excludes text blocks, headers and indexes, and matches what the API will emit', () => {
    const sections = [
      { type: 'header', order: 0, title: '' },
      { type: 'index', order: 1, title: '' },
      { type: 'slo', order: 2, title: 'SLO Results' },
      { type: 'text_block', order: 3, title: '' },
      { type: 'graphs', order: 4, title: 'Graphs' },
    ];

    const targetsList = sections
      .filter((s) => isLinkableSectionType(s.type))
      .sort((a, b) => a.order - b.order);

    const anchors = assignSectionAnchors(
      targetsList,
      (s) => s.title || s.type,
      (s) => s.type,
    );

    expect([...anchors.values()]).toEqual(['slo-results', 'graphs']);
  });

  it('buildLinkTargets (the builder\'s production helper) excludes header and index, not just text_block', () => {
    // header and index used to be link targets; they no longer are — a
    // header is the top of the report (nothing to link to), and an index
    // linking to an index is circular noise. Only slo/graphs remain.
    const sections: ReportSectionConfig[] = [
      { type: 'header', order: 0 },
      { type: 'index', order: 1 },
      { type: 'slo', order: 2, title: 'SLO Results' },
      { type: 'text_block', order: 3, title: 'ignored' },
      { type: 'graphs', order: 4, title: 'Graphs' },
    ];

    expect(buildLinkTargets(sections)).toEqual([
      { title: 'SLO Results', anchor: 'slo-results' },
      { title: 'Graphs', anchor: 'graphs' },
    ]);
  });

  it('sorts by order regardless of input order', () => {
    const sections: ReportSectionConfig[] = [
      { type: 'graphs', order: 2, title: 'Graphs' },
      { type: 'slo', order: 0, title: 'SLO Results' },
      { type: 'apdex', order: 1, title: 'Apdex' },
    ];

    expect(buildLinkTargets(sections).map((t) => t.title)).toEqual([
      'SLO Results',
      'Apdex',
      'Graphs',
    ]);
  });

  it('defaults to no targets when the builder has not supplied any sections', () => {
    expect(buildLinkTargets(undefined)).toEqual([]);
    expect(buildLinkTargets([])).toEqual([]);
  });
});
