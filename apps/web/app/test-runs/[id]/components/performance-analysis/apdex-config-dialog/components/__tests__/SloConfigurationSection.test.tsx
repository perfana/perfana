import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SloConfigurationSection } from '../SloConfigurationSection';

const testRunDetails = {
  system_under_test_id: 'sut-1',
  system_name: 'my-sut',
  test_environment: 'staging',
  workload: 'peak',
};

function renderSection(overrides: Partial<React.ComponentProps<typeof SloConfigurationSection>> = {}) {
  const setApdexMinSamples = jest.fn();
  render(
    <SloConfigurationSection
      enableSlo
      setEnableSlo={jest.fn()}
      minApdexScore={0.85}
      setMinApdexScore={jest.fn()}
      includeFailedRequests={false}
      setIncludeFailedRequests={jest.fn()}
      excludeRampUpTime
      setExcludeRampUpTime={jest.fn()}
      apdexMinSamples={50}
      setApdexMinSamples={setApdexMinSamples}
      loading={false}
      loadingTestRun={false}
      loadingSlo={false}
      testRunDetails={testRunDetails}
      existingSlo={null}
      {...overrides}
    />,
  );
  return { setApdexMinSamples };
}

const minSamplesInput = () => screen.getByLabelText(/Minimum samples per transaction/i) as HTMLInputElement;

describe('SloConfigurationSection — minimum samples field', () => {
  it('shows the field with the current value and its explanation once the SLO is enabled', () => {
    renderSection({ apdexMinSamples: 25 });

    expect(minSamplesInput()).toHaveValue(25);
    expect(
      screen.getByText('Transactions with fewer samples are shown but cannot fail the SLO'),
    ).toBeInTheDocument();
  });

  it('forwards a valid integer to the parent', () => {
    const { setApdexMinSamples } = renderSection();

    fireEvent.change(minSamplesInput(), { target: { value: '30' } });

    expect(setApdexMinSamples).toHaveBeenLastCalledWith(30);
  });

  it.each(['0', '-5', '2.7', 'abc', '', '2147483648'])(
    'keeps invalid draft %p in the field, flags it, and does not forward it',
    (typed) => {
      const { setApdexMinSamples } = renderSection();

      fireEvent.change(minSamplesInput(), { target: { value: typed } });

      expect(setApdexMinSamples).not.toHaveBeenCalled();
      expect(minSamplesInput()).toHaveAttribute('aria-invalid', 'true');
    },
  );

  it('lets the user clear the field and type a new value without the old one appended', () => {
    const { setApdexMinSamples } = renderSection();

    fireEvent.change(minSamplesInput(), { target: { value: '' } });
    fireEvent.change(minSamplesInput(), { target: { value: '7' } });
    fireEvent.change(minSamplesInput(), { target: { value: '75' } });

    expect(setApdexMinSamples).toHaveBeenLastCalledWith(75);
  });

  it('snaps an invalid draft back to the last valid value on blur', () => {
    renderSection({ apdexMinSamples: 25 });

    fireEvent.change(minSamplesInput(), { target: { value: '' } });
    fireEvent.blur(minSamplesInput());

    expect(minSamplesInput()).toHaveValue(25);
  });

  it('disables the field while a save is in flight', () => {
    renderSection({ loading: true });

    expect(minSamplesInput()).toBeDisabled();
  });
});
