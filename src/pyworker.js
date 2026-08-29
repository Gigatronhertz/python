// Pyodide lives in this worker so that blocking on stdin never freezes the UI.
import {
  IDX_STATE, IDX_LEN, IDX_COLS, IDX_ROWS,
  STATE_WAITING, STATE_READY, STATE_EOF, STATE_INTERRUPT,
  SIGINT,
} from './protocol.js';

let pyodide = null;
let ctrl = null;
let data = null;
let interrupt = null;
let interruptedAtPrompt = false;

const decoder = new TextDecoder('utf-8');
const post = (msg, transfer) => self.postMessage(msg, transfer || []);

/**
 * Called by CPython whenever it needs more stdin. Parks the whole worker
 * thread until the main thread pushes a line in, so `name = input()` behaves
 * exactly like it does in a real terminal.
 */
function readStdin() {
  if (!ctrl) {
    throw new Error(
      'input() is unavailable: this browser did not grant SharedArrayBuffer. ' +
        'Reload the page, or open it over https.',
    );
  }
  Atomics.store(ctrl, IDX_STATE, STATE_WAITING);
  post({ type: 'stdin-request' });
  Atomics.wait(ctrl, IDX_STATE, STATE_WAITING);

  const state = Atomics.load(ctrl, IDX_STATE);
  if (state === STATE_INTERRUPT) {
    interruptedAtPrompt = true;
    if (interrupt) interrupt[0] = SIGINT;
    return null; // unblocks CPython; the pending SIGINT raises KeyboardInterrupt
  }
  if (state === STATE_EOF) return null;

  const len = Atomics.load(ctrl, IDX_LEN);
  return decoder.decode(data.slice(0, len));
}

function terminalSize() {
  if (!ctrl) return { rows: 24, columns: 80 };
  return {
    rows: Atomics.load(ctrl, IDX_ROWS) || 24,
    columns: Atomics.load(ctrl, IDX_COLS) || 80,
  };
}

function makeWriter(stream) {
  return {
    // isatty makes CPython line-buffer instead of block-buffer, so prints
    // inside a long loop show up immediately rather than at the very end.
    isatty: true,
    getTerminalSize: terminalSize,
    write(buffer) {
      post({ type: 'output', stream, bytes: buffer.slice() });
      return buffer.length;
    },
  };
}

async function init(buffers) {
  ctrl = buffers.ctrl ?? null;
  data = buffers.data ?? null;
  interrupt = buffers.interrupt ?? null;

  // Loaded at runtime from /pyodide/ (public dir) rather than bundled, so the
  // 9 MB wasm stays a separate, cacheable asset.
  const { loadPyodide } = await import(/* @vite-ignore */ '/pyodide/pyodide.mjs');
  pyodide = await loadPyodide({
    indexURL: '/pyodide/',
    stdin: readStdin,
  });

  // autoEOF terminates each returned line, which is what lets a tty read()
  // complete; without it CPython keeps asking for more characters forever.
  pyodide.setStdin({ stdin: readStdin, isatty: true, autoEOF: true });
  pyodide.setStdout(makeWriter('stdout'));
  pyodide.setStderr(makeWriter('stderr'));
  if (interrupt) pyodide.setInterruptBuffer(interrupt);

  // Make the sandbox feel like a script run from a folder.
  pyodide.runPython(`
import sys
sys.argv = ["main.py"]
sys.setrecursionlimit(2000)
`);

  post({ type: 'ready', version: pyodide.version });
}

/** Rewrite Pyodide's internal frames out of a traceback so it reads like CPython. */
function cleanTraceback(text) {
  const lines = String(text).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Drop the Pyodide bootstrap frames the user never wrote.
    if (/File "\/lib\/python\d+\.\d+\/(site-packages\/)?_pyodide\//.test(line)) {
      i++; // also skip the source line that follows
      continue;
    }
    if (/File "\/lib\/python\d+\.\d+\/asyncio\//.test(line)) {
      i++;
      continue;
    }
    out.push(line.replace(/File "<exec>"/g, 'File "main.py"'));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function run(code) {
  interruptedAtPrompt = false;
  if (interrupt) interrupt[0] = 0;

  // A fresh namespace per run, so one execution never leaks state into the next.
  const globals = pyodide.runPython(
    'dict(__name__="__main__", __doc__=None, __package__=None)',
  );
  try {
    await pyodide.runPythonAsync(code, { globals, filename: '<exec>' });
    post({ type: 'done', status: 'ok' });
  } catch (err) {
    const isInterrupt =
      interruptedAtPrompt ||
      err?.type === 'KeyboardInterrupt' ||
      /KeyboardInterrupt/.test(err?.message ?? '');
    if (isInterrupt) {
      post({ type: 'output', stream: 'stderr', text: '\nKeyboardInterrupt\n' });
      post({ type: 'done', status: 'interrupted' });
    } else {
      post({ type: 'output', stream: 'stderr', text: cleanTraceback(err?.message ?? err) + '\n' });
      post({ type: 'done', status: 'error' });
    }
  } finally {
    globals.destroy();
    if (interrupt) interrupt[0] = 0;
  }
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') await init(msg);
    else if (msg.type === 'run') await run(msg.code);
  } catch (err) {
    post({ type: 'fatal', message: String(err?.message ?? err) });
  }
};
