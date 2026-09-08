# Gauge

A Windows system-tray meter for the AI coding budgets you actually burn through:
**Claude Code**, **OpenRouter**, **OpenCode Go (Zen)** and **Codex** — plus a local
tally of what you have spent on Zen's free models.

The tray icon is a live gauge ring showing whichever tracked resource is closest
to running out. Click it for a panel with per-window detail; right-click for a
quick summary menu.

Each tracker can be switched off, and each accepts a key in Settings — but on a
machine where you already use these CLIs, Gauge finds the credentials itself and
works with zero configuration.

---

## What it reads, and from where

| Tracker | Source | What you get |
|---|---|---|
| **Claude Code** | `GET api.anthropic.com/api/oauth/usage` using the login in `~/.claude/.credentials.json` | 5-hour session + 7-day windows (plus per-model windows when your plan has them), % used and reset time |
| **OpenCode Go** | `GET opencode.ai/zen/go/v1/usage` using the key in `~/.local/share/opencode/auth.json` | Rolling, weekly and monthly quota windows |
| **Codex** | `GET chatgpt.com/backend-api/wham/usage` using the login in `~/.codex/auth.json` | Plan type, rate-limit windows, credit balance |
| **OpenRouter** | `GET openrouter.ai/api/v1/credits` and `/key` | Credit balance remaining, plus the per-key spend cap if you set one |
| **OpenCode Free** | `~/.local/share/opencode/opencode-v1.db` (read-only) | Requests and tokens spent on free Zen models — a tally, not a limit (see below) |

**Credential auto-detection.** Nothing is entered by hand unless you want it to
be. Gauge looks for the Claude Code login, the OpenCode auth store (and the Zen
token in `~/.codex/config.toml` if Codex is pointed at the Zen gateway), the
Codex ChatGPT login, and `OPENROUTER_API_KEY` in your environment. Settings shows
what it found for each tracker.

**Codex fallback.** If the ChatGPT login is expired or absent, Gauge falls back to
the newest `rate_limits` snapshot Codex writes into its own session transcripts
under `~/.codex/sessions/`. The card says when a reading came from there.

---

## Drilling into the Go plan

Click the **OpenCode Go** card to see every model on the plan, in two views you
toggle between:

- **Pricing** — input / output rate per 1M tokens, plus that model's **monthly
  dollar pool**. The pool is not uniform: it runs from $15 (Grok 4.6, Kimi K3) to
  $100 (Omen Alpha).
- **Requests** — roughly how many requests per month that pool buys, from ~490 on
  Kimi K3 to ~226,600 on Muse Spark 1.3 Contributor.

Both views keep the same ordering, so toggling re-expresses the same list rather
than reshuffling it. Hover any row for cached-read/write rates, the 5-hour and
weekly figures, and tiered pricing where a model charges more past a context
threshold (marked `*`).

The Go plan is $10/month with pooled limits of **$12 per 5 hours, $30 weekly and
$60 monthly**. Each model's own pool caps its monthly share; the 5-hour and weekly
pools are 20% and 50% of it (verified against the published request counts, which
match those ratios to three decimals across every model).

### Keeping up when the model list changes

The table is parsed from `opencode.ai/docs/go`, cached in
`%APPDATA%/Gauge/go-plan.cache.json`, and falls back to a bundled snapshot at
`src/main/data/go-plan.json` if the page is unreachable or changes shape.

Gauge re-checks it **every 6 hours** and diffs the result against what it had, so
models that appear, disappear or change price are picked up on their own. When
something moves you get a notification (`2 added, 1 repriced`) and a banner in
the detail view saying what changed and when. The refresh button in that view
forces an immediate re-check.

The first check after an install compares against the bundled snapshot, so it is
deliberately silent - otherwise every new install would announce months of
accumulated changes as if they had just happened.

---

## Free Zen models: a tally, not a meter

Free models (`*-free`, plus `grok-code` and `big-pickle`) are served from
`opencode.ai/zen/v1`, **not** the `/zen/go/v1` base your Go subscription uses, and
that base exposes nothing to measure:

- `GET /zen/v1/usage` → 404. The usage endpoint exists only under `/zen/go/v1`,
  and it reports the Go plan's quota, which free models do not draw from.
- Requests to `/zen/v1` come back with **no `x-ratelimit-*` headers** at all.
- The Zen docs publish no free-tier allowance. "Monthly limits" there means a
  dollar spend cap on paid usage.

So there is no remaining-allowance number to read — a "% left" meter for free
models would be invented. What *is* available is your own consumption: OpenCode
records every assistant message in its local SQLite history with the model,
token counts and cost. Gauge reads that (read-only, via Node's built-in
`node:sqlite`) and reports **requests and tokens over the last 7 days**, broken
down by model.

That is why this card shows a count and a per-model breakdown instead of a bar.
It answers "how much have I leaned on free models?" — not "how much is left?",
which nothing currently can.

If OpenCode ever publishes a free-tier limit or starts returning rate-limit
headers, this becomes a real meter with a one-line change: give the provider a
`meters` array instead of a `stats` array.

---

## Installing

Run **`Gauge-1.0.0-Setup.msi`**. It is a per-user install (no admin prompt), and
adds Start Menu and Desktop shortcuts.

To build it yourself:

```bash
npm install
npm run dist          # -> dist/Gauge-1.0.0-Setup.msi
```

`npm run dist` regenerates `build/icon.ico` from the same renderer the tray uses,
then packages with electron-builder. The `upgradeCode` is pinned, so a later
version upgrades in place rather than installing alongside.

### Starting with Windows

**On by default.** On every launch Gauge reconciles the OS login item with the
`launchAtLogin` setting, so a fresh install registers itself the first time it
runs and keeps that entry in step if you toggle it later. It starts minimised to
the tray (`--hidden`), not with the panel open.

Only the installed build reconciles this on launch. Electron keys the entry by
app id, so a `npm start` run would otherwise repoint it at `electron.exe` and
break autostart for the installed copy; running from source therefore leaves the
entry alone unless you toggle the setting yourself.

The registration is a per-user entry under
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, written through
Electron's `setLoginItemSettings`. Turn it off any time under
**Settings → Start with Windows**, or in Task Manager's Startup tab.

### Running from source

```bash
npm install
npm start
```

Or double-click **`Start Gauge.vbs`** to launch with no console window.

---

## Settings

- **Trackers** — toggle each source, paste a key, and **Test connection** to
  confirm it before relying on it. A stored key can be removed at any time.
- **Refresh every** — 1 to 60 minutes (default 5). The panel also refreshes when
  you open it.
- **Appearance** — follows Windows, or force light/dark.
- **Tray icon** — ring only, or ring with the used percentage inside it.
- **Notify when running low** — one notification per window per reset cycle, at a
  threshold you choose. Also covers Go model-list changes.
- **Start with Windows** — on by default; see above.

### Where your keys live

Keys you type into Settings are encrypted with the OS credential store
(DPAPI on Windows) via Electron's `safeStorage`, and written to
`%APPDATA%/Gauge/secrets.dat`. They are only ever sent to the provider they
belong to. If the OS refuses to provide encryption, Gauge says so in the
Settings footer rather than silently storing them in the clear.

Auto-detected credentials are read from the CLI config files at refresh time and
never copied into Gauge's own storage.

---

## Reading the panel

The big number is whichever window is closest to exhaustion across everything you
track — the thing that will actually stop you first — expressed as **% left**.
Each card below shows that provider's own windows.

Colour means one thing only: **severity**. Green healthy, amber watch, orange low,
red critical — always paired with an icon and a word, never colour alone.
Providers are told apart by name and monogram, not by hue.

Bars fill with the percentage **used**; the headline numbers are what's **left**.
Hover any bar for exact figures.

---

## Notes and limits

- **Expired logins.** Gauge reads the tokens your CLIs manage; it does not refresh
  them. If Claude Code or Codex reports "Login expired", run `claude` or `codex`
  once and the next refresh picks it up.
- **Codex `rate_limits` can be null** when Codex is routed through a non-ChatGPT
  gateway (for example an OpenCode Zen base URL). That is a property of the
  upstream data, not a bug — the ChatGPT usage API is still used when the login
  is present.
- **Windows only** in the sense that it has only been exercised there; nothing in
  the code is Windows-specific except the login-item behaviour.

---

## Layout

```
src/
  main/
    main.js            app lifecycle, tray, windows, IPC
    poller.js          scheduling, caching, low-usage alerts
    store.js           settings + safeStorage-encrypted secrets
    icon.js            tray gauge rendered at runtime
    goPlan.js          Go plan pricing/pool/request table (scrape + cache)
    providers/         one module per tracked service
                       (opencodeFree.js reads OpenCode's local history)
    util/
      png.js           dependency-free PNG encoder
      raster.js        anti-aliased arc/disc rasteriser
      http.js          fetch with timeouts and typed failures
      local.js         readers for the CLIs' own credential files
  preload/preload.js   contextBridge API
  renderer/            panel + settings UI
```

There are no runtime dependencies — the tray icon is drawn pixel by pixel and
encoded to PNG in-process, so the only install is Electron itself.

Dev helper: `electron . --screenshot <dir>` renders both windows to PNG and exits.
