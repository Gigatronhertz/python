import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));

const screen = () => page.evaluate(() => {
  const rows = document.querySelectorAll('.xterm-rows > div');
  return Array.from(rows).map((r) => r.textContent).join('\n').replace(/\n{2,}/g, '\n');
});
const ctrl = () => page.evaluate(() => {
  const b = window.pyweb.state.buffers;
  return b ? { state: Atomics.load(b.ctrl, 0), len: Atomics.load(b.ctrl, 1), running: window.pyweb.state.running, reading: window.pyweb.console.reading } : null;
});

await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });

// wait for boot
for (let i = 0; i < 200; i++) {
  if ((await screen()).includes('Python ready')) break;
  await page.waitForTimeout(200);
}
console.log('--- booted ---');

await page.evaluate(() => window.pyweb.editor.setCode('name = input("Name: ")\nprint("got", name)\n'));
await page.click('#run');
await page.waitForTimeout(3000);
console.log('SCREEN after run:\n' + (await screen()));
console.log('CTRL:', await ctrl());

await page.click('.xterm-screen');
await page.keyboard.type('Ada');
await page.waitForTimeout(300);
console.log('CTRL after typing:', await ctrl());
await page.keyboard.press('Enter');
await page.waitForTimeout(3000);
console.log('SCREEN after enter:\n' + (await screen()));
console.log('CTRL after enter:', await ctrl());

await browser.close();
