import { render, screen, fireEvent } from '@testing-library/react';
import VariableValuesField from '../VariableValuesField';

describe('VariableValuesField', () => {
  it('commits typed text when the field loses focus, without Enter', () => {
    const onChange = jest.fn();
    render(<VariableValuesField name="host" value={['a']} onChange={onChange} options={[]} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '  web-01 ' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(['a', 'web-01']);
  });

  it('does not add blank or duplicate text on blur', () => {
    const onChange = jest.fn();
    render(<VariableValuesField name="host" value={['a']} onChange={onChange} options={[]} />);
    const input = screen.getByRole('combobox');
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says why Grafana returned no values', () => {
    render(
      <VariableValuesField
        name="host"
        value={[]}
        onChange={jest.fn()}
        options={[]}
        fetchError="the Grafana query failed: 401 Unauthorized"
      />,
    );
    expect(screen.getByText(/Could not load values from Grafana: the Grafana query failed: 401 Unauthorized/)).toBeInTheDocument();
  });

  it('distinguishes an empty answer from a failure', () => {
    render(<VariableValuesField name="host" value={[]} onChange={jest.fn()} options={[]} />);
    expect(screen.getByText(/Grafana returned no values for this variable/)).toBeInTheDocument();
  });
});
