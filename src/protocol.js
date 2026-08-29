// Shared layout for the SharedArrayBuffer used to hand stdin to the worker.
//
// The worker runs Python synchronously, so when input() is called it must
// *block* until the user presses Enter. It does that with Atomics.wait on the
// control array, which the main thread wakes with Atomics.notify once a line
// has been typed into the terminal. This is the only way to get real, blocking
// input() semantics in a browser.

export const CTRL_LENGTH = 4; // Int32 slots
export const IDX_STATE = 0;
export const IDX_LEN = 1;
export const IDX_COLS = 2;
export const IDX_ROWS = 3;

export const STATE_WAITING = 0; // worker is parked, waiting for a line
export const STATE_READY = 1; // a line is in the data buffer
export const STATE_EOF = 2; // stdin closed (Ctrl+D)
export const STATE_INTERRUPT = 3; // user hit Stop / Ctrl+C while at the prompt

export const DATA_BYTES = 1 << 16; // 64 KiB max per input line

// Values Python's signal machinery understands via the interrupt buffer.
export const SIGINT = 2;

export function createBuffers() {
  return {
    ctrl: new Int32Array(new SharedArrayBuffer(CTRL_LENGTH * 4)),
    data: new Uint8Array(new SharedArrayBuffer(DATA_BYTES)),
    interrupt: new Uint8Array(new SharedArrayBuffer(1)),
  };
}

export function sharedMemoryAvailable() {
  return typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true;
}
