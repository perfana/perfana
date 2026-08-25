import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownField } from '@/components/reports/report-generation/MarkdownField';

function setup(props: Partial<React.ComponentProps<typeof MarkdownField>> = {}) {
  const onChange = jest.fn();
  render(<MarkdownField label="Text" value="" onChange={onChange} markdown {...props} />);
  return { onChange };
}

describe('MarkdownField value picker', () => {
  it('inserts the placeholder the API resolves', () => {
    const { onChange } = setup();

    fireEvent.click(screen.getByLabelText('Insert value'));
    fireEvent.click(screen.getByText('Workload'));

    expect(onChange).toHaveBeenCalledWith('{perfana-workload}');
  });

  it('stays available with markdown off — a plain text block resolves values too', () => {
    setup({ markdown: false });
    expect(screen.getByLabelText('Insert value')).toBeInTheDocument();
    expect(screen.queryByLabelText('Bold')).not.toBeInTheDocument();
  });
});
