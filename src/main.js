import '@xterm/xterm/css/xterm.css';
import './style.css';

import { Console } from './terminal.js';
import { createEditor } from './editor.js';
import { EXAMPLES, DEFAULT_CODE } from './examples.js';
import {
  createBuffers, sharedMemoryAvailable,
  IDX_STATE, IDX_LEN, IDX_COLS, IDX_ROWS,
  STATE_READY, STATE_EOF, STATE_INTERRUPT,
  DATA_BYTES, SIGINT,
} from './protocol.js';

const $ = (id) => document.getElementById(id);
const encoder = new TextEncoder();

const els = {
  editor: $('editor'),
  terminal: $('terminal'),
  run: $('run'),
  stop: $('stop'),
  clear: $('clear'),
  examples: $('examples'),
  status: $('status'),
  statusText: $('status-text'),
  version: $('version'),
  warning: $('warning'),
  splitter: $('splitter'),
  panes: $('panes'),
};

const STORAGE_KEY = 'pyweb:code';

const state = {
  worker: null,
  ready: false,
  running: false,
  buffers: sharedMemoryAvailable() ? createBuffers() : null,
  decoder: new TextDecoder('utf-8'),
  killTimer: null,
};

// ---------------------------------------------------------------- UI plumbing

const con = new Console(els.terminal);
const editor = createEditor({
  parent: els.editor,
  doc: loadCode(),
  onRun: () => run(),
});

function loadCode() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_CODE;
  } catch {
    return DEFAULT_CODE;
  }
}

function saveCode() {
  try {
    localStorage.setItem(STORAGE_KEY, editor.getCode());
  } catch {
    /* private mode — not worth surfacing */
  }
}

function setStatus(kind, text) {
  els.status.dataset.kind = kind;
  els.statusText.textContent = text;
}

function setRunning(running) {
  state.running = running;
  els.run.disabled = running || !state.ready;
  els.stop.disabled = !running;
  setStatus(running ? 'running' : 'idle', running ? 'Running' : 'Ready');
}

/** Keep the worker's view of the terminal size current for shutil.get_terminal_size(). */
function publishTerminalSize() {
  if (!state.buffers) return;
  Atomics.store(state.buffers.ctrl, IDX_COLS, con.cols || 80);
  Atomics.store(state.buffers.ctrl, IDX_ROWS, con.rows || 24);
}

// ------------------------------------------------------------------- the worker

function spawnWorker() {
  const worker = new Worker(new URL('./pyworker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (ev) => handleWorkerMessage(ev.data);
  worker.onerror = (ev) => {
    con.error(`Worker error: ${ev.message}`);
    setStatus('error', 'Crashed');
  };
  worker.postMessage({
    type: 'init',
    ctrl: state.buffers?.ctrl,
    data: state.buffers?.data,
    interrupt: state.buffers?.interrupt,
  });
  return worker;
}

function handleWorkerMessage(msg) {
  switch (msg.type) {
    case 'ready':
      state.ready = true;
      els.version.textContent = msg.version ? `Pyodide ${msg.version}` : '';
      con.success(`Python ready. Press Run, or Ctrl+Enter.`);
      con.writeln('');
      setRunning(false);
      break;

    case 'output': {
      const text = msg.text ?? state.decoder.decode(msg.bytes, { stream: true });
      con.write(msg.stream === 'stderr' ? `\x1b[31m${text}\x1b[0m` : text);
      break;
    }

    case 'stdin-request':
      promptForInput();
      break;

    case 'done':
      clearTimeout(state.killTimer);
      state.killTimer = null;
      con.cancelRead();
      state.decoder.decode(new Uint8Array(), { stream: false }); // flush decoder
      finishRun(msg.status);
      break;

    case 'fatal':
      con.error(`Fatal: ${msg.message}`);
      setRunning(false);
      break;

    default:
      break;
  }
}

function finishRun(status) {
  con.writeln('');
  if (status === 'ok') con.info('— finished —');
  else if (status === 'interrupted') con.info('— stopped —');
  else con.info('— finished with an error —');
  con.writeln('');
  setRunning(false);
  editor.setReadOnly(false);
  editor.focus();
}

// --------------------------------------------------------------- stdin bridge

/**
 * The worker is parked in Atomics.wait right now. Collect a line in the
 * terminal, drop it into the shared buffer and wake the worker back up.
 */
async function promptForInput() {
  const line = await con.readLine();
  if (!state.buffers) return;
  const { ctrl, data } = state.buffers;

  if (line === undefined) {
    // Interrupted at the prompt (Stop / Ctrl+C).
    Atomics.store(ctrl, IDX_LEN, 0);
    Atomics.store(ctrl, IDX_STATE, STATE_INTERRUPT);
  } else if (line === null) {
    // Ctrl+D — end of input.
    Atomics.store(ctrl, IDX_LEN, 0);
    Atomics.store(ctrl, IDX_STATE, STATE_EOF);
  } else {
    const bytes = encoder.encode(line + '\n');
    const len = Math.min(bytes.length, DATA_BYTES);
    data.set(bytes.subarray(0, len));
    Atomics.store(ctrl, IDX_LEN, len);
    Atomics.store(ctrl, IDX_STATE, STATE_READY);
  }
  Atomics.notify(ctrl, IDX_STATE);
}

// ------------------------------------------------------------------- commands

function run() {
  if (!state.ready || state.running) return;
  saveCode();
  con.clear();
  con.focus();
  state.decoder = new TextDecoder('utf-8');
  publishTerminalSize();
  if (state.buffers) state.buffers.interrupt[0] = 0;
  setRunning(true);
  state.worker.postMessage({ type: 'run', code: editor.getCode() });
}

function stop() {
  if (!state.running) return;
  setStatus('stopping', 'Stopping');

  if (state.buffers) {
    // Signals the interpreter between bytecodes; also unblocks a parked input().
    state.buffers.interrupt[0] = SIGINT;
    const { ctrl } = state.buffers;
    Atomics.store(ctrl, IDX_LEN, 0);
    Atomics.store(ctrl, IDX_STATE, STATE_INTERRUPT);
    Atomics.notify(ctrl, IDX_STATE);
    con.cancelRead();
  }

  // A tight loop that never yields to the signal check (or a build without
  // SharedArrayBuffer) needs the blunt instrument.
  clearTimeout(state.killTimer);
  state.killTimer = setTimeout(() => {
    con.error('\nProgram would not stop — restarting the interpreter.');
    restartWorker();
  }, 3000);
}

function restartWorker() {
  state.worker?.terminate();
  state.ready = false;
  con.cancelRead();
  setStatus('loading', 'Restarting');
  els.run.disabled = true;
  els.stop.disabled = true;
  state.worker = spawnWorker();
}

function clearTerminal() {
  con.clear();
  con.focus();
}

// -------------------------------------------------------------------- wiring

els.run.addEventListener('click', run);
els.stop.addEventListener('click', stop);
els.clear.addEventListener('click', clearTerminal);
con.onInterrupt = () => stop();

for (const ex of EXAMPLES) {
  const opt = document.createElement('option');
  opt.value = ex.id;
  opt.textContent = ex.name;
  els.examples.appendChild(opt);
}
els.examples.addEventListener('change', () => {
  const ex = EXAMPLES.find((e) => e.id === els.examples.value);
  if (!ex) return;
  editor.setCode(ex.code);
  saveCode();
  els.examples.selectedIndex = 0;
  editor.focus();
});

window.addEventListener('keydown', (ev) => {
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key === 'Enter') { ev.preventDefault(); run(); }
  else if (mod && ev.key.toLowerCase() === 's') { ev.preventDefault(); saveCode(); }
  else if (mod && ev.key.toLowerCase() === 'l' && !state.running) { ev.preventDefault(); clearTerminal(); }
});

window.addEventListener('resize', () => { con.refit(); publishTerminalSize(); });
setInterval(saveCode, 4000);

// Draggable split between editor and terminal.
(() => {
  let dragging = false;
  els.splitter.addEventListener('pointerdown', (ev) => {
    dragging = true;
    els.splitter.setPointerCapture(ev.pointerId);
    document.body.style.cursor = 'col-resize';
  });
  els.splitter.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const rect = els.panes.getBoundingClientRect();
    const vertical = window.matchMedia('(max-width: 860px)').matches;
    if (vertical) {
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      els.panes.style.gridTemplateRows = `${Math.min(85, Math.max(15, pct))}% 6px 1fr`;
    } else {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      els.panes.style.gridTemplateColumns = `${Math.min(85, Math.max(15, pct))}% 6px 1fr`;
    }
    con.refit();
  });
  const end = (ev) => {
    if (!dragging) return;
    dragging = false;
    els.splitter.releasePointerCapture?.(ev.pointerId);
    document.body.style.cursor = '';
    con.refit();
    publishTerminalSize();
  };
  els.splitter.addEventListener('pointerup', end);
  els.splitter.addEventListener('pointercancel', end);
})();

// ---------------------------------------------------------------------- boot

if (!state.buffers) {
  els.warning.hidden = false;
  els.warning.textContent =
    'This browser did not grant SharedArrayBuffer, so input() will not work. ' +
    'Open the site over https (or localhost) in Chrome, Edge or Firefox.';
}

// Handle for the smoke test (scripts/smoke-test.mjs) and for anyone who wants
// to drive the editor from the devtools console.
window.pyweb = { editor, console: con, run, stop, state };

setStatus('loading', 'Loading Python…');
els.run.disabled = true;
els.stop.disabled = true;
con.info('Booting CPython (WebAssembly)… first load fetches ~13 MB, then it is cached.');
publishTerminalSize();
state.worker = spawnWorker();
