#!/usr/bin/env node
/**
 * SWAG browser driver — a line-oriented REPL over headless Chromium.
 *
 * There is no `chromium-cli` on this box, so this is the stand-in: pipe a
 * script to stdin (heredoc) for a one-shot check, or run it under tmux and
 * `send-keys` one command at a time to poke around. Same commands either way.
 *
 *   node .claude/skills/run-swag/driver.mjs <<'EOF'
 *   as instructor
 *   nav /instructor/assignments/<id>/score
 *   click-text Write Conclusion
 *   click Edit Intent
 *   shot workbench
 *   errors
 *   EOF
 *
 * Two things about this app the driver handles for you, because getting them
 * wrong looks like a broken app rather than a broken script:
 *
 *  - AUTH is a bare cookie. `user_session` holds an instructors.id and nothing
 *    else — no JWT, no expiry — so `as <uuid>` is the whole login. `as
 *    instructor` picks the first instructor row via psql.
 *  - HYDRATION is slow in dev. Next compiles the route on first hit, and until
 *    the client bundle attaches, every click silently does nothing: the DOM is
 *    there, React is not. `nav` waits for load (not domcontentloaded), and
 *    `click`/`click-text` retry for 20s. If you write your own script, do the
 *    same or you will chase a phantom bug.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';

const BASE = process.env.SWAG_URL || 'http://localhost:3030';
const OUT = process.env.SWAG_SHOTS || '/tmp/swag-shots';
fs.mkdirSync(OUT, { recursive: true });

/** First instructor id, straight from the DB — the app has no test fixtures. */
function firstInstructorId() {
  const url = new URL(
    (fs.readFileSync('.env', 'utf8').match(/^POSTGRES_URL=(.+)$/m) || [])[1] ||
      'postgresql://swag:swag@127.0.0.1:5432/swag'
  );
  return execFileSync(
    'psql',
    ['-h', url.hostname, '-p', url.port, '-U', url.username, '-d', url.pathname.slice(1),
     '-tAc', 'SELECT id FROM instructors ORDER BY created_at LIMIT 1'],
    { env: { ...process.env, PGPASSWORD: url.password }, encoding: 'utf8' }
  ).trim();
}

const errors = [];
const browser = await chromium.launch({ args: ['--no-sandbox'] });
// SWAG_VIEWPORT=1920x1080 matches the demo-video filming spec; default unchanged.
const [vpW, vpH] = (process.env.SWAG_VIEWPORT || '1600x1000').split('x').map(Number);
const ctx = await browser.newContext({ viewport: { width: vpW, height: vpH } });
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 300)}`));
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));

const say = (...a) => console.log(...a);
const body = () => page.locator('body').innerText();

/** Click, but survive the dev server still hydrating the page. A click that
 * lands before React attaches is swallowed with no error — so retry until the
 * page reacts, or 20s passes. `after` is a locator that must appear. */
async function stubbornClick(locator, after) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    await locator.first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
    if (!after) return true;
    if (await after.count()) return true;
    if (Date.now() > deadline) return false;
  }
}

async function run(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  const arg = line.trim().slice(cmd.length).trim();
  switch (cmd) {
    case '':
    case '#':
      return;
    case 'as': {
      const id = arg === 'instructor' ? firstInstructorId() : arg;
      await ctx.addCookies([
        { name: 'user_session', value: id, domain: 'localhost', path: '/' },
      ]);
      say(`  as ${id}`);
      return;
    }
    case 'nav': {
      // 'load', not 'domcontentloaded': the client bundle is what makes the
      // page interactive, and in dev it arrives well after the HTML.
      await page.goto(arg.startsWith('http') ? arg : BASE + arg, {
        waitUntil: 'load',
        timeout: 180_000,
      });
      say(`  nav ${arg}`);
      return;
    }
    case 'wait': {
      // A bare word is text; `sel:<css>` is a selector. Text is the common case
      // and CSS-looking text (a slash, an `=`) used to be handed to the parser
      // as a selector and blow up mid-script.
      const sel = arg.startsWith('sel:') ? arg.slice(4) : `text=${arg}`;
      await page.waitForSelector(sel, { timeout: 180_000 });
      say(`  wait ok: ${arg}`);
      return;
    }
    case 'sleep':
      await page.waitForTimeout(Number(arg) || 1000);
      return;
    case 'click': {
      const ok = await stubbornClick(page.getByRole('button', { name: new RegExp(arg, 'i') }));
      say(`  click ${arg}: ${ok ? 'ok' : 'FAILED'}`);
      return;
    }
    case 'click-text': {
      const ok = await stubbornClick(page.getByText(arg, { exact: true }));
      say(`  click-text ${arg}: ${ok ? 'ok' : 'FAILED'}`);
      return;
    }
    case 'click-until': {
      // `click-until <text> :: <expected>` — click, and keep clicking until
      // <expected> shows up. The hydration-proof way to enter a view.
      const [target, expected] = arg.split('::').map((s) => s.trim());
      const ok = await stubbornClick(
        page.getByText(target, { exact: true }),
        page.getByText(new RegExp(expected, 'i'))
      );
      say(`  click-until ${target} :: ${expected}: ${ok ? 'ok' : 'FAILED'}`);
      return;
    }
    case 'fill': {
      const [sel, ...v] = rest;
      await page.locator(sel).first().fill(v.join(' '));
      say(`  fill ${sel}`);
      return;
    }
    case 'count':
      say(`  count ${arg}: ${await page.locator(arg).count()}`);
      return;
    case 'grep': {
      const re = new RegExp(arg, 'i');
      const hit = (await body()).split('\n').filter((l) => re.test(l)).slice(0, 8);
      say(hit.length ? hit.map((l) => `  > ${l.trim().slice(0, 140)}`).join('\n') : `  (no match: ${arg})`);
      return;
    }
    case 'text':
      say((await body()).split('\n').filter(Boolean).slice(0, 60).map((l) => `  | ${l}`).join('\n'));
      return;
    case 'buttons':
      say(
        (await page.getByRole('button').allTextContents())
          .map((t) => t.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 40)
          .map((t) => `  · ${t}`)
          .join('\n')
      );
      return;
    case 'eval':
      say('  ' + JSON.stringify(await page.evaluate(arg)));
      return;
    case 'shot': {
      const name = arg || `shot-${Date.now()}`;
      await page.screenshot({ path: `${OUT}/${name}.png` });
      say(`  shot ${OUT}/${name}.png`);
      return;
    }
    case 'errors':
      say(errors.length ? errors.map((e) => `  ! ${e}`).join('\n') : '  errors: none');
      return;
    case 'quit':
      return 'quit';
    default:
      say(`  ?? unknown command: ${cmd}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
for await (const line of rl) {
  try {
    if ((await run(line)) === 'quit') break;
  } catch (e) {
    say(`  ERROR on "${line.trim()}": ${String(e).split('\n')[0]}`);
    await page.screenshot({ path: `${OUT}/error.png` }).catch(() => {});
  }
}
await browser.close();
