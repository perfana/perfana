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
8. If your organization reaches the chat service through a proxy, turn on **Use proxy**.
9. Save the channel, then click **Send test notification** on its row.
   A test message appears in the chat channel, or Perfana says why it could not send it.

**Result**
Every run of this system that finishes and completes its analysis posts a message to the channel.

**The webhook URL is kept secret**
A webhook URL lets anyone who has it post into your channel, so Perfana treats it like a password. It is stored encrypted, and after you save a channel Perfana shows `[MASKED]` instead of the URL. To keep the URL when you edit a channel, leave the field as it is. To replace it, paste the new URL.

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
