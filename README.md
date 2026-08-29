# PyWeb — a real Python interpreter in the browser

CPython 3.14, compiled to WebAssembly, running entirely on the front end. No
server, no accounts, no code ever leaving the device. Open the page, write
Python, press Run.

The point of difference is **interactive `input()`**: prompts and answers share
one terminal, so a `while True:` chatbot behaves exactly as it would in a real
console.

```python
name = input("What's your name? ")     # typed in the same terminal
while True:
    msg = input(f"{name}: ")           # the loop keeps going
    if msg == "bye":
        break
    print("Bot:", msg.upper())
```

## Features

- **Real CPython** — the standard library is all there: `math`, `random`,
  `json`, `re`, `datetime`, `itertools`, `collections`, `dataclasses`, …
- **Blocking `input()`** in the same terminal as the output, with line editing,
  history (↑/↓), `Home`/`End`, `Ctrl+U` and `Ctrl+D`.
- **While loops and long-running programs** — output streams out as it happens
  rather than arriving all at once when the program ends.
- **Stop actually stops.** `Ctrl+C` in the terminal, or the Stop button, raises
  `KeyboardInterrupt` — even from an infinite loop, even while sitting at a
  prompt.
- **Autocomplete** for keywords, builtins, exceptions, modules, names defined in
  your own file, and methods after a `.` (`"text".up` → `upper`).
- **Auto-indent** after `:`, bracket/quote closing, bracket matching, syntax
  highlighting, code folding, and `Tab`/`Shift+Tab` indentation.
- **Clean tracebacks** that point at `main.py` and your line numbers, with none
  of the interpreter's own plumbing.
- Your code is kept in `localStorage`, so a refresh does not lose it.

### Shortcuts

| Key | Action |
| --- | --- |
| `Ctrl`/`Cmd` + `Enter` | Run |
| `Ctrl` + `C` (in terminal) | Interrupt |
| `Ctrl` + `L` | Clear terminal |
| `Ctrl` + `Space` | Force autocomplete |
| `Tab` / `Shift` + `Tab` | Accept completion, or indent / outdent |

## How it works

```
main thread                          worker thread
-----------                          -------------
CodeMirror editor
xterm.js terminal   ──postMessage──▶ Pyodide (CPython + WASM)
      │                                    │
      │ ◀────── stdout / stderr chunks ────┤
      │                                    │
      │         input() called ────────────┤ parks on Atomics.wait
      └─ user types a line ───────────────▶│ SharedArrayBuffer + Atomics.notify
```

Python runs in a Web Worker so a busy loop never freezes the page. When
`input()` is called the worker **blocks** on `Atomics.wait` while the main
thread collects a line in the terminal, writes it into a `SharedArrayBuffer`
and wakes the worker back up. That is what makes `input()` behave like the real
thing instead of returning a promise.

Two consequences worth knowing:

- `SharedArrayBuffer` requires the page to be **cross-origin isolated**, so the
  app sends `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` (see `vercel.json`).
- Because `require-corp` blocks CDN assets, Pyodide is **self-hosted**:
  `scripts/copy-pyodide.mjs` copies the runtime out of `node_modules` into
  `public/pyodide/` at build time.

Interrupts use Pyodide's interrupt buffer, so `KeyboardInterrupt` is raised by
CPython itself between bytecodes. User code runs inside a small Python driver
(`DRIVER` in `src/pyworker.js`) which catches `BaseException` — without it,
`KeyboardInterrupt` slips past Pyodide's event loop and the run never settles.

## Running locally

```bash
npm install         # also copies Pyodide into public/
npm run dev         # http://localhost:5173
```

`npm run dev` and `npm run preview` set the isolation headers themselves; a
plain static file server will not, and `input()` will not work without them.

### Tests

An end-to-end suite drives a real browser and checks the things that are easy to
break: isolation headers, blocking input, loops, interrupts, tracebacks.

```bash
npm run build
npm run preview &     # serves on :4173
npm test              # add -- --headed to watch it
```

## Deploying

Vercel, as a static site — `vercel.json` already carries the build config and
the isolation headers.

```bash
npx vercel --prod
```

Or import the repo at [vercel.com/new](https://vercel.com/new); the defaults in
`vercel.json` are picked up automatically. Any host works as long as it can set
those two headers on every response.

## Layout

| File | Role |
| --- | --- |
| `src/pyworker.js` | Pyodide, stdin/stdout wiring, the Python driver |
| `src/protocol.js` | SharedArrayBuffer layout shared by both threads |
| `src/terminal.js` | xterm.js console and its line editor |
| `src/editor.js` | CodeMirror 6: highlighting, indent, completion |
| `src/completions.js` | Completion tables |
| `src/main.js` | Wires it together: run, stop, stdin bridge, layout |
| `scripts/copy-pyodide.mjs` | Vendors the Pyodide runtime into `public/` |
| `scripts/smoke-test.mjs` | Browser end-to-end suite |

## Limits

- Third-party packages (numpy, pandas) are not bundled. The isolation headers
  block loading them from a CDN at runtime; they would need vendoring too.
- No filesystem persistence between runs — each run starts in a fresh
  namespace.
- Needs a browser with `SharedArrayBuffer`: Chrome, Edge, Firefox, Safari 15.2+.
