import { TestRun } from '@perfana/shared';

/**
 * Microsoft Teams MessageCard format
 * @see https://docs.microsoft.com/en-us/outlook/actionable-messages/message-card-reference
 */
interface TeamsSection {
  activityTitle?: string;
  activitySubtitle?: string;
  facts?: Array<{
    name: string;
    value: string;
  }>;
  text?: string;
  markdown?: boolean;
}

interface TeamsPotentialAction {
  '@type': string;
  name: string;
  targets: Array<{
    os: string;
    uri: string;
  }>;
}

interface TeamsMessage {
  '@type': string;
  '@context': string;
  themeColor: string;
  summary: string;
  sections: TeamsSection[];
  potentialAction?: TeamsPotentialAction[];
}

/**
 * Builds Microsoft Teams notification messages for test run results
 */
export class TeamsMessageBuilder {
  constructor(private readonly perfanaUrl: string) {}

  /**
   * Build a Teams message for test run completion
   */
  buildTestRunResultMessage(testRun: TestRun, systemName: string): TeamsMessage {
    const passed = testRun.consolidatedResult?.overall === true;
    const statusText = passed ? 'Test run passed!' : 'Test run failed!';
    // Green for passed, red for failed
    const themeColor = passed ? '0bd700' : 'd7000b';

    const deeplink = this.generateDeeplink(testRun, systemName);
    const sanitizedTestRunId = this.sanitizeTestRunId(testRun.testRunId);

    // Format duration
    const durationText = testRun.duration
      ? this.formatDuration(testRun.duration)
      : 'N/A';

    // Build facts array
    const facts = this.buildFacts(testRun, durationText);

    return {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor,
      summary: statusText,
      sections: [
        {
          activityTitle: statusText,
          activitySubtitle: `${systemName} | ${testRun.testEnvironment} | ${testRun.workload} | ${sanitizedTestRunId}`,
          facts,
          markdown: true,
        },
      ],
      potentialAction: [
        {
          '@type': 'OpenUri',
          name: 'View test run in Perfana',
          targets: [
            {
              os: 'default',
              uri: deeplink,
            },
          ],
        },
      ],
    };
  }

  /**
   * Build a test notification message
   */
  buildTestMessage(systemName: string): TeamsMessage {
    return {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: '0076D7', // Blue for test message
      summary: 'Perfana Test Notification',
      sections: [
        {
          activityTitle: 'Perfana Test Notification',
          activitySubtitle: `System: ${systemName}`,
          text: 'Your Microsoft Teams notification channel is configured correctly!',
          markdown: true,
        },
      ],
    };
  }

  private buildFacts(testRun: TestRun, durationText: string): Array<{ name: string; value: string }> {
    const facts: Array<{ name: string; value: string }> = [];

    if (testRun.applicationRelease) {
      facts.push({
        name: 'Release',
        value: testRun.applicationRelease,
      });
    }

    // Add start time if available
    if (testRun.startTime) {
      facts.push({
        name: 'Started',
        value: this.formatDateTime(testRun.startTime),
      });
    }

    facts.push({
      name: 'Duration',
      value: durationText,
    });

    if (testRun.consolidatedResult) {
      const { meetsRequirement, adaptTestRunOK, overall } = testRun.consolidatedResult;

      if (overall !== undefined) {
        facts.push({
          name: 'Overall',
          value: overall ? '🟢 Passed' : '🔴 Failed',
        });
      }

      if (meetsRequirement !== undefined) {
        facts.push({
          name: 'Service Level Objectives',
          value: meetsRequirement ? '🟢 Passed' : '🔴 Failed',
        });
      }

      if (adaptTestRunOK !== undefined) {
        facts.push({
          name: 'Anomaly detection',
          value: adaptTestRunOK ? '🟢 Passed' : '🔴 Failed',
        });
      }
    }


    if (testRun.isStale) {
      facts.push({
        name: 'Stale',
        value: '⚠️ Test run was marked as stale (incomplete)',
      });
    }

    if (testRun.abort) {
      facts.push({
        name: 'Aborted',
        value: '🛑 Test run was aborted',
      });
    }

    if (testRun.valid === false && testRun.reasonsNotValid?.length) {
      facts.push({
        name: 'Data Issues',
        value: `⚠️ ${testRun.reasonsNotValid.join('; ')}`,
      });
    }

    if (testRun.dataWarnings?.length) {
      facts.push({
        name: 'Data Notices',
        value: `ℹ️ ${testRun.dataWarnings.join('; ')}`,
      });
    }

    return facts;
  }

  private formatDateTime(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  }

  private generateDeeplink(testRun: TestRun, systemName: string): string {
    const encodedTestRunId = encodeURIComponent(testRun.testRunId);
    const encodedSystem = encodeURIComponent(systemName);
    const encodedWorkload = encodeURIComponent(testRun.workload);
    const encodedEnv = encodeURIComponent(testRun.testEnvironment);

    return `${this.perfanaUrl}/test-runs/${encodedTestRunId}?systemUnderTest=${encodedSystem}&workload=${encodedWorkload}&testEnvironment=${encodedEnv}`;
  }

  private sanitizeTestRunId(testRunId: string): string {
    return testRunId
      .replace(/\//g, '-')
      .replace(/\s/g, '-')
      .replace(/\|/g, '-')
      .replace(/=/g, '-')
      .replace(/\(/g, '-')
      .replace(/\)/g, '-');
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
}
