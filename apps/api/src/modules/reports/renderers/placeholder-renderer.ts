import { Injectable } from '@nestjs/common';
import { ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';
import { sectionHeader } from './report-style';

/**
 * Renderer for placeholder and error sections
 *
 * Provides fallback rendering for unknown section types
 * and error handling when section rendering fails
 */
@Injectable()
export class PlaceholderRenderer {
  constructor(private readonly utils: ReportUtilsService) {}

  /**
   * Render placeholder section for unknown types
   */
  renderPlaceholderSection(title: string, type: string): string {
    return `
      <section class="placeholder-section">
        ${sectionHeader(title)}
        <p class="placeholder-message">Section type '${this.utils.escapeHtml(type)}' is not yet implemented.</p>
      </section>
    `;
  }

  /**
   * Render error section when rendering fails
   */
  renderErrorSection(section: ReportSectionConfig, errorMessage: string): string {
    return `
      <section class="error-section">
        ${sectionHeader(section.title || section.type)}
        <div class="error-message">
          <p>Failed to render section: ${this.utils.escapeHtml(errorMessage)}</p>
        </div>
      </section>
    `;
  }
}
