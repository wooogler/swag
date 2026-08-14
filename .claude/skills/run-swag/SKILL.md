---
name: run-swag
description: Build, run, and drive SWAG (the Next.js chatbot-studio app and its SCORE instructor tooling). Use when asked to start the app, run the dev server, take a screenshot of a page, click through the instructor board or intent workbench, run a study script, or check that a change works in the real app.
---

SWAG is a single Next.js 15 app (App Router, Postgres via drizzle) serving three
surfaces: the student chat, the **instructor SCORE studio**
(`/instructor/assignments/<id>/score`), and the **user-study tooling**
(`/study/...`). There is no test suite — the way to check a change is to run the
app and drive it. Agents drive it with
`.claude/skills/run-swag/driver.mjs`, a headless-Chromium REPL you pipe commands
into (this box has no `chromium-cli`).

All paths below are relative to the repo root.

## Prerequisites

Postgres is already running here as a **systemd service** (since boot, data in
`/var/lib/pgsql/data`). Do **not** run `npm run db:local:up` — `docker` is not
installed on this box, and the compose file would be a second, conflicting
database. Check it and move on:

```bash
pg_isready -h 127.0.0.1 -p 5432        # → 127.0.0.1:5432 - accepting connections
```

Chromium (the one Playwright downloaded) is missing its system libraries, and
`npx playwright install-deps` needs root, which you do not have. Install them
into your home directory instead — `dnf download` works without sudo:

```bash
mkdir -p /tmp/chromedeps ~/.local/chromedeps && cd /tmp/chromedeps
dnf download atk at-spi2-atk at-spi2-core mesa-libgbm alsa-lib \
  libXcomposite libXdamage libXrandr libxkbcommon libXfixes libdrm libXi
cd ~/.local/chromedeps && for f in /tmp/chromedeps/*.rpm; do rpm2cpio "$f" | cpio -idmu --quiet; done
```

Give the download several minutes — it refreshes repo metadata on a cold cache,
and a 3-minute timeout killed it mid-run.

Every browser command then needs that library path on the environment — the
driver does not set it for you. Export it and confirm the browser starts:

```bash
export LD_LIBRARY_PATH=$HOME/.local/chromedeps/usr/lib64:$LD_LIBRARY_PATH
~/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell --version
# → Google Chrome for Testing 149.0.7827.55
```

## Setup

```bash
npm install          # playwright@1.61.1 is a devDependency — the driver needs it
```

`.env` is already present and holds everything the app reads (`POSTGRES_URL`,
`OPENAI_API_KEY`, the passcodes). Nothing to export by hand.

## Run (agent path)

**Start the server.** Use `ss` to find the listener, wait for the port to
actually free, and *check the readiness marker* — see the two traps below the
block, both of which fail silently:

```bash
command -v ss >/dev/null || export PATH=$PATH:/usr/sbin
ss -tlnpH "sport = :3030" | grep -oP 'pid=\K[0-9]+' | sort -u | xargs -r kill -9
timeout 30 bash -c 'while ss -tlnH "sport = :3030" | grep -q .; do sleep 1; done' || echo "PORT STILL HELD"
(npm run dev > /tmp/swag-dev.log 2>&1 &)
timeout 120 bash -c 'until grep -qa "Ready in" /tmp/swag-dev.log; do sleep 2; done' \
  || { echo "NEVER READY"; tail -5 /tmp/swag-dev.log; }
curl -s -o /dev/null -w "%{http_code}\n" --max-time 180 http://localhost:3030/login   # → 200
```

- **`lsof -ti:3030` finds nothing here** even while a server holds the port —
  it does not see the IPv6 wildcard socket Next binds (`*:3030`). Killing by
  `lsof` therefore kills nothing, the new server dies of `EADDRINUSE`, and the
  *old* one keeps answering — so the start "succeeds" while starting nothing.
  `ss` sees it; that is why the recipe uses `ss`.
- **Wait for `Ready in`, not for a 200.** A 200 only proves *a* server is
  answering. Grepping the log is what proves it is yours.

The final `curl` is not a health check, it is a **warm-up**: dev compiles each
route on first hit, and the first one takes ~7s. Budget for it.

**Drive it.** Pipe a script to the driver:

```bash
export LD_LIBRARY_PATH=$HOME/.local/chromedeps/usr/lib64:$LD_LIBRARY_PATH
node .claude/skills/run-swag/driver.mjs <<'EOF'
as instructor
nav /instructor/assignments/ea905a40-ad5d-4fe5-bbf8-91d6b1998331/score
wait DRAFTING
click-until Write Conclusion :: Edit Intent
click Edit Intent
wait In this intent
sleep 3000
grep In this intent|Needs decision|HISTORY
shot workbench
errors
quit
EOF
```

That run prints `IN THIS INTENT · 23`, `NEEDS DECISION · 3`, `errors: none` and
writes the screenshot. **Look at the screenshot** — a rendered shell with a
failed data fetch looks fine to `grep`.

Screenshots → `/tmp/swag-shots/` (override with `SWAG_SHOTS`). Server log →
`/tmp/swag-dev.log`.

| command | what it does |
|---|---|
| `as instructor` \| `as <uuid>` | sets the `user_session` cookie; `instructor` looks up the first `instructors` row via psql |
| `nav <path>` | goto, `waitUntil: 'load'` (see Gotchas) |
| `wait <text-or-selector>` | `waitForSelector`, 180s — long enough for a cold route compile |
| `click <button-name-regex>` | clicks a `role=button` by accessible name, retrying for 20s |
| `click-text <exact text>` | clicks by exact text, retrying |
| `click-until <text> :: <expected>` | clicks until `<expected>` appears — the hydration-proof way in |
| `fill <selector> <value>` | `.fill()` (goes through React's onChange; `eval el.value=` does not) |
| `grep <regex>` \| `text` \| `count <sel>` \| `buttons` | read the page |
| `eval <js>` | `page.evaluate` |
| `shot [name]` \| `errors` \| `sleep <ms>` \| `quit` | screenshot / console+page errors / wait / exit |

For iterative poking, run the same driver under tmux and `send-keys` one command
at a time — it reads stdin line by line either way.

**Set up fixtures over the API, not the UI.** Auth is one cookie, so `curl` is
the cheap way to create the state a check needs (and to clean it up). This is
much faster than clicking, and `?mode=purge` leaves no trace:

```bash
A=<assignment-id>; C="Cookie: user_session=$(psql -h 127.0.0.1 -U swag -d swag -tAc \
  'SELECT id FROM instructors ORDER BY created_at LIMIT 1' | tr -d ' ')"
curl -s -X POST "http://localhost:3030/api/instructor/assignments/$A/score/intents" \
  -H 'Content-Type: application/json' -H "$C" \
  -d '{"title":"ZZ Test","definition":"asks the chatbot to brainstorm essay topics",
       "autoTitle":false,"recordVersion":true,"isTemplate":false,"type":"planning",
       "parentIntentId":null,"stats":{"included":0,"excluded":0,"inCount":0}}'
# …drive the UI…
curl -s -X DELETE "http://localhost:3030/api/instructor/assignments/$A/score/intents/<id>?mode=purge" -H "$C"
```

**Stop.**

```bash
ss -tlnpH "sport = :3030" | grep -oP 'pid=\K[0-9]+' | sort -u | xargs -r kill -9
```

## Which data to touch

The database is the researcher's real working data, including study-participant
clones. Pick the target deliberately:

```bash
export PGPASSWORD=swag
psql -h 127.0.0.1 -U swag -d swag -tAc \
  "SELECT a.id, a.title FROM assignments a JOIN instructors i ON i.id=a.instructor_id
   WHERE i.email='sangwooklee@vt.edu' ORDER BY a.created_at DESC"
```

- **Read-only checks** → `ea905a40-…` (*NIRVANA Dataset*), 33 intents, a full
  rated log. The realistic board.
- **Anything that writes** → `24ca0347-…` (*AI Ethics Essay*), a 2026-02 scratch
  assignment with 4 junk messages and no SCORE data. Rating it costs ~4 LLM
  calls; purge what you make afterwards.
- **Never** the `*(study)` masters or anything owned by `*@study.score.local` —
  those are participant clones, and their accounts redirect to the study session
  gate anyway.

## Run: the study admin

Passcode-gated, and the codes are in `.env` (`STUDY_ADMIN_CODES=R1,R2,R3`,
`STUDY_ADMIN_PASSCODE`). Viewing is safe; the buttons on it (Confirm · lock, Run
demo, Re-rate) mutate study state:

```bash
PC=$(grep -oP '^STUDY_ADMIN_PASSCODE=\K.*' .env)
node .claude/skills/run-swag/driver.mjs <<EOF
nav /study/admin
sleep 1500
fill input[name=code] R1
fill input[name=passcode] $PC
click Continue|Enter|Sign in
sleep 3500
shot curation
quit
EOF
```

## Run: scripts (no browser)

Every script in `scripts/` needs `--env-file=.env` explicitly. `tsx` does not
read `.env`, and without it the script dies on a Postgres `auth_failed` that
looks like a database problem rather than a missing variable:

```bash
npx tsx --env-file=.env scripts/study/check-curation-state.ts   # read-only report
```

## Test

There is no test suite (`package.json` has no `test` script). The checks are:

```bash
npx tsc --noEmit        # clean
npm run lint            # two pre-existing warnings, both unused vars:
                        #   score/rate/route.ts 'DissectionResult', SessionConsole.tsx 'onReset'
npm run build           # ~2 min, clean
```

## Human path

```bash
npm run dev   # → http://localhost:3030, Ctrl-C to stop
```

## Gotchas

- **`npm run build` then `npm run dev` breaks the dev server.** They share
  `.next/`, and dev then 500s on every route with `Cannot find module
  './5873.js'` or a missing `routes-manifest.json`. Fix: stop the server, `rm -rf
  .next`, start again. Deleting `.next` *while* a server is running leaves the
  same broken half-state, so stop first.
- **Clicks silently do nothing until the page hydrates.** In dev the HTML lands
  well before the client bundle, and a click in that window is swallowed with no
  error — it reads exactly like a broken button. `nav` waits for `load` (not
  `domcontentloaded`) and `click`/`click-text` retry for 20s. If you write your
  own Playwright, do both; this cost an hour of chasing a non-existent bug.
- **Never `pkill -f "next dev"`.** The pattern matches the agent's own command
  line and kills the session (exit 144). Kill by port, or by pid.
- **A long-running `next-server` that is not yours** (started 2026-08-04, on
  another port) shows up in `pgrep -f next`. Kill by port 3030 only; do not
  sweep every `next` process.
- **Shell env does not override `.env` for the Next server.** `SCORE_RATING_MODEL=x
  npm run dev` is ignored because `.env` sets it. To change a server-side value,
  edit `.env`.
- **`playwright` used to be `extraneous`** — present in `node_modules`, absent
  from `package.json`, so `npm ci` would have deleted it. It is now a
  devDependency pinned to 1.61.1, matching the browser build already in
  `~/.cache/ms-playwright`.
- **`getByText('PLANNING')` finds nothing.** Section headers are title-case in
  the DOM and uppercased by CSS; `innerText` gives you the uppercase, selectors
  match the DOM. Match case-insensitively.
- **LLM-backed actions are slow and cost money.** Apply rates the whole scope
  (~100 calls on NIRVANA); the fold verification loop is 15–30s. Prefer the
  scratch assignment, whose 4 untyped messages make Apply free.

## Troubleshooting

- **`error while loading shared libraries: libatk-1.0.so.0`**: `LD_LIBRARY_PATH`
  is not set for that command. Export it (Prerequisites) in the *same* shell
  invocation as the driver.
- **`Failed to start server … EADDRINUSE :::3030`**: something still holds the
  port and `lsof` did not show it. `ss -tlnpH "sport = :3030"` will. Note the
  old server keeps serving, so the symptom is "my change isn't showing up"
  rather than an error.
- **Every route 500s with `ENOENT … routes-manifest.json`**: the `.next` collision
  above. Stop the server, `rm -rf .next`, restart.
- **A script exits with `auth_failed` / `password authentication failed`**:
  missing `--env-file=.env`.
- **`/study/admin` says "Invalid researcher code or passcode"**: the code must be
  one of `STUDY_ADMIN_CODES` in `.env` (R1/R2/R3), not an arbitrary name.
- **Opening a participant clone 404s or lands on "Before you start"**: those
  assignments belong to `*@study.score.local` accounts, which are gated into the
  study session. Use a researcher-owned assignment instead.
