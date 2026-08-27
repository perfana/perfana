import { render, screen } from '@testing-library/react';
import { AddEntityDialog } from './AddEntityDialog';
import { DynatraceEntity } from '../types';

const host = (n: number): DynatraceEntity => ({
  entityId: `HOST-${n}`,
  displayName: `web-${n}`,
  entityType: 'HOST',
  tags: [{ key: 'env', value: 'acc' }],
});

const props = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  loading: false,
  dynatraceInstances: [{ id: 'c1', label: 'prod', host: 'https://x.live.dynatrace.com' }] as never,
  selectedInstance: 'c1',
  onInstanceChange: jest.fn(),
  selectedLevel: 'sut_testenv_workload' as const,
  onLevelChange: jest.fn(),
  selectedEntityType: 'HOST',
  onEntityTypeChange: jest.fn(),
  selectedEntity: null,
  onEntityChange: jest.fn(),
  searchInput: '',
  onInputChange: jest.fn(),
  onSearchInputChange: jest.fn(),
  onFetchEntities: jest.fn(),
  selectedTagKey: '',
  onTagKeyChange: jest.fn(),
  selectedTagValue: '',
  onTagValueChange: jest.fn(),
  selectedHosts: [],
  onSelectedHostsChange: jest.fn(),
};

describe('AddEntityDialog layout stability', () => {
  // The host fetch takes seconds against a real Dynatrace tenant. If the list grew into
  // its content on arrival, every control below it moved — and in a vertically centred
  // dialog, the controls above it moved too, under a cursor already aimed at one.
  it('reserves the host list height before the hosts arrive', () => {
    const { rerender } = render(
      <AddEntityDialog {...props} entities={[]} entitiesLoading={true} />
    );
    expect(screen.getByTestId('host-list')).toHaveStyle({ height: '240px' });

    rerender(
      <AddEntityDialog
        {...props}
        entities={[host(1), host(2), host(3)]}
        entitiesLoading={false}
      />
    );
    expect(screen.getByTestId('host-list')).toHaveStyle({ height: '240px' });
  });

  it('holds the tag filters shut while a fetch is in flight, so their options cannot be swapped mid-click', () => {
    const { rerender } = render(
      <AddEntityDialog {...props} entities={[host(1)]} entitiesLoading={true} />
    );
    expect(screen.getByLabelText('Tag')).toBeDisabled();

    rerender(<AddEntityDialog {...props} entities={[host(1)]} entitiesLoading={false} />);
    expect(screen.getByLabelText('Tag')).toBeEnabled();
  });
});
