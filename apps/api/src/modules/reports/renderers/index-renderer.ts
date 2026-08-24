import { Injectable } from '@nestjs/common';
import { ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { sectionHeader } from './report-style';

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
    // An index of nothing is a bordered empty box in the PDF. Render nothing at
    // all, the same way an empty text block does.
    if (entries.length === 0) return '';

    const title = section.title || this.utils.getSectionTitle('index');

    const items = entries
      .map(
        entry =>
          `<li style="margin:0 0 8px;"><a href="#${this.utils.escapeHtml(entry.anchor)}" style="color:inherit; text-decoration:none;">${this.utils.escapeHtml(entry.title)}</a></li>`,
      )
      .join('\n');

    return `
      <section class="index-section">
        ${sectionHeader(title)}
        <ol style="margin:0; padding-left:22px;">
          ${items}
        </ol>
      </section>
    `;
  }
}
