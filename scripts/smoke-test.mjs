// End-to-end check of the parts that are hard to eyeball: cross-origin
// isolation, Pyodide booting in the worker, blocking input(), while loops,
// and interrupting a runaway program.
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
    const rows = document.querySelectorAll('.xterm-rows > div');
    return Array.from(rows).map((r) => r.textContent.replace(/ /g, ' ').trimEnd()).join('\n');
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

async function setCode(page, code) {
  // Set the document directly; typing Python in char-by-char would fight with
  // auto-indent and bracket closing.
  await page.evaluate((src) => window.pyweb.editor.setCode(src), code);
}

const browser = await chromium.launch({ headless: !HEADED });
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  check('page loads', true);
  check('cross-origin isolated', await page.evaluate(() => window.crossOriginIsolated === true));
  check('SharedArrayBuffer available', await page.evaluate(() => typeof SharedArrayBuffer !== 'undefined'));

  check('Pyodide boots', await waitForText(page, 'Python ready'), 'waited for banner');

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
  check('while loop runs', await waitForText(page, 'total is 15'), 'expected total is 15');

  // --- 2. blocking input() inline in the same terminal --------------------
  await setCode(page, [
    'name = input("Name: ")',
    'age = input("Age: ")',
    'print(f"Hello {name}, next year you are {int(age) + 1}")',
  ].join('\n'));
  await page.click('#run');

  check('prompt is printed before input', await waitForText(page, 'Name: ', 30000));
  await page.click('.xterm-screen');
  await page.keyboard.type('Ada');
  await page.keyboard.press('Enter');

  check('second prompt appears', await waitForText(page, 'Age: ', 30000));
  await page.keyboard.type('35');
  await page.keyboard.press('Enter');

  check('input() returns typed text', await waitForText(page, 'Hello Ada, next year you are 36', 30000));

  const echoed = await screenText(page);
  check('typed text echoes on the prompt line', /Name: Ada/.test(echoed), echoed.split('\n').find((l) => l.includes('Name:')) ?? '');

  // --- 3. input() inside a while loop (the chatbot shape) -----------------
  await setCode(page, [
    'while True:',
    '    msg = input("> ")',
    '    if msg == "bye":',
    '        print("done after loop")',
    '        break',
    '    print("echo:", msg.upper())',
  ].join('\n'));
  await page.click('#run');
  await waitForText(page, '> ', 30000);
  await page.click('.xterm-screen');
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  check('loop input round 1', await waitForText(page, 'echo: HELLO', 20000));
  await page.keyboard.type('again');
  await page.keyboard.press('Enter');
  check('loop input round 2', await waitForText(page, 'echo: AGAIN', 20000));
  await page.keyboard.type('bye');
  await page.keyboard.press('Enter');
  check('loop exits on break', await waitForText(page, 'done after loop', 20000));

  // --- 4. tracebacks ------------------------------------------------------
  await setCode(page, ['def boom():', '    return 1 / 0', '', 'boom()'].join('\n'));
  await page.click('#run');
  check('traceback reported', await waitForText(page, 'ZeroDivisionError', 20000));
  const tb = await screenText(page);
  check('traceback names main.py', tb.includes('main.py'), 'file label rewritten');
  check('traceback hides pyodide internals', !tb.includes('_pyodide'));

  // --- 5. stopping an infinite loop ---------------------------------------
  await setCode(page, ['n = 0', 'while True:', '    n += 1'].join('\n'));
  await page.click('#run');
  await page.waitForTimeout(1200);
  await page.click('#stop');
  check('infinite loop interruptible', await waitForText(page, 'KeyboardInterrupt', 20000));

  // --- 6. interpreter survives and stays usable ---------------------------
  await setCode(page, 'print("still alive:", sum(range(10)))');
  await page.click('#run');
  check('runs again after interrupt', await waitForText(page, 'still alive: 45', 30000));

  // --- 7. stdlib imports --------------------------------------------------
  await setCode(page, [
    'import math, random, json, datetime',
    'random.seed(1)',
    'print(json.dumps({"sqrt": round(math.sqrt(2), 4)}))',
    'print("ok", isinstance(datetime.date.today(), datetime.date))',
  ].join('\n'));
  await page.click('#run');
  check('stdlib imports work', await waitForText(page, '"sqrt": 1.4142', 30000));

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
