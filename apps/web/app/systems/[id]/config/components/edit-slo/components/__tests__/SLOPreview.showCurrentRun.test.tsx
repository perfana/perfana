/**
 * #721: "Re-evaluate this test run" reads the run from the URL, so on the system config page it
 * fetched /test-runs/<systemId> and failed after saving. Edit hides it off a test-run page.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SLOSaveDialog } from '../SLOPreview';

const renderDialog = (showCurrentRun?: boolean) =>
  render(
    <SLOSaveDialog
      open
      onClose={jest.fn()}
      onConfirm={jest.fn()}
      selectedOption="none"
      onOptionChange={jest.fn()}
      loading={false}
      showCurrentRun={showCurrentRun}
    />
  );

it('offers the current run by default (test-run page, Apdex dialogs)', () => {
  renderDialog();
  expect(screen.getByText('Re-evaluate this test run')).toBeInTheDocument();
});

it('hides it when there is no test run', () => {
  renderDialog(false);
  expect(screen.queryByText('Re-evaluate this test run')).not.toBeInTheDocument();
  expect(screen.getByText('Re-evaluate all test runs')).toBeInTheDocument();
});
