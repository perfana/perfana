import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConfluenceSection from '../ConfluenceSection';
import { fetchConfluenceConfigs } from '@/lib/confluence';
import { updateSystemUnderTest } from '@/lib/systems';

jest.mock('@/lib/confluence', () => ({ fetchConfluenceConfigs: jest.fn() }));
jest.mock('@/lib/systems', () => ({ updateSystemUnderTest: jest.fn() }));

const CFG = '22222222-2222-2222-2222-222222222222';
const FOREIGN = '33333333-3333-3333-3333-333333333333';

const system = {
  id: 'sut-1',
  name: 'MyApp',
  organization_id: 'org-1',
  confluence_parent_pages: { [CFG]: 'Old', [FOREIGN]: 'Kept' },
};

beforeEach(() => {
  (fetchConfluenceConfigs as jest.Mock).mockResolvedValue([
    { id: CFG, label: 'Wiki', spaceKey: 'PERF', parentPageId: '77' },
  ]);
  (updateSystemUnderTest as jest.Mock).mockImplementation(async (_id, dto) => dto);
});

it("lists the organization's connections and saves the path normalized, keeping entries for other connections", async () => {
  const onUpdate = jest.fn();
  render(<ConfluenceSection systemUnderTest={system} onUpdate={onUpdate} />);

  const field = await screen.findByLabelText('Wiki (space PERF)');
  expect(fetchConfluenceConfigs).toHaveBeenCalledWith('org-1');
  const save = screen.getByRole('button', { name: /save/i });
  expect(save).toBeDisabled();

  fireEvent.change(field, { target: { value: ' Performance /MyApp/ ' } });
  fireEvent.click(save);

  await waitFor(() => expect(updateSystemUnderTest).toHaveBeenCalledWith('sut-1', {
    confluence_parent_pages: { [CFG]: 'Performance / MyApp', [FOREIGN]: 'Kept' },
  }));
  expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ name: 'MyApp', confluence_parent_pages: { [CFG]: 'Performance / MyApp', [FOREIGN]: 'Kept' } }));
});

it('clears an entry when the field is emptied', async () => {
  render(<ConfluenceSection systemUnderTest={system} onUpdate={jest.fn()} />);
  fireEvent.change(await screen.findByLabelText('Wiki (space PERF)'), { target: { value: '  ' } });
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() => expect(updateSystemUnderTest).toHaveBeenCalledWith('sut-1', { confluence_parent_pages: { [FOREIGN]: 'Kept' } }));
});
