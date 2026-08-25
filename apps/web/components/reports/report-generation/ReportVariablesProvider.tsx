'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { isSecretishConfigKey } from '@perfana/shared/utils';
import { authenticatedFetch } from '@/lib/api';

/**
 * The test run's own configuration keys, offered in every text editor's value
 * picker alongside the built-in `{perfana-…}` catalogue. Deep links resolve the
 * same keys (see the deep-link editor's VariablesAccordion) and the report
 * renderer resolves them the same way, so the two features stay in step.
 *
 * A context rather than a prop: the picker lives in MarkdownField, which is
 * twelve section forms deep, and threading one string through all of them to
 * reach a list that is identical for every section is a lot of diff for nothing.
 *
 * Absent provider → empty list → the picker just shows the built-ins. That is
 * the correct behaviour for the template builder, which has no test run.
 */
const ReportConfigKeysContext = createContext<string[]>([]);

export function useReportConfigKeys(): string[] {
  return useContext(ReportConfigKeysContext);
}

export function ReportVariablesProvider({
  testRunId,
  /**
   * Whether the surface using these keys is actually on screen. Required, and
   * not defaulted to true: the report dialog is MOUNTED as soon as a test run
   * resolves and only `open` decides whether it renders, so a provider that
   * fetched on mount put a request for an unbounded CI-posted key/value set on
   * every single test-run page view, for an autocomplete most viewers never see.
   */
  enabled,
  children,
}: {
  testRunId?: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const [configKeys, setConfigKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled || !testRunId) {
      setConfigKeys([]);
      return;
    }

    const controller = new AbortController();
    (async () => {
      try {
        const response = await authenticatedFetch(
          `/test-runs/${encodeURIComponent(testRunId)}/configs`,
          { method: 'GET', signal: controller.signal },
        );
        if (!response.ok) throw new Error(String(response.status));
        const configs = (await response.json()) as { key?: string }[];
        if (controller.signal.aborted) return;
        setConfigKeys(
          [
            ...new Set(
              configs
                .map((c) => c.key)
                .filter((k): k is string => Boolean(k))
                // Mirrors the resolver: a secret-shaped key is never substituted
                // into a report, so offering it in the picker would only hand the
                // author a placeholder that silently stays literal.
                .filter((k) => !isSecretishConfigKey(k)),
            ),
          ].sort(),
        );
      } catch {
        // Silent: the picker is an aid, not the feature. Losing the config keys
        // costs the author autocomplete, not the ability to type the placeholder.
        if (!controller.signal.aborted) setConfigKeys([]);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [testRunId, enabled]);

  return (
    <ReportConfigKeysContext.Provider value={configKeys}>{children}</ReportConfigKeysContext.Provider>
  );
}
