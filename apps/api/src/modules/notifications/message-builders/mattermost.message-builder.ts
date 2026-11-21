import { TestRun } from '@perfana/shared';
import { CommentDigest, commentDetail, commentHeadline } from './comment-digest';
import { StoryAnnouncement, storyDetail, storyHeadline } from './comment-digest';

/**
 * Mattermost incoming-webhook payload.
 *
 * Mattermost accepts Slack's legacy `text` + `attachments` format, NOT Slack Block Kit:
 * a `blocks` array is ignored, which is why the Slack builder cannot be reused. Text is
 * Mattermost markdown (`**bold**`, `[label](url)`), not Slack mrkdwn.
 * @see https://developers.mattermost.com/integrate/webhooks/incoming/
 */
interface MattermostField {
  short: boolean;
  title: string;
  value: string;
}

interface MattermostAttachment {
  fallback: string;
  color: string;
  title?: string;
  title_link?: string;
  text?: string;
  fields?: MattermostField[];
}

export interface MattermostMessage {
  /** Shown only if the server allows overriding the webhook's display name. */
  username: string;
  text: string;
  attachments?: MattermostAttachment[];
}

const COLOR_PASSED = '#2E7D32';
const COLOR_FAILED = '#C62828';
const COLOR_INFO = '#1E325C';

/**
 * Builds Mattermost notification messages for test run results
 */
export class MattermostMessageBuilder {
  constructor(private readonly perfanaUrl: string) {}

  /**
   * Build a Mattermost message for test run completion
   */
  buildTestRunResultMessage(testRun: TestRun, systemName: string): MattermostMessage {
    const passed = testRun.consolidatedResult?.overall === true;
    const statusText = passed ? 'Test run passed!' : 'Test run failed!';
    const statusEmoji = passed ? ':white_check_mark:' : ':x:';
    const deeplink = this.generateDeeplink(testRun, systemName);

    const fields: MattermostField[] = [
      { short: true, title: 'Test run', value: this.sanitizeTestRunId(testRun.testRunId) },
      { short: true, title: 'Duration', value: testRun.duration ? this.formatDuration(testRun.duration) : 'N/A' },
    ];
    if (testRun.applicationRelease) {
      fields.push({ short: true, title: 'Version', value: testRun.applicationRelease });
    }
    if (testRun.startTime) {
      fields.push({ short: true, title: 'Started', value: this.formatDateTime(testRun.startTime) });
    }
    if (testRun.annotations && testRun.annotations.length > 0) {
      fields.push({ short: false, title: 'Annotations', value: testRun.annotations.join(' | ') });
    }

    const subtitle = `${systemName} | ${testRun.testEnvironment} | ${testRun.workload}`;

    return {
      username: 'Perfana',
      text: `${statusEmoji} **${statusText}** ${subtitle}`,
      attachments: [
        {
          fallback: `${statusText} ${subtitle}`,
          color: passed ? COLOR_PASSED : COLOR_FAILED,
          title: subtitle,
          title_link: deeplink,
          text: `${this.buildResultDetails(testRun)}\n\n[View test run in Perfana](${deeplink})`,
          fields,
        },
      ],
    };
  }

  /**
   * Build a test notification message
   */
  /** One post per comment burst: count, latest author, card and a link; no comment text. */
  buildCommentMessage(digest: CommentDigest): MattermostMessage {
    const headline = commentHeadline(digest);
    return {
      username: 'Perfana',
      text: `:speech_balloon: **${headline}**`,
      attachments: [
        {
          fallback: headline,
          color: COLOR_INFO,
          text: `${commentDetail(digest)}\n\n[View comments in Perfana](${digest.link})`,
        },
      ],
    };
  }

  /** One post per published story: who, where, its title and step count, and a reader link. */
  buildStoryMessage(story: StoryAnnouncement): MattermostMessage {
    const headline = storyHeadline(story);
    return {
      username: 'Perfana',
      text: `:books: **${headline}**`,
      attachments: [
        {
          fallback: `${headline}: ${storyDetail(story)}`,
          color: COLOR_INFO,
          text: `${storyDetail(story)}\n\n[Read the investigation in Perfana](${story.link})`,
        },
      ],
    };
  }

  buildTestMessage(systemName: string): MattermostMessage {
    return {
      username: 'Perfana',
      text: ':bell: **Perfana Test Notification**',
      attachments: [
        {
          fallback: 'Perfana Test Notification',
          color: COLOR_INFO,
          text:
            `This is a test notification from Perfana for system **${systemName}**.\n` +
            ':white_check_mark: Your Mattermost notification channel is configured correctly!',
        },
      ],
    };
  }

  private buildResultDetails(testRun: TestRun): string {
    const lines: string[] = [];

    if (testRun.consolidatedResult) {
      const { meetsRequirement, adaptTestRunOK, overall } = testRun.consolidatedResult;
      if (overall !== undefined) {
        lines.push(`**Overall:** ${overall ? '🟢 Passed' : '🔴 Failed'}`);
      }
      if (meetsRequirement !== undefined) {
        lines.push(`**Service Level Objectives:** ${meetsRequirement ? '🟢 Passed' : '🔴 Failed'}`);
      }
      if (adaptTestRunOK !== undefined) {
        lines.push(`**Anomaly detection:** ${adaptTestRunOK ? '🟢 Passed' : '🔴 Failed'}`);
      }
    }

    if (testRun.isStale) {
      lines.push(':warning: **Stale:** Test run was marked as stale (incomplete)');
    }
    if (testRun.abort) {
      lines.push(':octagonal_sign: **Aborted:** Test run was aborted');
    }
    if (testRun.valid === false && testRun.reasonsNotValid?.length) {
      lines.push(`:warning: **Data Issues:**\n${testRun.reasonsNotValid.map((r) => `- ${r}`).join('\n')}`);
    }
    if (testRun.dataWarnings?.length) {
      lines.push(`:information_source: **Data Notices:**\n${testRun.dataWarnings.map((r) => `- ${r}`).join('\n')}`);
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
    return testRunId.replace(/[/\s|=()]/g, '-');
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
}
