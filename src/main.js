import '@xterm/xterm/css/xterm.css';
import './style.css';

import { Console } from './terminal.js';
import { createEditor } from './editor.js';
import { EXAMPLES, DEFAULT_CODE } from './examples.js';
import {
  createBuffers, sharedMemoryAvailable,
  IDX_STATE, IDX_LEN, IDX_COLS, IDX_ROWS,
  STATE_READY, STATE_EOF, STATE_INTERRUPT,
  DATA_BYTES, EVENT_BYTES, SIGINT,
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
  screen: $('screen'),
  screenTitle: $('screen-title'),
  screenClose: $('screen-close'),
  canvas: $('canvas'),
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
    eventLen: state.buffers?.eventLen,
    eventData: state.buffers?.eventData,
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

    case 'notice':
      con.info(msg.text);
      break;

    case 'frame':
      drawFrame(msg);
      break;

    case 'pygame':
      handleGameMessage(msg);
      break;

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

// ------------------------------------------------------------- pygame window

// pygame runs in the worker against an in-memory screen (src/pygame_shim.py).
// Frames arrive here as RGBA pixels; keyboard and mouse events go back as
// JSON batches through the shared event mailbox (see protocol.js).

const game = {
  ctx: els.canvas.getContext('2d'),
  pending: [],
  flushScheduled: false,
};

function showScreen(show) {
  if (els.screen.hidden !== show) return;
  els.screen.hidden = !show;
  con.refit();
  publishTerminalSize();
}

function handleGameMessage(msg) {
  if (msg.kind === 'open') {
    els.canvas.width = msg.width;
    els.canvas.height = msg.height;
    game.ctx.fillStyle = '#000';
    game.ctx.fillRect(0, 0, msg.width, msg.height);
    els.screenTitle.textContent = msg.title;
    els.canvas.style.cursor = '';
    showScreen(true);
    els.canvas.focus();
  } else if (msg.kind === 'caption') {
    els.screenTitle.textContent = msg.title;
  } else if (msg.kind === 'cursor') {
    els.canvas.style.cursor = msg.visible ? '' : 'none';
  }
}

function drawFrame({ width, height, pixels }) {
  if (els.canvas.width !== width || els.canvas.height !== height) {
    els.canvas.width = width;
    els.canvas.height = height;
  }
  game.ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
}

/** Hand queued events to the worker once it has taken the previous batch. */
function flushGameEvents() {
  game.flushScheduled = false;
  if (!state.buffers || !game.pending.length) return;
  const { eventLen, eventData } = state.buffers;
  if (Atomics.load(eventLen, 0) !== 0) {
    // The game hasn't pumped its events yet; try again next frame.
    scheduleFlush();
    return;
  }
  let bytes = encoder.encode(JSON.stringify(game.pending));
  if (bytes.length > EVENT_BYTES) bytes = encoder.encode(JSON.stringify(game.pending.slice(-200)));
  game.pending = [];
  eventData.set(bytes);
  Atomics.store(eventLen, 0, bytes.length);
}

function scheduleFlush() {
  if (game.flushScheduled) return;
  game.flushScheduled = true;
  requestAnimationFrame(flushGameEvents);
}

function queueGameEvent(ev) {
  if (!state.running || els.screen.hidden) return;
  const last = game.pending[game.pending.length - 1];
  // Coalesce mouse motion; the game only needs where the pointer ended up.
  if (ev.t === 'mm' && last?.t === 'mm') game.pending[game.pending.length - 1] = ev;
  else game.pending.push(ev);
  flushGameEvents();
}

/** Page coordinates -> pygame surface pixels, undoing object-fit: contain. */
function canvasPoint(ev) {
  const rect = els.canvas.getBoundingClientRect();
  const { width, height } = els.canvas;
  const scale = Math.min(rect.width / width, rect.height / height);
  const x = (ev.clientX - rect.left - (rect.width - width * scale) / 2) / scale;
  const y = (ev.clientY - rect.top - (rect.height - height * scale) / 2) / scale;
  return {
    x: Math.max(0, Math.min(width - 1, Math.floor(x))),
    y: Math.max(0, Math.min(height - 1, Math.floor(y))),
  };
}

function resetGame() {
  game.pending = [];
  if (state.buffers) Atomics.store(state.buffers.eventLen, 0, 0);
  showScreen(false);
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
  resetGame();
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

els.canvas.addEventListener('keydown', (ev) => {
  // Leave browser and app shortcuts (Ctrl+Enter, Ctrl+R, …) alone.
  if (ev.ctrlKey || ev.metaKey) return;
  ev.preventDefault();
  queueGameEvent({ t: 'kd', code: ev.code, key: ev.key, rep: ev.repeat });
});
els.canvas.addEventListener('keyup', (ev) => {
  ev.preventDefault();
  queueGameEvent({ t: 'ku', code: ev.code, key: ev.key });
});
els.canvas.addEventListener('pointermove', (ev) => queueGameEvent({ t: 'mm', ...canvasPoint(ev) }));
els.canvas.addEventListener('pointerdown', (ev) => {
  els.canvas.focus();
  els.canvas.setPointerCapture(ev.pointerId);
  queueGameEvent({ t: 'md', b: ev.button, ...canvasPoint(ev) });
});
els.canvas.addEventListener('pointerup', (ev) => queueGameEvent({ t: 'mu', b: ev.button, ...canvasPoint(ev) }));
els.canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  queueGameEvent({ t: 'wh', dx: ev.deltaX, dy: ev.deltaY });
}, { passive: false });
els.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
els.canvas.addEventListener('blur', () => queueGameEvent({ t: 'blur' }));
els.screenClose.addEventListener('click', () => {
  if (state.running) queueGameEvent({ t: 'quit' });
  else showScreen(false);
});

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
