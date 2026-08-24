import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownField } from '@/components/reports/report-generation/MarkdownField';
import { assignSectionAnchors } from '@perfana/shared/utils';
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
  it('excludes text blocks and matches what the API will emit', () => {
    const sections = [
      { type: 'index', order: 0, title: '' },
      { type: 'slo', order: 1, title: 'SLO Results' },
      { type: 'text_block', order: 2, title: '' },
      { type: 'graphs', order: 3, title: 'Graphs' },
    ];

    const targetsList = sections
      .filter((s) => s.type !== 'text_block')
      .sort((a, b) => a.order - b.order);

    const anchors = assignSectionAnchors(
      targetsList,
      (s) => s.title || s.type,
      (s) => s.type,
    );

    expect([...anchors.values()]).toEqual(['index', 'slo-results', 'graphs']);
  });

  it('buildLinkTargets (the builder\'s production helper) applies the same rule, using SECTION_RENDER_TITLES for an untitled section', () => {
    // `header` is the one type whose builder label ("Header") and rendered
    // title ("Report Header") diverge — see Part A. An untitled header
    // section must anchor on "report-header", matching the API, not "header".
    const sections: ReportSectionConfig[] = [
      { type: 'header', order: 0 },
      { type: 'slo', order: 1, title: 'SLO Results' },
      { type: 'text_block', order: 2, title: 'ignored' },
      { type: 'graphs', order: 3, title: 'Graphs' },
    ];

    expect(buildLinkTargets(sections)).toEqual([
      { title: 'Report Header', anchor: 'report-header' },
      { title: 'SLO Results', anchor: 'slo-results' },
      { title: 'Graphs', anchor: 'graphs' },
    ]);
  });

  it('sorts by order regardless of input order', () => {
    const sections: ReportSectionConfig[] = [
      { type: 'graphs', order: 2, title: 'Graphs' },
      { type: 'index', order: 0, title: 'Index' },
      { type: 'slo', order: 1, title: 'SLO Results' },
    ];

    expect(buildLinkTargets(sections).map((t) => t.title)).toEqual([
      'Index',
      'SLO Results',
      'Graphs',
    ]);
  });

  it('defaults to no targets when the builder has not supplied any sections', () => {
    expect(buildLinkTargets(undefined)).toEqual([]);
    expect(buildLinkTargets([])).toEqual([]);
  });
});
