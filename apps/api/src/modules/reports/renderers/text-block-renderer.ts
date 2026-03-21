import { Injectable } from '@nestjs/common';
import { ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';

/**
 * Renderer for text block section
 *
 * Generates simple text content with configurable alignment
 */
@Injectable()
export class TextBlockRenderer {
  constructor(private readonly utils: ReportUtilsService) {}

  /**
   * Render text block section
   */
  renderTextBlockSection(section: ReportSectionConfig): string {
    const config = section.config || {};
    const content = (config.content as string) || '';
    const alignment = (config.alignment as string) || 'left';

    return `
      <section class="text-block" style="text-align: ${alignment};">
        ${this.utils.escapeHtml(content)}
      </section>
    `;
  }
}
