import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TemplateTable from '@/app/systems/[id]/config/components/TemplateTable';
import type { TemplateListItem } from '@/lib/api/reports';

const TEMPLATE_ID = '456e7890-e89b-12d3-a456-426614174000';

function template(overrides: Partial<TemplateListItem> = {}): TemplateListItem {
  return {
    id: TEMPLATE_ID,
    name: 'Nightly regression',
    description: 'Runs every night',
    section_count: 4,
    section_types: ['header', 'slo'],
    is_default: false,
    test_environment: 'acc',
    workload: 'loadTest',
    ...overrides,
  } as TemplateListItem;
}

function renderTable(items: TemplateListItem[] = [template()]) {
  return render(
    <TemplateTable
      templates={items}
      searchText=""
      selectedTemplateIds={new Set()}
      onEdit={jest.fn()}
      onDelete={jest.fn()}
      onDuplicate={jest.fn()}
      onSetDefault={jest.fn()}
      onClearSearch={jest.fn()}
      onSelectAll={jest.fn()}
      onSelectOne={jest.fn()}
    />,
  );
}

describe('TemplateTable copy template ID', () => {
  const writeText = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
  });

  it('copies the uuid POST /reports/generate expects as template_id', async () => {
    // A pipeline cannot read this id off the screen any other way, and template_name only
    // works while the name stays unique within the scope.
    renderTable();

    fireEvent.click(screen.getByLabelText('Copy template ID for Nightly regression'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TEMPLATE_ID));
  });

  it('confirms the copy, since a clipboard write is otherwise silent', async () => {
    // Assert the icon swap, not the button's presence: the aria-label is static
    // (`Copy template ID for <name>`), so any assertion on the accessible name is true whether
    // or not the confirmation exists, and passes with the whole feature deleted.
    renderTable();

    expect(screen.getByTestId('TagIcon')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Copy template ID for Nightly regression'));

    expect(await screen.findByTestId('CheckIcon')).toBeInTheDocument();
  });

  it('does not claim success when the clipboard refuses', async () => {
    // Insecure origin or denied permission. Saying "copied" there would be a lie.
    // 'Template ID copied' is only a Tooltip title, rendered on hover — asserting its absence
    // is equally true on the success path, so the catch branch was effectively untested.
    // The observable difference is the icon.
    writeText.mockRejectedValue(new Error('denied'));
    renderTable();

    fireEvent.click(screen.getByLabelText('Copy template ID for Nightly regression'));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.queryByTestId('CheckIcon')).not.toBeInTheDocument();
    expect(screen.getByTestId('TagIcon')).toBeInTheDocument();
  });

  it('does not open the editor when copying', async () => {
    // The row itself is a click target for editing; the action cell must not trigger it.
    const onEdit = jest.fn();
    render(
      <TemplateTable
        templates={[template()]}
        searchText=""
        selectedTemplateIds={new Set()}
        onEdit={onEdit}
        onDelete={jest.fn()}
        onDuplicate={jest.fn()}
        onSetDefault={jest.fn()}
        onClearSearch={jest.fn()}
        onSelectAll={jest.fn()}
        onSelectOne={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('Copy template ID for Nightly regression'));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(onEdit).not.toHaveBeenCalled();
  });
});
