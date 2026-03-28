import { TestRun } from '@perfana/shared';

/**
 * Slack Block Kit message format
 * @see https://api.slack.com/reference/block-kit/blocks
 */
interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
  };
  elements?: Array<{
    type: string;
    text?: string;
  }>;
}

interface SlackMessage {
  text: string;
  blocks: SlackBlock[];
}

/**
 * Builds Slack notification messages for test run results
 */
export class SlackMessageBuilder {
  constructor(private readonly perfanaUrl: string) {}

  /**
   * Build a Slack message for test run completion
   */
  buildTestRunResultMessage(testRun: TestRun, systemName: string): SlackMessage {
    const passed = testRun.consolidatedResult?.overall === true;
    const statusText = passed ? 'Test run passed!' : 'Test run failed!';
    const statusEmoji = passed ? ':white_check_mark:' : ':x:';

    const deeplink = this.generateDeeplink(testRun, systemName);
    const sanitizedTestRunId = this.sanitizeTestRunId(testRun.testRunId);

    // Format duration
    const durationText = testRun.duration
      ? this.formatDuration(testRun.duration)
      : 'N/A';

    // Build result summary
    const resultDetails = this.buildResultDetails(testRun);

    const blocks: SlackBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${statusEmoji} *${statusText}*`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*System:* ${systemName} | *Environment:* ${testRun.testEnvironment} | *Workload:* ${testRun.workload}`,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*Test Run:* ${sanitizedTestRunId}${testRun.applicationRelease ? ` | *Version:* ${testRun.applicationRelease}` : ''}`,
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${testRun.startTime ? `*Started:* ${this.formatDateTime(testRun.startTime)} | ` : ''}*Duration:* ${durationText}`,
          },
        ],
      },
      // Add annotations block if annotations exist
      ...(testRun.annotations && testRun.annotations.length > 0
        ? [
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `*Annotations:* ${testRun.annotations.join(' | ')}`,
                },
              ],
            },
          ]
        : []),
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: resultDetails,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<${deeplink}|View test run in Perfana>`,
        },
      },
    ];

    return {
      text: statusText,
      blocks,
    };
  }

  /**
   * Build a test notification message
   */
  buildTestMessage(systemName: string): SlackMessage {
    return {
      text: 'Perfana Test Notification',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: ':bell: *Perfana Test Notification*',
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `This is a test notification from Perfana for system *${systemName}*`,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: ':white_check_mark: Your Slack notification channel is configured correctly!',
          },
        },
      ],
    };
  }

  private buildResultDetails(testRun: TestRun): string {
    const lines: string[] = [];

    if (testRun.consolidatedResult) {
      const { meetsRequirement, adaptTestRunOK, overall } = testRun.consolidatedResult;

      if (overall !== undefined) {
        lines.push(`*Overall:* ${overall ? '🟢 Passed' : '🔴 Failed'}`);
      }

      if (meetsRequirement !== undefined) {
        lines.push(`*Service Level Objectives:* ${meetsRequirement ? '🟢 Passed' : '🔴 Failed'}`);
      }

      if (adaptTestRunOK !== undefined) {
        lines.push(`*Anomaly detection:* ${adaptTestRunOK ? '🟢 Passed' : '🔴 Failed'}`);
      }
    }


    if (testRun.isStale) {
      lines.push(':warning: *Stale:* Test run was marked as stale (incomplete)');
    }

    if (testRun.abort) {
      lines.push(':octagonal_sign: *Aborted:* Test run was aborted');
    }

    if (testRun.valid === false && testRun.reasonsNotValid?.length) {
      lines.push(`:warning: *Data Issues:*\n${testRun.reasonsNotValid.map(r => `  - ${r}`).join('\n')}`);
    }

    if (testRun.dataWarnings?.length) {
      lines.push(`:information_source: *Data Notices:*\n${testRun.dataWarnings.map(r => `  - ${r}`).join('\n')}`);
    }

    return lines.length > 0 ? lines.join('\n') : 'Test run completed';
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
