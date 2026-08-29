import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const PROMPT_HISTORY_MAX = 100;

/**
 * An xterm.js console that doubles as the input line. Program output and the
 * text the user types share one buffer, so an input() prompt is answered right
 * where it was printed — the way a real terminal works.
 */
export class Console {
  constructor(container) {
    this.term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: {
        background: '#0b0f14',
        foreground: '#d6deeb',
        cursor: '#7dd3fc',
        selectionBackground: '#1f3a5f',
        black: '#0b0f14', red: '#ff6b6b', green: '#5ddc9a', yellow: '#f7c66b',
        blue: '#7aa2f7', magenta: '#c792ea', cyan: '#7dd3fc', white: '#d6deeb',
        brightBlack: '#5a6b7d', brightRed: '#ff8787', brightGreen: '#7ff0b3',
        brightYellow: '#ffd88a', brightBlue: '#9ec1ff', brightMagenta: '#e0aaff',
        brightCyan: '#a5e9ff', brightWhite: '#ffffff',
      },
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(container);
    this.fit.fit();

    this.reading = false;
    this.buffer = '';
    this.cursor = 0; // offset within buffer
    this.history = [];
    this.historyIndex = 0;
    this.resolve = null;
    this.onInterrupt = () => {};

    this.term.onData((d) => this.handleData(d));
    new ResizeObserver(() => this.refit()).observe(container);
  }

  refit() {
    try {
      this.fit.fit();
    } catch {
      /* container not laid out yet */
    }
  }

  get cols() { return this.term.cols; }
  get rows() { return this.term.rows; }

  write(text) { this.term.write(text); }
  writeln(text) { this.term.write(text + '\r\n'); }
  clear() { this.term.clear(); this.term.write('\x1b[2J\x1b[H'); }
  focus() { this.term.focus(); }

  info(text) { this.term.write(`\x1b[38;5;245m${text}\x1b[0m\r\n`); }
  success(text) { this.term.write(`\x1b[32m${text}\x1b[0m\r\n`); }
  error(text) { this.term.write(`\x1b[31m${text}\x1b[0m\r\n`); }

  /** Resolves with the typed line (no trailing newline), or null on Ctrl+D. */
  readLine() {
    this.reading = true;
    this.buffer = '';
    this.cursor = 0;
    this.historyIndex = this.history.length;
    this.focus();
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  cancelRead() {
    if (!this.reading) return;
    this.reading = false;
    const done = this.resolve;
    this.resolve = null;
    this.buffer = '';
    done?.(undefined); // undefined => interrupted, distinct from null (EOF)
  }

  finishRead(value) {
    this.reading = false;
    const done = this.resolve;
    this.resolve = null;
    if (value) {
      if (this.history[this.history.length - 1] !== value) this.history.push(value);
      if (this.history.length > PROMPT_HISTORY_MAX) this.history.shift();
    }
    done?.(value);
  }

  handleData(chunk) {
    if (!this.reading) {
      // Ctrl+C outside of a read still interrupts the running program.
      if (chunk.includes('\x03')) this.onInterrupt();
      return;
    }

    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];

      // Escape sequences arrive inside the same chunk; consume them whole so
      // their bytes never land in the input buffer.
      if (ch === '\x1b') {
        const match = /^\x1b(\[[0-9;]*[A-Za-z~]|O[A-Za-z])/.exec(chunk.slice(i));
        if (match) {
          this.handleEscape(match[0]);
          i += match[0].length - 1;
        }
        continue;
      }

      if (ch === '\r' || ch === '\n') {
        this.term.write('\r\n');
        this.finishRead(this.buffer);
        return;
      }
      if (ch === '\x03') { // Ctrl+C
        this.term.write('^C\r\n');
        this.onInterrupt();
        return;
      }
      if (ch === '\x04') { // Ctrl+D on an empty line closes stdin
        if (this.buffer.length === 0) {
          this.term.write('\r\n');
          this.finishRead(null);
          return;
        }
        continue;
      }
      if (ch === '\x7f' || ch === '\b') { // Backspace
        if (this.cursor > 0) {
          this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
          this.cursor--;
          this.reprintTail(true);
        }
        continue;
      }
      if (ch === '\x15') { // Ctrl+U — clear the line
        this.moveTo(0);
        this.term.write('\x1b[K');
        this.buffer = '';
        continue;
      }
      if (ch === '\x01') { this.moveTo(0); continue; } // Ctrl+A
      if (ch === '\x05') { this.moveTo(this.buffer.length); continue; } // Ctrl+E
      if (ch.charCodeAt(0) < 32) continue;

      this.buffer = this.buffer.slice(0, this.cursor) + ch + this.buffer.slice(this.cursor);
      this.cursor++;
      this.reprintTail(false, ch);
    }
  }

  handleEscape(seq) {
    switch (seq) {
      case '\x1b[D': case '\x1bOD':
        if (this.cursor > 0) { this.cursor--; this.term.write('\x1b[D'); }
        break;
      case '\x1b[C': case '\x1bOC':
        if (this.cursor < this.buffer.length) { this.cursor++; this.term.write('\x1b[C'); }
        break;
      case '\x1b[A': case '\x1bOA': this.recallHistory(-1); break;
      case '\x1b[B': case '\x1bOB': this.recallHistory(1); break;
      case '\x1b[H': case '\x1bOH': case '\x1b[1~': this.moveTo(0); break;
      case '\x1b[F': case '\x1bOF': case '\x1b[4~': this.moveTo(this.buffer.length); break;
      case '\x1b[3~': { // Delete
        if (this.cursor < this.buffer.length) {
          this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
          const tail = this.buffer.slice(this.cursor);
          this.term.write(tail + ' ');
          this.term.write(`\x1b[${tail.length + 1}D`);
        }
        break;
      }
      default:
        break;
    }
  }

  moveTo(index) {
    while (this.cursor > index) { this.cursor--; this.term.write('\x1b[D'); }
    while (this.cursor < index) { this.cursor++; this.term.write('\x1b[C'); }
  }

  /** Echo an insertion/deletion without repainting the program output above. */
  reprintTail(isDelete, inserted = '') {
    const tail = this.buffer.slice(this.cursor);
    if (isDelete) {
      this.term.write('\b' + tail + ' ');
      if (tail.length + 1 > 0) this.term.write(`\x1b[${tail.length + 1}D`);
    } else {
      this.term.write(inserted + tail);
      if (tail.length > 0) this.term.write(`\x1b[${tail.length}D`);
    }
  }

  recallHistory(direction) {
    if (this.history.length === 0) return;
    const next = Math.min(this.history.length, Math.max(0, this.historyIndex + direction));
    this.historyIndex = next;
    const value = next === this.history.length ? '' : this.history[next];
    this.moveTo(0);
    this.term.write('\x1b[K');
    this.buffer = value;
    this.cursor = value.length;
    this.term.write(value);
  }
}
