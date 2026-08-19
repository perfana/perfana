import { Injectable } from '@nestjs/common';
import { ReportSectionType, ReportStyling } from '@perfana/shared';

/**
 * Service for report utility functions
 *
 * Provides utility methods for:
 * - HTML escaping
 * - Duration formatting
 * - Apdex rating calculation
 * - Default styling configuration
 * - Section titles
 */
@Injectable()
export class ReportUtilsService {
  /**
   * Escape HTML special characters
   * @param text - Text to escape
   * @returns Escaped HTML string
   */
  escapeHtml(text: string): string {
    if (!text) return '';
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (char) => map[char] || char);
  }

  /**
   * Format duration in seconds to human-readable format (e.g., "6m 2s", "1h 23m")
   * @param durationSeconds - Duration in seconds
   * @returns Formatted duration string
   */
  formatDuration(durationSeconds: number): string {
    if (!durationSeconds || durationSeconds < 0) {
      return '0s';
    }

    const hours = Math.floor(durationSeconds / 3600);
    const minutes = Math.floor((durationSeconds % 3600) / 60);
    const seconds = durationSeconds % 60;

    const parts: string[] = [];
    if (hours > 0) {
      parts.push(`${hours}h`);
    }
    if (minutes > 0) {
      parts.push(`${minutes}m`);
    }
    if (seconds > 0 || parts.length === 0) {
      parts.push(`${seconds}s`);
    }

    return parts.join(' ');
  }

  /**
   * Get Apdex rating label from score
   * @param score - Apdex score (0-1)
   * @returns Rating label (Excellent, Good, Fair, Poor, Unacceptable)
   */
  getApdexRating(score: number): string {
    if (score >= 0.94) return 'Excellent';
    if (score >= 0.85) return 'Good';
    if (score >= 0.70) return 'Fair';
    if (score >= 0.50) return 'Poor';
    return 'Unacceptable';
  }

  /**
   * Get default section title for a given section type
   * @param type - Section type
   * @returns Default title string
   */
  getSectionTitle(type: ReportSectionType): string {
    const titles: Record<ReportSectionType, string> = {
      header: 'Report Header',
      text_block: 'Text',
      slo: 'SLO Results',
      apdex: 'Apdex Report',
      transaction_response_times: 'Transaction Response Times',
      regressions: 'Anomaly Detection',
      awr: 'AWR Analysis',
      trends: 'Trends',
      comparisons: 'Comparisons',
      graphs: 'Custom Graphs',
      top_10_lists: 'Top 10 Lists',
    };
    return titles[type] || type;
  }

  /**
   * Get default styling options for reports
   * @returns Default ReportStyling configuration
   */
  getDefaultStyling(): ReportStyling {
    return {
      primaryColor: '#1976d2',
      secondaryColor: '#9c27b0',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    };
  }
}
