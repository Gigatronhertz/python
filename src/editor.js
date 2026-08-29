import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine,
  highlightActiveLineGutter, drawSelection, rectangularSelection,
  crosshairCursor, highlightSpecialChars } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab,
  indentLess, indentMore } from '@codemirror/commands';
import { python, localCompletionSource, globalCompletion } from '@codemirror/lang-python';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap,
  acceptCompletion, completionStatus } from '@codemirror/autocomplete';
import { indentUnit, indentOnInput, bracketMatching, foldGutter, foldKeymap,
  syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';

import {
  KEYWORDS, BUILTINS, EXCEPTIONS, MODULES, MODULE_MEMBERS,
  STR_METHODS, LIST_METHODS, DICT_METHODS, SET_METHODS,
} from './completions.js';

const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#c792ea' },
  { tag: [t.controlKeyword, t.moduleKeyword], color: '#ff9cac' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: '#d6deeb' },
  { tag: [t.function(t.variableName), t.labelName], color: '#82aaff' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#f78c6c' },
  { tag: [t.definition(t.name), t.separator], color: '#d6deeb' },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation,
    t.modifier, t.self, t.namespace], color: '#f7c66b' },
  { tag: [t.operator, t.operatorKeyword], color: '#7dd3fc' },
  { tag: [t.string, t.special(t.string)], color: '#5ddc9a' },
  { tag: [t.meta, t.comment], color: '#5a6b7d', fontStyle: 'italic' },
  { tag: t.bool, color: '#f78c6c' },
  { tag: t.null, color: '#f78c6c' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.invalid, color: '#ff6b6b' },
]);

const theme = EditorView.theme(
  {
    '&': { color: '#d6deeb', backgroundColor: '#0d1219', height: '100%' },
    '.cm-content': {
      caretColor: '#7dd3fc',
      fontFamily: '"JetBrains Mono", "Cascadia Code", "SF Mono", Consolas, monospace',
      fontSize: '13.5px',
      lineHeight: '1.6',
      padding: '12px 0',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#7dd3fc', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: '#1f3a5f' },
    '.cm-gutters': {
      backgroundColor: '#0d1219',
      color: '#3f4d5e',
      border: 'none',
      paddingRight: '4px',
    },
    '.cm-activeLineGutter': { backgroundColor: '#141c27', color: '#8fa3ba' },
    '.cm-activeLine': { backgroundColor: '#121a24' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: '#1f3a5f',
      outline: '1px solid #3b587d',
    },
    '.cm-tooltip': {
      backgroundColor: '#141c27',
      border: '1px solid #24303f',
      borderRadius: '6px',
      boxShadow: '0 8px 24px rgba(0,0,0,.45)',
    },
    '.cm-tooltip-autocomplete > ul > li': {
      padding: '3px 8px',
      fontFamily: '"JetBrains Mono", Consolas, monospace',
      fontSize: '12.5px',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: '#1f3a5f',
      color: '#ffffff',
    },
    '.cm-completionIcon': { paddingRight: '14px', opacity: 0.7 },
    '.cm-completionDetail': { color: '#5a6b7d', fontStyle: 'normal', marginLeft: '1em' },
    '.cm-scroller': { overflow: 'auto' },
  },
  { dark: true },
);

/** Words the user has already typed, so their own names complete too. */
function documentWords(context) {
  const text = context.state.doc.toString();
  const seen = new Set();
  for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) seen.add(m[0]);
  return seen;
}

/**
 * Completions after a `.` — driven by the token before the dot. A variable
 * assigned a literal earlier in the file gets that type's methods.
 */
function memberCompletions(context) {
  const before = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*\s*\.\s*[A-Za-z0-9_]*/);
  if (!before) return null;
  const dot = before.text.lastIndexOf('.');
  const owner = before.text.slice(0, dot).trim();
  const typed = before.text.slice(dot + 1).trim();
  const from = before.to - typed.length;

  let names = null;
  let detail = '';

  if (Object.prototype.hasOwnProperty.call(MODULE_MEMBERS, owner)) {
    names = MODULE_MEMBERS[owner];
    detail = owner;
  } else {
    // Infer from the nearest assignment to this name.
    const doc = context.state.doc.sliceString(0, context.pos);
    const assign = new RegExp(`\\b${owner}\\s*=\\s*(.{0,40})`, 'g');
    let last = null;
    for (const m of doc.matchAll(assign)) last = m[1];
    if (last != null) {
      const v = last.trimStart();
      if (/^["'f]/.test(v) || /^(str|input)\s*\(/.test(v)) { names = STR_METHODS; detail = 'str'; }
      else if (/^\[/.test(v) || /^(list|sorted)\s*\(/.test(v)) { names = LIST_METHODS; detail = 'list'; }
      else if (/^\{\s*["'\w]+\s*:/.test(v) || /^dict\s*\(/.test(v)) { names = DICT_METHODS; detail = 'dict'; }
      else if (/^set\s*\(/.test(v)) { names = SET_METHODS; detail = 'set'; }
      else if (/^\{/.test(v)) { names = [...DICT_METHODS, ...SET_METHODS]; detail = 'dict|set'; }
    }
  }

  if (!names) {
    // Unknown receiver: offer every method we know, ranked below exact matches.
    names = [...new Set([...STR_METHODS, ...LIST_METHODS, ...DICT_METHODS, ...SET_METHODS])];
    detail = 'method';
  }

  return {
    from,
    options: names.map((name) => ({ label: name, type: 'method', detail })),
    validFor: /^[A-Za-z0-9_]*$/,
  };
}

/** Module names right after `import` / `from`. */
function importCompletions(context) {
  const before = context.matchBefore(/(?:^|\n)\s*(?:import|from)\s+[A-Za-z0-9_.]*/);
  if (!before) return null;
  const word = context.matchBefore(/[A-Za-z0-9_.]*/);
  if (!word) return null;
  return {
    from: word.from,
    options: MODULES.map((m) => ({ label: m, type: 'namespace', detail: 'module' })),
    validFor: /^[A-Za-z0-9_.]*$/,
  };
}

function pythonCompletions(context) {
  const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
  if (!word && !context.explicit) return null;
  const from = word ? word.from : context.pos;
  const typedSoFar = word ? word.text : '';

  const options = [
    ...KEYWORDS.map((k) => ({ label: k, type: 'keyword', boost: 1 })),
    ...BUILTINS.map(([label, detail]) => ({ label, type: 'function', detail, boost: 2 })),
    ...EXCEPTIONS.map((label) => ({ label, type: 'class', detail: 'exception' })),
    ...MODULES.map((label) => ({ label, type: 'namespace', detail: 'module', boost: -1 })),
  ];

  const known = new Set(options.map((o) => o.label));
  for (const w of documentWords(context)) {
    if (!known.has(w) && w !== typedSoFar) {
      options.push({ label: w, type: 'variable', detail: 'in file', boost: 3 });
    }
  }

  return { from, options, validFor: /^[A-Za-z0-9_]*$/ };
}

/**
 * Tab: accept the highlighted completion if the popup is open, otherwise
 * indent. That is the behaviour people expect from an editor.
 */
const tabKeymap = [
  {
    key: 'Tab',
    run: (view) => (completionStatus(view.state) === 'active' ? acceptCompletion(view) : indentMore(view)),
    shift: indentLess,
  },
];

export function createEditor({ parent, doc, onRun }) {
  const readOnly = new Compartment();

  const state = EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      EditorState.allowMultipleSelections.of(true),
      // indentOnInput is what re-indents `else:` / `except:` as you type them.
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({
        activateOnTyping: true,
        maxRenderedOptions: 40,
        defaultKeymap: true,
        icons: true,
        override: [memberCompletions, importCompletions, pythonCompletions,
          localCompletionSource, globalCompletion],
      }),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      syntaxHighlighting(highlightStyle),
      python(),
      // Python's own indent rules: 4 spaces, and a new block after a colon.
      indentUnit.of('    '),
      EditorState.tabSize.of(4),
      EditorView.lineWrapping,
      theme,
      keymap.of([
        ...tabKeymap,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
        { key: 'Mod-Enter', run: () => { onRun(); return true; }, preventDefault: true },
        { key: 'Shift-Enter', run: () => { onRun(); return true; }, preventDefault: true },
      ]),
      readOnly.of(EditorState.readOnly.of(false)),
    ],
  });

  const view = new EditorView({ state, parent });

  return {
    view,
    getCode: () => view.state.doc.toString(),
    setCode(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 },
      });
    },
    setReadOnly(value) {
      view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(value)) });
    },
    focus: () => view.focus(),
  };
}
