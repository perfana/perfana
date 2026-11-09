/**
 * The ADAPT template dialog sends exactly the fields that are ticked, shows the server's refusal in
 * place, and shows a provisioned template without letting it be saved.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CompareTemplateDialog } from '../components/CompareTemplateDialog';
import type { CompareTemplateDefinition } from '@/lib/compare-templates';

const initial: CompareTemplateDefinition = {
  dashboardUid: 'jvm-overview',
  panelId: 7,
  metricClassification: 'USE_saturation',
  higherIsBetter: false,
  absThreshold: 5,
};

const renderDialog = (props: Partial<React.ComponentProps<typeof CompareTemplateDialog>> = {}) => {
  const onSave = props.onSave ?? jest.fn().mockResolvedValue(undefined);
  render(
    <CompareTemplateDialog
      open
      scopeKind="organization"
      scopeName="All runs in Acme"
      initial={initial}
      onClose={jest.fn()}
      onSave={onSave}
      {...props}
    />,
  );
  return { onSave };
};

describe('CompareTemplateDialog', () => {
  it('saves what it was opened with, unchanged', async () => {
    const { onSave } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(initial));
  });

  it('stops forcing a field once it is unticked, and starts forcing one once it is ticked', async () => {
    const { onSave } = renderDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Absolute threshold' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ignore metric' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        dashboardUid: 'jvm-overview',
        panelId: 7,
        metricClassification: 'USE_saturation',
        higherIsBetter: false,
        ignore: false,
      }),
    );
  });

  it('clears the absolute threshold with an explicit null', async () => {
    const { onSave } = renderDialog();
    fireEvent.click(screen.getByRole('checkbox', { name: 'None (clear it)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ absThreshold: null })));
  });

  it('shows the server refusal and stays open', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('There is already a template for dashboard "jvm-overview", panel 7 in organization "Acme".'));
    renderDialog({ onSave });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByText(/There is already a template for dashboard "jvm-overview", panel 7/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save template' })).toBeInTheDocument();
  });

  it('does not send an invalid form', async () => {
    const { onSave } = renderDialog({ initial: undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Create template' }));
    expect(await screen.findByText('Choose a classification')).toBeInTheDocument();
    expect(screen.getByText('A panel id is a whole number')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('states the reach of a template', () => {
    renderDialog();
    expect(screen.getByText(/Applies on the next completed run of matching workloads, to panels nobody has hand-edited/)).toBeInTheDocument();
  });

  it('shows a provisioned template read-only, with no way to save it', () => {
    renderDialog({ readOnly: true });
    expect(screen.getByText('Provisioned ADAPT template')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save template' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Dashboard UID' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Absolute threshold' })).toBeDisabled();
  });
});
