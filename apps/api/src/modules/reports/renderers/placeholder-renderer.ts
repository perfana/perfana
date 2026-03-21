import { Injectable } from '@nestjs/common';
import { ReportSectionConfig } from '@perfana/shared';
import { ReportUtilsService } from '../services/report-utils.service';

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
        <h2>${this.utils.escapeHtml(title)}</h2>
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
        <h2>${this.utils.escapeHtml(section.title || section.type)}</h2>
        <div class="error-message">
          <p>Failed to render section: ${this.utils.escapeHtml(errorMessage)}</p>
        </div>
      </section>
    `;
  }
}
