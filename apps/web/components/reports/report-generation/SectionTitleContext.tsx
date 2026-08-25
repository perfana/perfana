'use client';

import { createContext, useContext } from 'react';

/**
 * The section's own title, as typed in the card above the config form.
 *
 * The preview endpoint renders a real section, and a real section carries its
 * title — so without this the server-rendered preview showed the default
 * heading for every section, and nothing at all for a text block (whose title
 * is optional and has no default).
 *
 * A context rather than a prop because the title is edited in
 * LayoutSectionCard and needed in SectionConfigShell, with a section config
 * form in between — and there are thirteen of those forms, each of which would
 * otherwise have to forward a prop it makes no use of itself.
 *
 * Absent provider → undefined → the preview falls back to the default heading,
 * which is what it did before.
 */
const SectionTitleContext = createContext<string | undefined>(undefined);

export const SectionTitleProvider = SectionTitleContext.Provider;

export function useSectionTitle(): string | undefined {
  return useContext(SectionTitleContext);
}
