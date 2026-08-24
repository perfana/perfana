import { Injectable } from '@nestjs/common';
import { ReportSectionConfig, getSectionText } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { sectionHeader, sectionText } from './report-style';

/** One row of the index: a section's display title and the anchor it links to. */
export interface IndexEntry {
  title: string;
  anchor: string;
}

/**
 * Renderer for the index section.
 *
 * The entry list is computed by the compiler, which is the only place that sees
 * every section at once. This renderer just formats it.
 */
@Injectable()
export class IndexRenderer {
  constructor(private readonly utils: ReportUtilsService) {}

  renderIndexSection(section: ReportSectionConfig, entries: IndexEntry[]): string {
    const text = getSectionText(section);

    // An index of nothing is a bordered empty box in the PDF. Render nothing at
    // all, the same way an empty text block does — UNLESS the author wrote
    // accompanying text: a section with only a header and this section's own
    // list would then have nothing to show, but the prose above it is
    // deliberate content and must not vanish just because there was nothing
    // to link to yet (e.g. an index added before any linkable section exists).
    if (entries.length === 0 && !(text ?? '').trim()) return '';

    const title = section.title || this.utils.getSectionTitle('index');

    const items = entries.length > 0
      ? `
        <ol style="margin:0; padding-left:22px;">
          ${entries
            .map(
              entry =>
                `<li style="margin:0 0 8px;"><a href="#${this.utils.escapeHtml(entry.anchor)}" style="color:inherit; text-decoration:none;">${this.utils.escapeHtml(entry.title)}</a></li>`,
            )
            .join('\n')}
        </ol>
      `
      : '';

    return `
      <section class="index-section">
        ${sectionHeader(title)}
        ${sectionText(text)}
        ${items}
      </section>
    `;
  }
}
