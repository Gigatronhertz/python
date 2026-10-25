// Pyodide lives in this worker so that blocking on stdin never freezes the UI.
import {
  IDX_STATE, IDX_LEN, IDX_COLS, IDX_ROWS,
  STATE_WAITING, STATE_READY, STATE_EOF, STATE_INTERRUPT,
  SIGINT,
} from './protocol.js';
import PYGAME_SHIM from './pygame_shim.py?raw';

let pyodide = null;
let ctrl = null;
let data = null;
let interrupt = null;
let interruptedAtPrompt = false;
let eventLen = null;
let eventData = null;
let pygameReady = false;

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
  // Once interrupted, keep answering EOF locally. CPython's readline retries
  // the read while a signal is pending, and each retry would otherwise park us
  // on a fresh prompt the user never asked for.
  if (interruptedAtPrompt) return null;

  Atomics.store(ctrl, IDX_STATE, STATE_WAITING);
  post({ type: 'stdin-request' });
  Atomics.wait(ctrl, IDX_STATE, STATE_WAITING);

  const state = Atomics.load(ctrl, IDX_STATE);
  if (state === STATE_INTERRUPT) {
    interruptedAtPrompt = true;
    if (interrupt) interrupt[0] = SIGINT;
    // Raise KeyboardInterrupt from inside the read itself. Returning EOF here
    // instead would surface as EOFError, with the signal landing later —
    // usually midway through printing that unwanted traceback.
    pyodide.checkInterrupt();
    return null; // unreachable unless the signal was already consumed
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

/**
 * The JS side of src/pygame_shim.py, importable from Python as
 * `_pyweb_bridge`. Frames go out by postMessage; input comes in through the
 * shared event mailbox, so a game loop that never yields still gets it.
 */
const pygameBridge = {
  present(width, height, pixels) {
    // `pixels` is a borrowed proxy of a Python bytes object; copy it out of
    // the wasm heap before the call returns.
    const view = pixels.getBuffer('u8');
    const copy = new Uint8ClampedArray(view.data);
    view.release();
    post({ type: 'frame', width, height, pixels: copy }, [copy.buffer]);
  },
  take_events() {
    if (!eventLen) return null;
    const len = Atomics.load(eventLen, 0);
    if (len === 0) return null;
    const text = decoder.decode(eventData.slice(0, len));
    Atomics.store(eventLen, 0, 0);
    return text;
  },
  send(kind, json) {
    post({ type: 'pygame', kind, ...JSON.parse(json) });
  },
};

/** Load pygame-ce the first time a program imports it. */
async function ensurePygame(code) {
  if (pygameReady) return;
  const imports = pyodide.pyimport('pyodide.code').find_imports(code);
  const wanted = imports.toJs().includes('pygame');
  imports.destroy();
  if (!wanted) return;

  post({ type: 'notice', text: 'Loading pygame…' });
  await pyodide.loadPackage('pygame-ce', { messageCallback: () => {} });
  pyodide.FS.mkdirTree('/pyweb');
  pyodide.FS.writeFile('/pyweb/pyweb_pygame.py', PYGAME_SHIM);
  pyodide.runPython('import sys; sys.path.append("/pyweb"); import pyweb_pygame');
  pygameReady = true;
}

/**
 * User code runs inside this Python driver rather than through runPythonAsync
 * directly, for two reasons:
 *
 *  - KeyboardInterrupt is a BaseException, so it slips past Pyodide's event
 *    loop without ever settling the promise JS is awaiting. Catching it in
 *    Python keeps every outcome on one path.
 *  - Compiling with filename "main.py" and dropping this frame from the
 *    traceback makes errors read exactly like `python main.py` would.
 */
const DRIVER = `
import ast, inspect, sys, traceback

sys.argv = ["main.py"]
sys.setrecursionlimit(2000)


async def __pyweb_run(src):
    ns = {"__name__": "__main__", "__doc__": None, "__package__": None}
    game = sys.modules.get("pyweb_pygame")
    if game is not None:
        game.reset()
    try:
        code = compile(src, "main.py", "exec",
                       flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
        result = eval(code, ns)
        if inspect.isawaitable(result):
            await result
    except SystemExit:
        return "ok"
    except KeyboardInterrupt:
        print("\\nKeyboardInterrupt", file=sys.stderr)
        return "interrupted"
    except BaseException as exc:
        try:
            tb = exc.__traceback__
            # Skip this driver's own frame so only the user's program shows.
            tb = tb.tb_next if tb is not None else None
            traceback.print_exception(type(exc), exc, tb, file=sys.stderr)
        except KeyboardInterrupt:
            # Stop pressed while the traceback was still printing.
            print("\\nKeyboardInterrupt", file=sys.stderr)
            return "interrupted"
        return "error"
    finally:
        if game is not None:
            try:
                game.finish()
            except BaseException:
                pass
        sys.stdout.flush()
        sys.stderr.flush()
    return "ok"
`;

async function init(buffers) {
  ctrl = buffers.ctrl ?? null;
  data = buffers.data ?? null;
  interrupt = buffers.interrupt ?? null;
  eventLen = buffers.eventLen ?? null;
  eventData = buffers.eventData ?? null;

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
  pyodide.registerJsModule('_pyweb_bridge', pygameBridge);

  pyodide.runPython(DRIVER);
  post({ type: 'ready', version: pyodide.version });
}

async function run(code) {
  interruptedAtPrompt = false;
  if (interrupt) interrupt[0] = 0;

  let runner = null;
  try {
    await ensurePygame(code);
    runner = pyodide.globals.get('__pyweb_run');
    // The driver reports its own outcome and prints its own traceback, so the
    // only errors reaching this catch are interpreter-level failures.
    const status = await runner(code);
    post({ type: 'done', status: interruptedAtPrompt ? 'interrupted' : status });
  } catch (err) {
    post({ type: 'output', stream: 'stderr', text: `${err?.message ?? err}\n` });
    post({ type: 'done', status: 'error' });
  } finally {
    runner?.destroy();
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
