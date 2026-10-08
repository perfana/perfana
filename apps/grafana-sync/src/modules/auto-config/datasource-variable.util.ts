/**
 * Reading a Grafana `type: 'datasource'` template variable.
 *
 * Two callers in this module need it and they need it for different reasons:
 * `VariableDiscoveryService` writes the uid onto the application dashboard, and
 * `VariableDetectorService` has to resolve a `${datasource}` ref before it can look up the
 * datasource a *query* variable runs against. Keeping one reader here means the uid rule
 * (first selection of a multi-select, no "all" sentinel, must be a non-empty string) exists
 * once inside the module rather than at each call site.
 */

import { TemplatingVariable } from './variable-detector.service';

/** A Grafana template ref used on its own: `$name` or `${name}`. */
const TEMPLATE_REF_RE = /^\$\{([^}]+)\}$|^\$([A-Za-z_][A-Za-z0-9_]*)$/;

/** Grafana's "all values selected" sentinels. Never a datasource uid. */
const ALL_SENTINELS = new Set(['All', '$__all', '.*']);

type TemplatingList = TemplatingVariable[] | undefined;

/** The templating list out of a stored dashboard's `grafana_json`, if it has one. */
export function templatingListFromGrafanaJson(grafanaJson: unknown): TemplatingList {
  return (
    grafanaJson as { dashboard?: { templating?: { list?: TemplatingVariable[] } } } | undefined
  )?.dashboard?.templating?.list;
}

/** The variable name when `value` is a whole-string template ref, else null. */
export function parseTemplateVariableRef(value: string): string | null {
  const match = TEMPLATE_REF_RE.exec(value);
  return match?.[1] ?? match?.[2] ?? null;
}

/**
 * The concrete uid a `type: 'datasource'` variable currently points at. Grafana 9+ stores it in
 * `current.value`; `query` is only the plugin-type filter and is never substitutable. A
 * multi-select variable's `current.value` is an array, and its first selection is the one that
 * applies — Perfana collects one series per panel.
 */
export function datasourceVariableUid(
  templatingList: TemplatingList,
  variableName: string,
): string | undefined {
  const variable = (templatingList ?? []).find((v) => v?.name === variableName);
  if (!variable || variable.type !== 'datasource') {
    return undefined;
  }

  const current = variable.current;
  const value = Array.isArray(current?.value) ? current?.value[0] : current?.value;
  if (typeof value !== 'string' || value.length === 0 || ALL_SENTINELS.has(value)) {
    return undefined;
  }
  return value;
}
