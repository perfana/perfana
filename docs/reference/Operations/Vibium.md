# Checking the UI with Vibium

[Vibium](https://vibium.com/docs/installation/) is a browser automation CLI. Use it to check a UI change on a running stack, by hand or from a coding agent. It drives its own browser, so it never touches your signed-in Chrome.

It is installed per user, not as a repo dependency: nothing imports it, and its skill could not find a repo copy from `apps/web` or from a worktree without its own install ([#708](https://github.com/perfana/perfana/pull/708)).

## Install

```bash
npm install -g vibium
vibium add-skill
```

- **nvm keeps global packages per Node version.** Repeat the install under each version you use. This repo's `.nvmrc` is 24.
- **The skill** is written to `~/.claude/skills/vibe-check`.
- **The browser** is Chrome for Testing, about 400 MB. It downloads on install or on first use; `vibium paths` shows where.

## Start and sign in

These are the `perfana-demo` stack's public demo credentials, from that repo's README. Use them on a local demo stack only. The repo's own `docker-compose.infra.yml` stack has a different login; see Quick Start in the root `CLAUDE.md`.

```bash
vibium daemon start --headless --idle-timeout 0
vibium viewport 1280 900

vibium go http://localhost:4000/signin
vibium find text "Sign In with Keycloak"
vibium click @e1
vibium wait "#username"
vibium fill "#username" "admin@perfana.io"
vibium fill "#password" "Test@1234"
vibium click 'input[name="login"]'
vibium wait url "localhost:4000" --timeout 20s
vibium wait text "Test Runs" --timeout 20s
```

- **Set the viewport first.** Headless starts at 756×469, where Perfana hides its sidebar and `map` can find nothing.
- **`--idle-timeout 0`** keeps the browser open. The default closes it after 30 minutes idle, and that loses the sign-in.
- **To watch it run,** drop `--headless`.
- **Home reads "Select an organization"** in a new browser profile. Pick one in the sidebar, or go straight to a test run, which does not need it.

## Open a page

`go` can report a failure on a page that loaded, because Perfana's auth redirect interrupts it. Do not rely on its exit code. Wait for something on the page and read the URL instead:

```bash
perfana_open() {  # perfana_open <url> <text that proves the page rendered>
  vibium go "$1" || true
  vibium wait load
  vibium wait text "$2" --timeout 20s
  vibium url
}

RUN=http://localhost:4000/test-runs/PerfanaWebshop-acc-loadTest-00004  # any run from /test-runs
perfana_open "$RUN" "Reporting"
```

## Find your way around

```bash
GRAPHS='[data-testid=graphs-card-expanded]'
TRENDS='[data-testid=trends-card-expanded]'
COMPARE='[data-testid=compare-card-expanded]'

# The Graphs, Trends and Compare cards are on the Reporting tab
vibium find text "Reporting"
vibium click @e1
vibium wait '[data-testid=graphs-card-collapsed]' --timeout 15s

# Expand a card, then open its saved presets
vibium click '[data-testid=graphs-card-collapsed]'
vibium wait "$GRAPHS"
vibium click "$GRAPHS .MuiAccordionSummary-root"
vibium wait text "Saved presets"

# One reference per preset, in table order. @e1 loads the first row.
vibium find "$GRAPHS button[aria-label=\"Load Preset\"]" --all
vibium click @e1
vibium wait "$GRAPHS .js-plotly-plot" --timeout 20s
```

A link can put series straight on a chart, and the card opens by itself. A dashboard-only link adds every series on that dashboard, up to 50:

```bash
JVM='JVM%20memory%20management%20G1GC%20afterburner-be'
perfana_open "$RUN?card=graphs&dashboard=$JVM" "Graphs"
vibium wait "$GRAPHS .js-plotly-plot" --timeout 30s
```

In Compare, choose a run from the selector, then open a metric's chart with its `Show graph` button:

```bash
perfana_open "$RUN?card=compare&dashboard=$JVM" "Compare"
vibium wait "$COMPARE input[role=combobox]" --timeout 20s
vibium click "$COMPARE input[role=combobox]"
vibium wait text "PerfanaWebshop-acc-loadTest-00003" --timeout 10s
vibium find text "PerfanaWebshop-acc-loadTest-00003"
vibium click @e1
vibium wait "$COMPARE button[aria-label=\"Show graph\"]" --timeout 20s
vibium click "$COMPARE button[aria-label=\"Show graph\"]"
vibium wait "$COMPARE .js-plotly-plot" --timeout 15s
```

## Read a chart

A screenshot shows how a chart looks. For numbers, read them from the Plotly graph div. Use `_fullLayout` for sizes, because Plotly deletes `height` from `gd.layout` whenever it resizes.

```bash
perfana_open "$RUN?card=graphs&dashboard=$JVM" "Graphs"
vibium wait "$GRAPHS .js-plotly-plot" --timeout 30s

CHART='(() => {
  const gd = document.querySelector("[data-testid=graphs-card-expanded] .js-plotly-plot");
  const axes = Object.keys(gd._fullLayout).filter((k) => k.startsWith("yaxis")).map((k) => {
    const id = k === "yaxis" ? "y" : "y" + k.slice(5);
    const ys = gd.data.filter((t) => (t.yaxis || "y") === id).flatMap((t) => [...t.y]).filter((v) => v != null);
    return { axis: k, top: gd._fullLayout[k].range[1], max: ys.length ? Math.max(...ys) : null };
  });
  return JSON.stringify({ height: gd._fullLayout.height, width: gd._fullLayout.width, series: gd.data.length, axes });
})()'
vibium eval "$CHART"
```

Drive it with real input, then read it again. A resize and a hover are what used to squash the lanes. Give the chart a moment after a resize, or you read the old width:

```bash
vibium viewport 1000 800
vibium sleep 1500
vibium hover "$GRAPHS .js-plotly-plot .nsewdrag"
vibium viewport 1280 900
vibium sleep 1500
vibium eval "$CHART"
vibium screenshot -o chart-page.png
```

## Check what Copy produces

Copy writes to your real clipboard, or downloads a file if the browser refuses. To inspect the image instead, block the clipboard write in the page and capture what Plotly renders. A page load removes the block.

```bash
vibium eval '(() => {
  const P = window.Plotly;
  const render = P.toImage;
  P.toImage = (gd, opts) => {
    window.__figure = { title: gd.layout?.title?.text, showlegend: gd.layout?.showlegend, names: (gd.data || []).map((t) => t.name) };
    return render.call(P, gd, opts).then((url) => { window.__png = url; return url; });
  };
  Object.defineProperty(navigator, "clipboard", { value: { write: () => Promise.resolve() }, configurable: true });
  return "ready";
})()'

vibium click "$GRAPHS button[aria-label=\"Copy chart to clipboard\"]"
vibium wait fn "!!window.__png" --timeout 15s
vibium eval "JSON.stringify(window.__figure)"
vibium eval "window.__png" | node -e 'process.stdin.setEncoding("utf8");let u="";process.stdin.on("data",(d)=>u+=d).on("end",()=>require("fs").writeFileSync("chart.png",Buffer.from(u.trim().split(",")[1],"base64")))'
```

## Finish

Stopping discards the browser profile and the sign-in.

```bash
vibium daemon stop
```

## Known issues

| What you see | Why, and what to do |
|---|---|
| `go` fails with `BiDi error: unknown error` | Perfana's auth redirect interrupted it, and the page probably loaded. Use `perfana_open` above. A refused port gives the same error, so check the stack is up if the URL never changes. |
| `map` finds nothing, or the sidebar is missing | The viewport is too small. Run `vibium viewport 1280 900`. |
| A `click` takes 30 seconds to fail | That is its timeout for a missing element or a stale reference. Run `vibium wait "<selector>" --timeout 5s` first, and run `find` or `map` again after the page changes. |
| A chart looks too narrow in a screenshot | `--full-page` collapses Perfana's sidebar and takes the picture before the chart catches up. It also captures only the viewport, because the page scrolls inside a container. Use a plain `screenshot`. |
| `vibium window` changes nothing | A viewport set earlier overrides it. Use `vibium viewport`. |
| Two agents interfere with each other | The default session is shared across folders. Give each agent `--session <name>`. Sessions are isolated, so each one signs in separately. |
| `a11y-tree` has no element names | It omitted them on the sign-in page, the only page tested. Use `map`. |

`vibium mcp` also runs an MCP server, but it exposes 85 tools. Prefer the CLI and the skill.
