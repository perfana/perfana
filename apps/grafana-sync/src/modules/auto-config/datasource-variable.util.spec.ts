import {
  datasourceVariableUid,
  parseTemplateVariableRef,
  templatingListFromGrafanaJson,
} from './datasource-variable.util';
import { TemplatingVariable } from './variable-detector.service';

const list = (variables: Partial<TemplatingVariable>[]): TemplatingVariable[] =>
  variables as TemplatingVariable[];

describe('datasource-variable.util', () => {
  describe('parseTemplateVariableRef', () => {
    it.each([
      ['${datasource}', 'datasource'],
      ['$datasource', 'datasource'],
      ['$ds_metrics', 'ds_metrics'],
    ])('reads %s as the variable name %s', (value, expected) => {
      expect(parseTemplateVariableRef(value)).toBe(expected);
    });

    it.each(['prometheus-uid', 'prefix-${datasource}', '${datasource}-suffix', '', '$'])(
      'returns null for %s, which is not a whole-string ref',
      (value) => {
        expect(parseTemplateVariableRef(value)).toBeNull();
      },
    );
  });

  describe('datasourceVariableUid', () => {
    it('reads current.value', () => {
      const l = list([
        { name: 'datasource', type: 'datasource', current: { value: 'PBFA97CFB590B2093' } },
      ]);
      expect(datasourceVariableUid(l, 'datasource')).toBe('PBFA97CFB590B2093');
    });

    it('takes the first selection of a multi-select', () => {
      const l = list([
        { name: 'datasource', type: 'datasource', current: { value: ['prom-a', 'prom-b'] } },
      ]);
      expect(datasourceVariableUid(l, 'datasource')).toBe('prom-a');
    });

    it.each([
      ['Grafana’s all-selected sentinel', '$__all'],
      ['the All label', 'All'],
      ['a regex wildcard', '.*'],
      ['an empty string', ''],
    ])('rejects %s rather than storing it as a uid', (_label, value) => {
      const l = list([{ name: 'datasource', type: 'datasource', current: { value } }]);
      expect(datasourceVariableUid(l, 'datasource')).toBeUndefined();
    });

    it('rejects a non-string current.value', () => {
      const l = list([{ name: 'datasource', type: 'datasource', current: { value: 42 as never } }]);
      expect(datasourceVariableUid(l, 'datasource')).toBeUndefined();
    });

    it('ignores a variable of another type with the same name', () => {
      const l = list([{ name: 'datasource', type: 'constant', current: { value: 'InfluxDB' } }]);
      expect(datasourceVariableUid(l, 'datasource')).toBeUndefined();
    });

    it('returns undefined when the list does not hold the variable', () => {
      const l = list([{ name: 'other', type: 'datasource', current: { value: 'x' } }]);
      expect(datasourceVariableUid(l, 'datasource')).toBeUndefined();
      expect(datasourceVariableUid(undefined, 'datasource')).toBeUndefined();
    });
  });

  describe('templatingListFromGrafanaJson', () => {
    it('reads the list out of a stored dashboard', () => {
      const json = { dashboard: { templating: { list: [{ name: 'a', type: 'datasource' }] } } };
      expect(templatingListFromGrafanaJson(json)).toHaveLength(1);
    });

    it.each([[null], [undefined], [{}], [{ dashboard: {} }], [{ dashboard: { templating: {} } }]])(
      'returns undefined for %p rather than throwing',
      (json) => {
        expect(templatingListFromGrafanaJson(json)).toBeUndefined();
      },
    );
  });
});
