import { Injectable } from '@nestjs/common';
import { ReportSectionConfig, renderMarkdown } from '@perfana/shared';
import { commentBlock, escapeHtml } from './report-style';

/**
 * Renderer for text block section
 *
 * Renders a markdown subset (see @perfana/shared markdown.ts) with configurable alignment
 */
@Injectable()
export class TextBlockRenderer {

  /**
   * Render text block section
   */
  renderTextBlockSection(section: ReportSectionConfig): string {
    const config = section.config || {};
    const content = (config.content as string) || '';
    const alignment = (config.alignment as string) || 'left';
    // The editor's "Enable Markdown" switch. Defaults on to match the form, and
    // turning it off is the escape hatch for text authored before markdown
    // rendering existed, where a leading `-` or `#` was meant literally.
    const markdown = (config.markdown as boolean | undefined) ?? true;

    // An empty text block otherwise prints as a bare bordered card in the PDF.
    const comment = commentBlock(section.comment);
    if (!content.trim() && !comment) return '';

    const body = markdown
      ? renderMarkdown(content)
      : `<p style="margin:0 0 10px; white-space:pre-wrap;">${escapeHtml(content)}</p>`;

    return `
      <section class="text-block" style="text-align: ${alignment};">
        ${comment}
        ${body}
      </section>
    `;
  }
}
