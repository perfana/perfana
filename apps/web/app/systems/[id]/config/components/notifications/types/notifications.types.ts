/**
 * Notification channel type definitions
 */

export type ChannelType = 'slack' | 'teams' | 'mattermost';

/**
 * What the API returns in place of a saved webhook URL (the URL is a credential and is
 * never sent back). Saving the form with this value unchanged keeps the stored URL.
 */
export const MASKED_WEBHOOK_URL = '[MASKED]';

/**
 * What the API returns in place of a saved webhook URL (the URL is a credential and is
 * never sent back). Saving the form with this value unchanged keeps the stored URL.
 */
export const MASKED_WEBHOOK_URL = '[MASKED]';

/**
 * Notification channel entity from the API
 */
export interface NotificationChannel {
  id: string;
  systemUnderTestId: string;
  type: ChannelType;
  name: string;
  webhookUrl: string;
  notifyOnFinished: boolean;
  notifyOnFailedOnly: boolean;
  enabled: boolean;
  useProxy: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Props for the NotificationsSection component
 */
export interface NotificationsSectionProps {
  systemId: string;
  systemName: string;
}

/**
 * Form data for creating/editing a notification channel
 */
export interface NotificationChannelFormData {
  type: ChannelType;
  name: string;
  webhookUrl: string;
  notifyOnFailedOnly: boolean;
  enabled: boolean;
  useProxy: boolean;
}

/**
 * Initial form data for a new notification channel
 */
export const INITIAL_FORM_DATA: NotificationChannelFormData = {
  type: 'slack',
  name: '',
  webhookUrl: '',
  notifyOnFailedOnly: false,
  enabled: true,
  useProxy: false,
};

/**
 * Snackbar notification state
 */
export interface SnackbarState {
  open: boolean;
  message: string;
  severity: 'success' | 'error';
}

/**
 * Props for the useNotificationsData hook
 */
export interface UseNotificationsDataProps {
  systemId: string;
  onSnackbar: (state: SnackbarState) => void;
}

/**
 * Dialog mode - either adding a new channel or editing an existing one
 */
export type DialogMode = 'add' | 'edit';

/**
 * Get display label for channel type
 */
export function getChannelTypeLabel(type: ChannelType): string {
  switch (type) {
    case 'slack':
      return 'Slack';
    case 'teams':
      return 'Microsoft Teams';
    case 'mattermost':
      return 'Mattermost';
    default:
      return type;
  }
}

/**
 * Get brand color for channel type
 */
export function getChannelTypeColor(type: ChannelType): string {
  switch (type) {
    case 'slack':
      return '#4A154B'; // Slack purple
    case 'teams':
      return '#6264A7'; // Teams purple
    case 'mattermost':
      return '#1E325C'; // Mattermost denim
    default:
      return '#757575';
  }
}

/**
 * Get placeholder webhook URL for channel type
 */
export function getWebhookPlaceholder(type: ChannelType): string {
  switch (type) {
    case 'slack':
      return 'https://hooks.slack.com/services/...';
    case 'teams':
      return 'https://outlook.office.com/webhook/...';
    case 'mattermost':
      return 'https://mattermost.example.com/hooks/...';
    default:
      return '';
  }
}

/**
 * Get helper text for webhook URL field
 */
export function getWebhookHelperText(type: ChannelType): string {
  switch (type) {
    case 'slack':
      return 'Enter your Slack incoming webhook URL';
    case 'teams':
      return 'Enter your Microsoft Teams incoming webhook URL';
    case 'mattermost':
      return 'Enter your Mattermost incoming webhook URL (ending in /hooks/<key>). A server on an internal address must be allowed by your Perfana administrator.';
    default:
      return '';
  }
}
