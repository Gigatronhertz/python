"""Makes pygame-ce work inside the PyWeb worker.

pygame-ce in Pyodide draws through SDL's emscripten video driver, which needs
a DOM canvas, and the worker has none. So the display, event, key and mouse
modules are replaced with versions that:

  * keep the screen as an ordinary in-memory Surface, and send its pixels to
    the page on display.flip() / display.update();
  * fill a Python-side event queue from keyboard and mouse events the page
    writes into shared memory.

Everything else (drawing, Surfaces, Rect, fonts, sprites, transform, math,
Clock) is the real pygame, unchanged. Blocking game loops work as usual,
because none of this needs the worker to yield to the browser.
"""

import gc
import json
import os
import sys
import time

# Must be set before pygame starts SDL: the real (emscripten) video driver
# would look for a DOM and crash the worker. "dummy" isn't compiled in, so
# SDL's video init simply fails, cleanly, and the stand-ins below take over.
os.environ["SDL_VIDEODRIVER"] = "dummy"
os.environ["SDL_AUDIODRIVER"] = "dummy"

import _pyweb_bridge as bridge  # noqa: E402
import pygame  # noqa: E402

# Present at most this often; a frame skipped here is sent on the next
# flip(), event pump or at the end of the run, so the last frame always shows.
_FRAME_INTERVAL = 1 / 60

_DEFAULT_SIZE = (640, 480)


class _State:
    def reset(self):
        self.screen = None
        self.caption = "pygame window"
        self.queue = []
        self.keys = set()
        self.mouse_pos = (0, 0)
        self.mouse_rel = (0, 0)
        self.mouse_buttons = [False] * 5
        self.mouse_visible = True
        self.repeat = (0, 0)
        self.blocked = set()
        self.timers = {}
        self.grab = False
        self.last_present = 0.0
        self.dirty = False


S = _State()
S.reset()


# ------------------------------------------------------------------- display

def _present(force=False):
    if S.screen is None or not S.dirty:
        return
    now = time.monotonic()
    if not force and now - S.last_present < _FRAME_INTERVAL:
        return
    w, h = S.screen.get_size()
    pixels = pygame.image.tobytes(S.screen, "RGBA")
    bridge.present(w, h, pixels)
    S.last_present = now
    S.dirty = False


def _send(kind, **payload):
    bridge.send(kind, json.dumps(payload))


def set_mode(size=(0, 0), flags=0, depth=0, display=0, vsync=0):
    w, h = (int(size[0]), int(size[1])) if size else (0, 0)
    if w <= 0 or h <= 0:
        w, h = _DEFAULT_SIZE
    S.screen = pygame.Surface((w, h), 0, 32)
    S.dirty = True
    S.last_present = 0.0
    _send("open", width=w, height=h, title=S.caption)
    return S.screen


def get_surface():
    return S.screen


def flip():
    if S.screen is None:
        raise pygame.error("video system not initialized")
    S.dirty = True
    _present()


def update(*rects):
    flip()


def set_caption(title, icontitle=None):
    S.caption = str(title)
    _send("caption", title=S.caption)


def get_caption():
    return (S.caption, S.caption)


def get_window_size():
    return S.screen.get_size() if S.screen is not None else (0, 0)


def quit_display():
    _present(force=True)
    S.screen = None


class Info:
    def __init__(self):
        w, h = get_window_size()
        self.current_w, self.current_h = (w, h) if S.screen is not None else (1920, 1080)
        self.hw = False
        self.wm = True
        self.video_mem = 0
        self.bitsize = 32
        self.bytesize = 4
        self.blit_hw = self.blit_hw_CC = self.blit_hw_A = False
        self.blit_sw = self.blit_sw_CC = self.blit_sw_A = False

    def __repr__(self):
        return f"<VideoInfo({self.current_w}x{self.current_h})>"


_display = {
    "set_mode": set_mode,
    "get_surface": get_surface,
    "flip": flip,
    "update": update,
    "set_caption": set_caption,
    "get_caption": get_caption,
    "get_window_size": get_window_size,
    "quit": quit_display,
    "init": lambda: None,
    "get_init": lambda: True,
    "get_active": lambda: S.screen is not None,
    "get_driver": lambda: "pyweb",
    "Info": Info,
    "set_icon": lambda surface: None,
    "iconify": lambda: False,
    "toggle_fullscreen": lambda: 0,
    "get_wm_info": lambda: {},
    "get_desktop_sizes": lambda: [(1920, 1080)],
    "list_modes": lambda *a, **k: [(1920, 1080)],
    "mode_ok": lambda *a, **k: 32,
    "get_num_displays": lambda: 1,
    "set_allow_screensaver": lambda *a: None,
    "get_allow_screensaver": lambda: False,
    "set_gamma": lambda *a: False,
}


# --------------------------------------------------------------------- input

# KeyboardEvent.code -> pygame key constant. Layout-independent, which is what
# games want for WASD and arrows; letters fall back to the typed character.
def _build_keymap():
    k = pygame
    m = {
        "Space": k.K_SPACE, "Enter": k.K_RETURN, "Escape": k.K_ESCAPE,
        "Backspace": k.K_BACKSPACE, "Tab": k.K_TAB, "Delete": k.K_DELETE,
        "Insert": k.K_INSERT, "Home": k.K_HOME, "End": k.K_END,
        "PageUp": k.K_PAGEUP, "PageDown": k.K_PAGEDOWN,
        "ArrowUp": k.K_UP, "ArrowDown": k.K_DOWN,
        "ArrowLeft": k.K_LEFT, "ArrowRight": k.K_RIGHT,
        "ShiftLeft": k.K_LSHIFT, "ShiftRight": k.K_RSHIFT,
        "ControlLeft": k.K_LCTRL, "ControlRight": k.K_RCTRL,
        "AltLeft": k.K_LALT, "AltRight": k.K_RALT,
        "MetaLeft": k.K_LMETA, "MetaRight": k.K_RMETA,
        "CapsLock": k.K_CAPSLOCK, "Minus": k.K_MINUS, "Equal": k.K_EQUALS,
        "BracketLeft": k.K_LEFTBRACKET, "BracketRight": k.K_RIGHTBRACKET,
        "Backslash": k.K_BACKSLASH, "Semicolon": k.K_SEMICOLON,
        "Quote": k.K_QUOTE, "Backquote": k.K_BACKQUOTE, "Comma": k.K_COMMA,
        "Period": k.K_PERIOD, "Slash": k.K_SLASH,
        "NumpadEnter": k.K_KP_ENTER, "NumpadAdd": k.K_KP_PLUS,
        "NumpadSubtract": k.K_KP_MINUS, "NumpadMultiply": k.K_KP_MULTIPLY,
        "NumpadDivide": k.K_KP_DIVIDE, "NumpadDecimal": k.K_KP_PERIOD,
    }
    for c in "abcdefghijklmnopqrstuvwxyz":
        m["Key" + c.upper()] = getattr(k, "K_" + c)
    for d in range(10):
        m[f"Digit{d}"] = getattr(k, f"K_{d}")
        m[f"Numpad{d}"] = getattr(k, f"K_KP{d}")
    for f in range(1, 13):
        m[f"F{f}"] = getattr(k, f"K_F{f}")
    return m


_KEYMAP = _build_keymap()

_MODS = [
    (pygame.K_LSHIFT, pygame.KMOD_LSHIFT), (pygame.K_RSHIFT, pygame.KMOD_RSHIFT),
    (pygame.K_LCTRL, pygame.KMOD_LCTRL), (pygame.K_RCTRL, pygame.KMOD_RCTRL),
    (pygame.K_LALT, pygame.KMOD_LALT), (pygame.K_RALT, pygame.KMOD_RALT),
    (pygame.K_LMETA, pygame.KMOD_LMETA), (pygame.K_RMETA, pygame.KMOD_RMETA),
]


def _keycode(ev):
    code = _KEYMAP.get(ev.get("code", ""))
    if code is not None:
        return code
    key = ev.get("key", "")
    return ord(key.lower()) if len(key) == 1 else 0


def get_mods():
    mods = 0
    for key, bit in _MODS:
        if key in S.keys:
            mods |= bit
    return mods


class _Pressed:
    """Stand-in for pygame's ScancodeWrapper: indexed by K_* constants."""

    __slots__ = ("_keys",)

    def __init__(self, keys):
        self._keys = frozenset(keys)

    def __getitem__(self, key):
        return key in self._keys

    def __len__(self):
        return 512

    def __iter__(self):
        return (i in self._keys for i in range(512))


def _post(type_, **attrs):
    if type_ not in S.blocked:
        S.queue.append(pygame.event.Event(type_, **attrs))


def _translate(ev):
    t = ev["t"]
    if t == "kd":
        key = _keycode(ev)
        if ev.get("rep") and S.repeat[0] <= 0:
            return
        S.keys.add(key)
        char = ev.get("key", "")
        text = char if len(char) == 1 else ""
        _post(pygame.KEYDOWN, key=key, mod=get_mods(), unicode=text,
              scancode=0, window=None)
        if text and not (get_mods() & (pygame.KMOD_CTRL | pygame.KMOD_META)):
            _post(pygame.TEXTINPUT, text=text, window=None)
    elif t == "ku":
        key = _keycode(ev)
        S.keys.discard(key)
        _post(pygame.KEYUP, key=key, mod=get_mods(), unicode="",
              scancode=0, window=None)
    elif t == "mm":
        pos = (ev["x"], ev["y"])
        rel = (pos[0] - S.mouse_pos[0], pos[1] - S.mouse_pos[1])
        S.mouse_pos = pos
        S.mouse_rel = (S.mouse_rel[0] + rel[0], S.mouse_rel[1] + rel[1])
        _post(pygame.MOUSEMOTION, pos=pos, rel=rel,
              buttons=tuple(S.mouse_buttons[:3]), touch=False, window=None)
    elif t in ("md", "mu"):
        # Browser buttons are 0 left, 1 middle, 2 right; pygame's are 1, 2, 3.
        button = ev["b"] + 1
        S.mouse_pos = (ev["x"], ev["y"])
        if 1 <= button <= 5:
            S.mouse_buttons[button - 1] = t == "md"
        _post(pygame.MOUSEBUTTONDOWN if t == "md" else pygame.MOUSEBUTTONUP,
              pos=S.mouse_pos, button=button, touch=False, window=None)
    elif t == "wh":
        dy = -1 if ev["dy"] > 0 else 1 if ev["dy"] < 0 else 0
        dx = 1 if ev["dx"] > 0 else -1 if ev["dx"] < 0 else 0
        _post(pygame.MOUSEWHEEL, x=dx, y=dy, flipped=False,
              precise_x=float(dx), precise_y=float(dy), touch=False, window=None)
        if dy:
            button = 4 if dy > 0 else 5
            _post(pygame.MOUSEBUTTONDOWN, pos=S.mouse_pos, button=button,
                  touch=False, window=None)
            _post(pygame.MOUSEBUTTONUP, pos=S.mouse_pos, button=button,
                  touch=False, window=None)
    elif t == "blur":
        # Keys released while the canvas was unfocused would stick otherwise.
        for key in list(S.keys):
            _post(pygame.KEYUP, key=key, mod=0, unicode="", scancode=0, window=None)
        S.keys.clear()
        S.mouse_buttons = [False] * 5
    elif t == "quit":
        _post(pygame.QUIT)


def _pump():
    raw = bridge.take_events()
    if raw:
        for ev in json.loads(raw):
            _translate(ev)
    if S.timers:
        now = time.monotonic()
        for key, timer in list(S.timers.items()):
            event, interval, due, loops = timer
            if now >= due:
                S.queue.append(event)
                if loops == 1:
                    del S.timers[key]
                else:
                    timer[2] = now + interval
                    timer[3] = loops - 1 if loops else 0
    _present()


def _matches(event, types):
    return types is None or event.type in types


def _types(eventtype):
    if eventtype is None:
        return None
    if isinstance(eventtype, int):
        return {eventtype}
    return set(eventtype)


def get(eventtype=None, pump=True, exclude=None):
    if pump:
        _pump()
    want, skip = _types(eventtype), _types(exclude) or set()
    taken, kept = [], []
    for e in S.queue:
        (taken if _matches(e, want) and e.type not in skip else kept).append(e)
    S.queue = kept
    return taken


def poll():
    _pump()
    if S.queue:
        return S.queue.pop(0)
    return pygame.event.Event(pygame.NOEVENT)


def wait(timeout=0):
    deadline = time.monotonic() + timeout / 1000 if timeout else None
    while True:
        _pump()
        if S.queue:
            return S.queue.pop(0)
        if deadline is not None and time.monotonic() >= deadline:
            return pygame.event.Event(pygame.NOEVENT)
        time.sleep(0.005)


def peek(eventtype=None, pump=True):
    if pump:
        _pump()
    want = _types(eventtype)
    if eventtype is None:
        return S.queue[0] if S.queue else pygame.event.Event(pygame.NOEVENT)
    return any(_matches(e, want) for e in S.queue)


def clear(eventtype=None, pump=True):
    if pump:
        _pump()
    want = _types(eventtype)
    S.queue = [e for e in S.queue if not _matches(e, want)]


def post(event):
    if event.type in S.blocked:
        return False
    S.queue.append(event)
    return True


def set_blocked(eventtype):
    if eventtype is None:
        S.blocked.clear()
    else:
        S.blocked |= _types(eventtype)


def set_allowed(eventtype):
    if eventtype is None:
        S.blocked.clear()
    else:
        S.blocked -= _types(eventtype)


def set_timer(event, millis, loops=0):
    if isinstance(event, int):
        key, event = event, pygame.event.Event(event)
    else:
        key = event.type
    if millis <= 0:
        S.timers.pop(key, None)
        return
    interval = millis / 1000
    S.timers[key] = [event, interval, time.monotonic() + interval, loops]


def _set_grab(on):
    S.grab = bool(on)


_event = {
    "pump": _pump,
    "get": get,
    "poll": poll,
    "wait": wait,
    "peek": peek,
    "clear": clear,
    "post": post,
    "set_blocked": set_blocked,
    "set_allowed": set_allowed,
    "get_blocked": lambda t: bool(_types(t) & S.blocked),
    "set_grab": _set_grab,
    "get_grab": lambda: S.grab,
    "set_keyboard_grab": _set_grab,
    "get_keyboard_grab": lambda: S.grab,
}


def _set_repeat(delay=0, interval=0):
    S.repeat = (delay, interval)


_key = {
    "get_pressed": lambda: _Pressed(S.keys),
    "get_mods": get_mods,
    "set_mods": lambda mods: None,
    "get_focused": lambda: True,
    "set_repeat": _set_repeat,
    "get_repeat": lambda: S.repeat,
    "start_text_input": lambda: None,
    "stop_text_input": lambda: None,
    "set_text_input_rect": lambda rect: None,
}


def _get_rel():
    rel, S.mouse_rel = S.mouse_rel, (0, 0)
    return rel


def _mouse_pressed(num_buttons=3):
    return tuple(S.mouse_buttons[:num_buttons])


def _set_visible(visible):
    was, S.mouse_visible = S.mouse_visible, bool(visible)
    _send("cursor", visible=S.mouse_visible)
    return int(was)


def _set_pos(*pos):
    if len(pos) == 1:
        pos = pos[0]
    S.mouse_pos = (int(pos[0]), int(pos[1]))


_mouse = {
    "get_pos": lambda: S.mouse_pos,
    "get_rel": _get_rel,
    "get_pressed": _mouse_pressed,
    "set_pos": _set_pos,
    "set_visible": _set_visible,
    "get_visible": lambda: S.mouse_visible,
    "get_focused": lambda: True,
    "set_cursor": lambda *a, **k: None,
    "get_cursor": lambda: None,
    "set_system_cursor": lambda *a, **k: None,
}


# ----------------------------------------------------------- Surface.convert

def _patch_surface():
    # Surface is a static C type, so its methods can't be reassigned the usual
    # way. Without a real display, convert() has no pixel format to convert
    # to; returning a copy is visually identical, and lets the very common
    # `.convert()` / `.convert_alpha()` calls work.
    methods = gc.get_referents(pygame.Surface.__dict__)[0]
    original = methods["convert"]

    def convert(self, *args, **kwargs):
        if args or kwargs:
            return original(self, *args, **kwargs)
        return self.copy()

    def convert_alpha(self, *args, **kwargs):
        if self.get_flags() & pygame.SRCALPHA:
            return self.copy()
        out = pygame.Surface(self.get_size(), pygame.SRCALPHA, 32)
        out.blit(self, (0, 0))
        return out

    methods["convert"] = convert
    methods["convert_alpha"] = convert_alpha
    clear_caches = getattr(sys, "_clear_internal_caches", None) or sys._clear_type_cache
    clear_caches()


# -------------------------------------------------------------------- wiring

def _install():
    for module, funcs in (
        (pygame.display, _display),
        (pygame.event, _event),
        (pygame.key, _key),
        (pygame.mouse, _mouse),
    ):
        for name, func in funcs.items():
            setattr(module, name, func)
    pygame.time.set_timer = set_timer
    _patch_surface()


_install()


def reset():
    """Called before each run: a new program starts with no window open."""
    S.reset()


def finish():
    """Called after each run so the final frame is always on screen."""
    _present(force=True)
