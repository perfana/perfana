# Connect Confluence

Connect Confluence so you can publish a generated report as a Confluence page. The page carries the report's headings, tables and text, PASS/FAIL results as Confluence status lozenges, collapsible groups as expand sections, and every chart as an image. Publishing the same report again updates its page as a new version instead of creating a second one.

The Confluence page is a static copy. Hover readouts and table filters stay in Perfana; the page links back to the test run for those.

**Before you start**
- Select your active organization in the sidebar (**Configuration** group).
- Know which Confluence you have. An address ending in `atlassian.net` is **Cloud**. Anything else is **Data Center** (or the older Server edition): open **Help (?) → About Confluence** to see the version, which must be **7.9 or later**.
- Have a token for an account that can **add pages and attachments** in the target space:
  - **Data Center**: a personal access token. In Confluence, click your avatar → **Settings** → **Personal Access Tokens** → **Create token**. If that menu is missing, your Confluence administrator has switched personal access tokens off.
  - **Cloud**: the account's email address and an API token from **id.atlassian.com → Security → API tokens**.
- Have the **space key** reports go into, for example `PERF`. It is in the space's URL and in **Space settings**.
- Optional: the numeric **id of a parent page**, if reports should sit under one page rather than at the space root. Open the page, click **•••** → **Page information**; the id is the number at the end of the URL.

## Connect Confluence to your organization

1. In the sidebar, open **Integrations**.
2. Click **Add Integration**, choose **Confluence**, then click **Connect**.
   The **Add Confluence connection** dialog opens.
3. Enter a **Label**, for example `Team wiki`.
4. Choose the **Deployment**: **Data Center / Server** or **Cloud**.
5. Enter the **Confluence URL**:
   - Data Center: the address you open Confluence at, including any path, for example `https://wiki.example.com/confluence`.
   - Cloud: your site, for example `https://your-site.atlassian.net`.
6. Enter the token. On Cloud, also enter the **Atlassian account email**.
7. Enter the **Space key** and, optionally, the **Parent page id**.
8. If your organization reaches Confluence through a proxy, turn on **Connect through the organization proxy**.
9. Click **Test connection**.
   Perfana looks up the space with these credentials and shows its name, or says why it could not.
10. Click **Add**.

## Publish a report

1. Open the test run and expand the **Reports** card.
2. On the report's row, click the share icon, then **Publish to Confluence**.
3. Pick the **Connection** and, optionally, change the **Page title**. The default is the report name and the test run id.
4. Click **Publish**.
   Perfana renders the charts, creates the page and uploads the charts as attachments. A large report takes up to a minute. When it is done, **Open the page in Confluence** takes you there, and the share menu gains **Open Confluence page**.

To update the page after regenerating or editing the report, publish it again to the same connection.

Publishing needs the same permission as sharing a report: you must be able to update the test run.

## Troubleshooting

- *Confluence rejected the credentials (401)*: the token is wrong or expired, or on Cloud the email does not belong to the token.
- *The Confluence account lacks permission (403)*: the account cannot add pages in that space. Ask the space administrator for **Add page** and **Add attachment** permission.
- *A page with this title already exists*: Confluence titles are unique within a space. Choose another title.
- *Confluence answered with something other than JSON*: the URL points at a login page or a proxy, not at Confluence itself. Check the context path, for example `/confluence`.
- *The report service did not render the charts in time*: the `perfana-report` service is not running, or is busy. Try again; ask your Perfana administrator if it keeps happening.
