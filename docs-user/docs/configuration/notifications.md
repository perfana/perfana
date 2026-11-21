# Send notifications to Slack, Teams or Mattermost

Perfana can post a message to a chat channel when a test run has finished and its analysis is done. The message shows whether the run passed, the SLO and anomaly detection results, and a link to the run in Perfana. Channels are set per system under test.

**Before you start**

- You have a [system under test](create-system-under-test.md).
- You are an organization admin or member. Viewers can see a system's channels but cannot add, change or test them.
- You have an **incoming webhook URL** for the channel:
    - **Slack**: create an incoming webhook in your Slack app. The URL starts with `https://hooks.slack.com/`.
    - **Microsoft Teams**: create an incoming webhook for the channel.
    - **Mattermost**: in Mattermost, open **Integrations > Incoming Webhooks**, add one for the channel and copy its URL. It looks like `https://mattermost.example.com/hooks/<key>`.

**Steps**

1. Open the system from **Systems Under Test** (`/systems`) using its **Edit Config** button.
   You see the system's configuration page.
2. Open the **Notifications** tab.
   You see the **Notification Channels** for this system.
3. Click **Add Channel**.
4. Choose the **Channel Type**: **Slack**, **Microsoft Teams** or **Mattermost**.
5. Enter a **Channel Name**, for example `#performance-alerts`. The name is only a label in Perfana.
6. Paste the **Webhook URL**.
7. Optional: turn on **Only notify for failed test runs** to skip runs that passed.
8. Optional: turn on **Notify when test run comments are added** to also post when someone [comments on a run](../test-runs/comments.md) of this system. See [Notify on comments](#notify-on-comments).
9. If your organization reaches the chat service through a proxy, turn on **Use proxy**.
10. Save the channel, then click **Send test notification** on its row.
   A test message appears in the chat channel, or Perfana says why it could not send it.

**Result**
Every run of this system that finishes and completes its analysis posts a message to the channel.

**The webhook URL is kept secret**
A webhook URL lets anyone who has it post into your channel, so Perfana treats it like a password. It is stored encrypted, and after you save a channel Perfana shows `[MASKED]` instead of the URL. To keep the URL when you edit a channel, leave the field as it is. To replace it, paste the new URL.

Perfana encrypts the URL with the `ENCRYPTION_KEY` set on the Perfana API, so two things depend on that key:

- **Saving a channel fails with "ENCRYPTION_KEY is missing or invalid on the API".** The key is not set, or is not a 64-character hex string. Every save needs it, renaming a channel or switching it on or off included. Ask the administrator of your Perfana installation to set it and restart the API.
- **Sending fails with "Webhook URL could not be decrypted".** The key changed since the URL was saved, or the system was imported from another Perfana installation that uses a different key. Restore the original key, or paste the webhook URL into the channel again and save it.

## Notify on comments

With **Notify when test run comments are added** on, the channel also gets a message when people [comment on a test run](../test-runs/comments.md) of this system. The setting is off for every channel until you turn it on, and it is set per channel, so you can send comments to one channel and run results to another.

Perfana waits for a discussion to settle before it posts. The first new comment on a run starts a two-minute wait, and everything written on that run in the meantime goes into the same message, which arrives about 2 to 2.5 minutes after that first comment. Comments written after the message was sent start a new wait.

The message says how many comments were added, on which system and run, who wrote the latest one and on which card, with a link that opens the run at that comment. It does not quote the comments: a chat channel is often wider than the group of people who can see the run, so readers follow the link and sign in to read them.

A few things to know:

- **Only notify for failed test runs** does not apply to comments. Comments on a run that passed are posted too.
- A comment deleted before the message was sent is not counted or mentioned. Edits do not cause a new message.
- Comments written before you turned the setting on for a channel are not announced to it afterwards. Comments that existed when Perfana was upgraded to a version with this setting are never announced.
- Comments that arrive with a system imported from another Perfana installation are never announced.
- If no channel of the system could be reached because a chat service was temporarily unavailable, Perfana tries again every 5 minutes, for up to an hour after the first of those comments. After that it gives up. Once at least one channel has the message, or when every channel that failed refused it for good (for example a deleted webhook), it is not sent again; the Perfana administrator finds the reason in the API log.

The same setting announces [analysis stories](../test-runs/comments.md#share-a-story): when someone publishes a story on a run of this system, the channel gets one message naming the author, the run, the story's title and its number of steps, with a link to the story, within about 30 seconds. A story is announced once, even when it is unpublished and published again, and stories that existed when Perfana was upgraded to a version with this message, or that arrive with an imported system, are never announced. Retries after a chat service was unavailable work as for comments.

## Mattermost on an internal address

Mattermost usually runs on your own servers. Perfana posts to any Mattermost server whose address is public, with no extra setup.

Perfana refuses to post to a server whose name resolves to a private or internal address (for example `10.x.x.x` or `192.168.x.x`) from where Perfana runs. This stops a webhook from being used to reach other internal services. Saving such a channel fails with a message naming the address.

If your Mattermost server is on an internal address, a Perfana administrator can allow it: set `NOTIFICATION_WEBHOOK_ALLOWED_HOSTS` on the Perfana API to the server's host name and restart the API.

```bash
NOTIFICATION_WEBHOOK_ALLOWED_HOSTS=catchup.acme.com
```

Separate several hosts with commas. `*.acme.com` allows every host under `acme.com`. Only an administrator of the Perfana installation can change this setting; organization admins cannot.

A Mattermost webhook URL must use `https://` and end in `/hooks/` followed by the webhook key. Perfana refuses other URLs for a Mattermost channel.

When **Use proxy** is on, the proxy looks up the server's address and decides whether it may be reached, so Perfana does not check it.
