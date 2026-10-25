// End-to-end check of the parts that are hard to eyeball: cross-origin
// isolation, Pyodide booting in the worker, blocking input(), while loops,
// interrupting a runaway program, and pygame's window and input.
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:4173/';
const HEADED = process.argv.includes('--headed');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Everything currently rendered in the xterm buffer, as plain text. */
async function screenText(page) {
  return page.evaluate(() => {
    const NBSP = String.fromCharCode(160);
    const rows = document.querySelectorAll('.xterm-rows > div');
    return Array.from(rows)
      .map((r) => r.textContent.split(NBSP).join(' ').replace(/\s+$/, ''))
      .join('\n');
  });
}

async function waitForText(page, needle, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await screenText(page)).includes(needle)) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

// Set the document directly; typing Python in char-by-char would fight with
// auto-indent and bracket closing.
async function setCode(page, code) {
  await page.evaluate((src) => window.pyweb.editor.setCode(src), code);
}

async function typeLine(page, text) {
  await page.click('.xterm-screen');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

const browser = await chromium.launch({
  headless: !HEADED,
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  check('page loads', true);
  check('cross-origin isolated', await page.evaluate(() => window.crossOriginIsolated === true));
  check('SharedArrayBuffer available', await page.evaluate(() => typeof SharedArrayBuffer !== 'undefined'));
  check('Pyodide boots', await waitForText(page, 'Python ready'));

  // --- 1. print + a while loop -------------------------------------------
  await setCode(page, [
    'total = 0',
    'i = 1',
    'while i <= 5:',
    '    total += i',
    '    print("step", i)',
    '    i += 1',
    'print("total is", total)',
  ].join('\n'));
  await page.click('#run');
  check('while loop runs', await waitForText(page, 'total is 15'));
  check('loop printed every iteration', (await screenText(page)).includes('step 5'));

  // --- 2. blocking input() inline in the same terminal --------------------
  await setCode(page, [
    'name = input("Name: ")',
    'age = input("Age: ")',
    'print(f"Hello {name}, next year you are {int(age) + 1}")',
  ].join('\n'));
  await page.click('#run');

  check('prompt prints before input', await waitForText(page, 'Name:', 30000));
  await typeLine(page, 'Ada');
  check('second prompt appears', await waitForText(page, 'Age:', 30000));
  await typeLine(page, '35');
  check('input() returns typed text', await waitForText(page, 'Hello Ada, next year you are 36', 30000));

  const echoed = await screenText(page);
  check(
    'typing echoes on the prompt line',
    /Name: Ada/.test(echoed),
    echoed.split('\n').find((l) => l.includes('Name:')) ?? '',
  );
  check('run completes', await waitForText(page, 'finished', 20000));

  // --- 3. input() inside a while loop (the chatbot shape) -----------------
  await setCode(page, [
    'while True:',
    '    msg = input("say: ")',
    '    if msg == "bye":',
    '        print("done after loop")',
    '        break',
    '    print("echo:", msg.upper())',
  ].join('\n'));
  await page.click('#run');
  await waitForText(page, 'say:', 30000);
  await typeLine(page, 'hello');
  check('loop input round 1', await waitForText(page, 'echo: HELLO', 20000));
  await typeLine(page, 'again');
  check('loop input round 2', await waitForText(page, 'echo: AGAIN', 20000));
  await typeLine(page, 'bye');
  check('loop exits on break', await waitForText(page, 'done after loop', 20000));

  // --- 4. tracebacks ------------------------------------------------------
  await setCode(page, ['def boom():', '    return 1 / 0', '', 'boom()'].join('\n'));
  await page.click('#run');
  check('traceback reported', await waitForText(page, 'ZeroDivisionError', 20000));
  const tb = await screenText(page);
  check('traceback names main.py', tb.includes('main.py'));
  check('traceback hides pyodide internals', !tb.includes('_pyodide'));

  // --- 5. stopping an infinite loop ---------------------------------------
  await setCode(page, ['n = 0', 'while True:', '    n += 1'].join('\n'));
  await page.click('#run');
  await page.waitForTimeout(1200);
  await page.click('#stop');
  check('infinite loop interruptible', await waitForText(page, 'KeyboardInterrupt', 20000));

  // --- 6. interrupting a program parked on input() ------------------------
  await setCode(page, 'x = input("blocked: ")');
  await page.click('#run');
  await waitForText(page, 'blocked:', 20000);
  await page.click('#stop');
  check('interruptible while waiting on input', await waitForText(page, 'stopped', 20000));

  // --- 7. interpreter survives and stays usable ---------------------------
  await setCode(page, 'print("still alive:", sum(range(10)))');
  await page.click('#run');
  check('runs again after interrupt', await waitForText(page, 'still alive: 45', 30000));

  // --- 8. stdlib imports --------------------------------------------------
  await setCode(page, [
    'import math, random, json, datetime',
    'random.seed(1)',
    'print(json.dumps({"sqrt": round(math.sqrt(2), 4)}))',
    'print("date ok:", isinstance(datetime.date.today(), datetime.date))',
  ].join('\n'));
  await page.click('#run');
  check('stdlib imports work', await waitForText(page, '"sqrt": 1.4142', 30000));
  check('datetime works', (await screenText(page)).includes('date ok: True'));

  // --- 9. state does not leak between runs --------------------------------
  await setCode(page, 'print("leaked" if "name" in dir() else "clean namespace")');
  await page.click('#run');
  check('fresh namespace each run', await waitForText(page, 'clean namespace', 20000));

  // --- 10. editor: auto-indent -------------------------------------------
  await setCode(page, '');
  await page.click('.cm-content');
  await page.keyboard.type('for i in range(3):');
  await page.keyboard.press('Enter');
  await page.keyboard.type('print(i)');
  const indented = await page.evaluate(() => window.pyweb.editor.getCode());
  check('auto-indents after a colon', /\n {4}print\(i\)/.test(indented), JSON.stringify(indented));

  // "(" auto-closes and the typed ")" types over it, rather than doubling up.
  check(
    'closes brackets without doubling',
    indented.includes('print(i)') && !indented.includes('))'),
    JSON.stringify(indented),
  );

  // --- 11. editor: autocomplete -------------------------------------------
  await setCode(page, '');
  await page.click('.cm-content');
  await page.keyboard.type('ran');
  await page.waitForTimeout(600);
  const popupOpen = await page.locator('.cm-tooltip-autocomplete').isVisible().catch(() => false);
  check('autocomplete popup opens while typing', popupOpen);

  const optionText = popupOpen
    ? await page.locator('.cm-tooltip-autocomplete li').allTextContents()
    : [];
  check('suggests matching names', optionText.some((t) => t.includes('random')), optionText.slice(0, 5).join(', '));

  if (popupOpen) {
    await page.keyboard.press('Tab');
    const completed = await page.evaluate(() => window.pyweb.editor.getCode());
    // Whichever candidate ranked first, Tab should have finished the word
    // rather than inserting a tab character.
    check(
      'Tab accepts the completion',
      /^ran\w+$/.test(completed),
      JSON.stringify(completed),
    );
  } else {
    check('Tab accepts the completion', false, 'popup never opened');
  }

  // Member completion after a dot.
  await setCode(page, 'name = "ada"\nname.');
  await page.click('.cm-content');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('up');
  await page.waitForTimeout(600);
  const members = await page.locator('.cm-tooltip-autocomplete li').allTextContents().catch(() => []);
  check('suggests methods after a dot', members.some((t) => t.includes('upper')), members.slice(0, 5).join(', '));

  // --- 12. pygame: window, frames, keyboard, mouse, Stop ------------------
  await setCode(page, [
    'import pygame',
    'pygame.init()',
    'screen = pygame.display.set_mode((200, 100))',
    'x = 0',
    'clock = pygame.time.Clock()',
    'while True:',
    '    for e in pygame.event.get():',
    '        if e.type == pygame.MOUSEBUTTONDOWN:',
    '            print("clicked at", e.pos, "button", e.button)',
    '        if e.type == pygame.KEYDOWN and e.key == pygame.K_SPACE:',
    '            print("space pressed")',
    '    if pygame.key.get_pressed()[pygame.K_RIGHT]:',
    '        x += 2',
    '    screen.fill((0, 0, 0))',
    '    pygame.draw.rect(screen, (255, 0, 0), (x, 40, 10, 10))',
    '    pygame.display.flip()',
    '    clock.tick(60)',
  ].join('\n'));
  await page.click('#run');
  const opened = await page
    .waitForSelector('#screen:not([hidden])', { timeout: 60000 })
    .then(() => true, () => false);
  check('pygame window opens', opened);

  // Leftmost red pixel on the canvas, i.e. where the square is drawn.
  const squareX = () => page.evaluate(() => {
    const c = document.getElementById('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 0) return (i / 4) % c.width;
    }
    return -1;
  });
  await page.waitForTimeout(500);
  check('pygame frames reach the canvas', (await squareX()) === 0);

  await page.click('#canvas');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(200);
  const moved = await squareX();
  check('pygame.key.get_pressed sees held keys', moved > 10, `square at x=${moved}`);

  await page.keyboard.press('Space');
  check('pygame KEYDOWN events arrive', await waitForText(page, 'space pressed', 10000));

  const box = await page.locator('#canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  check('pygame mouse clicks map to pixels', await waitForText(page, 'clicked at (100, 50) button 1', 10000));

  await page.click('#stop');
  check('pygame loop stops', await waitForText(page, 'stopped', 20000));

  check('no uncaught page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('harness completed', false, String(err && err.message));
} finally {
  if (HEADED) await page.waitForTimeout(3000);
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
