import { Injectable } from '@nestjs/common';
import {
  ReportSectionConfig,
  TEXT_BLOCK_MARKDOWN_DEFAULT,
  renderMarkdown,
  renderPlainText,
} from '@perfana/shared';
import { sectionHeader } from './report-style';

/** `config` is only validated as an object, so the value reaches HTML unchecked. */
const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);

/**
 * Renderer for text block section
 *
 * Renders a markdown subset (see @perfana/shared markdown.ts) with configurable
 * alignment, or plain pre-wrapped text when the section disables markdown.
 */
@Injectable()
export class TextBlockRenderer {
  /**
   * Render text block section
   */
  renderTextBlockSection(section: ReportSectionConfig): string {
    const config = section.config || {};
    const content = (config.content as string) || '';
    // Allowlisted, never interpolated raw: this lands inside a style attribute in
    // HTML that is served unauthenticated via report share links and rendered by
    // Puppeteer, so an unchecked value here is a stored XSS sink.
    const requested = config.alignment as string | undefined;
    const alignment = requested && ALIGNMENTS.has(requested) ? requested : 'left';
    const markdown = (config.markdown as boolean | undefined) ?? TEXT_BLOCK_MARKDOWN_DEFAULT;

    // A text block is the one section whose title is optional: it is often a
    // paragraph between two real sections, where a heading would be noise. So
    // there is no default title here — an untitled block renders as bare prose,
    // and a titled one gets the same header every other section gets.
    const title = section.title?.trim();

    // An empty text block otherwise prints as a bare bordered card in the PDF.
    // A title alone is not content: without a body there is nothing to head.
    if (!content.trim()) return '';

    // The plain-text branch is the escape hatch for blocks authored before
    // markdown rendering existed, where a leading `-` or `#` was meant literally.
    const body = markdown ? renderMarkdown(content) : renderPlainText(content);

    return `
      <section class="text-block" style="text-align: ${alignment};">
        ${title ? `<div style="text-align:left;">${sectionHeader(title)}</div>` : ''}
        ${body}
      </section>
    `;
  }
}
