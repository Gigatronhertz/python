// Static completion data. Pyodide could give live introspection, but that would
// need a round-trip to the worker on every keystroke — and would stall whenever
// the program is mid-run or parked on input(). A static table stays instant.

export const KEYWORDS = [
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def',
  'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if',
  'import', 'in', 'is', 'lambda', 'match', 'nonlocal', 'not', 'or', 'pass',
  'raise', 'return', 'try', 'while', 'with', 'yield', 'True', 'False', 'None',
];

export const BUILTINS = [
  ['print', 'print(*values, sep=" ", end=newline)'],
  ['input', 'input(prompt="") -> str'],
  ['len', 'len(obj) -> int'],
  ['range', 'range(stop) | range(start, stop[, step])'],
  ['int', 'int(x) -> int'],
  ['float', 'float(x) -> float'],
  ['str', 'str(object) -> str'],
  ['bool', 'bool(x) -> bool'],
  ['list', 'list(iterable) -> list'],
  ['dict', 'dict(**kwargs) -> dict'],
  ['set', 'set(iterable) -> set'],
  ['tuple', 'tuple(iterable) -> tuple'],
  ['sum', 'sum(iterable, start=0)'],
  ['min', 'min(iterable)'],
  ['max', 'max(iterable)'],
  ['abs', 'abs(x)'],
  ['round', 'round(number, ndigits=None)'],
  ['sorted', 'sorted(iterable, key=None, reverse=False)'],
  ['reversed', 'reversed(seq)'],
  ['enumerate', 'enumerate(iterable, start=0)'],
  ['zip', 'zip(*iterables)'],
  ['map', 'map(func, iterable)'],
  ['filter', 'filter(func, iterable)'],
  ['any', 'any(iterable)'],
  ['all', 'all(iterable)'],
  ['open', 'open(file, mode="r")'],
  ['type', 'type(obj)'],
  ['isinstance', 'isinstance(obj, cls)'],
  ['hasattr', 'hasattr(obj, name)'],
  ['getattr', 'getattr(obj, name, default)'],
  ['setattr', 'setattr(obj, name, value)'],
  ['dir', 'dir(obj)'],
  ['help', 'help(obj)'],
  ['id', 'id(obj)'],
  ['hash', 'hash(obj)'],
  ['repr', 'repr(obj)'],
  ['format', 'format(value, spec)'],
  ['chr', 'chr(i)'],
  ['ord', 'ord(c)'],
  ['bin', 'bin(x)'],
  ['hex', 'hex(x)'],
  ['oct', 'oct(x)'],
  ['pow', 'pow(base, exp, mod=None)'],
  ['divmod', 'divmod(a, b)'],
  ['iter', 'iter(obj)'],
  ['next', 'next(it)'],
  ['slice', 'slice(stop)'],
  ['frozenset', 'frozenset(iterable)'],
  ['bytes', 'bytes(source)'],
  ['bytearray', 'bytearray(source)'],
  ['callable', 'callable(obj)'],
  ['globals', 'globals()'],
  ['locals', 'locals()'],
  ['vars', 'vars(obj)'],
  ['super', 'super()'],
  ['staticmethod', '@staticmethod'],
  ['classmethod', '@classmethod'],
  ['property', '@property'],
];

export const EXCEPTIONS = [
  'Exception', 'BaseException', 'ValueError', 'TypeError', 'KeyError',
  'IndexError', 'AttributeError', 'NameError', 'ZeroDivisionError',
  'StopIteration', 'RuntimeError', 'NotImplementedError', 'OSError',
  'FileNotFoundError', 'ImportError', 'ModuleNotFoundError', 'KeyboardInterrupt',
  'EOFError', 'AssertionError', 'ArithmeticError', 'OverflowError',
  'RecursionError', 'UnicodeDecodeError', 'PermissionError',
];

export const MODULES = [
  'math', 'random', 'time', 'datetime', 'json', 'os', 'sys', 're', 'itertools',
  'functools', 'collections', 'string', 'statistics', 'decimal', 'fractions',
  'copy', 'textwrap', 'pprint', 'heapq', 'bisect', 'array', 'enum',
  'dataclasses', 'typing', 'abc', 'io', 'pathlib', 'csv', 'base64', 'hashlib',
  'uuid', 'unittest', 'calendar', 'operator', 'secrets', 'zoneinfo',
];

// Members offered after a dot, grouped so each list stays short and relevant.
export const STR_METHODS = [
  'upper', 'lower', 'title', 'capitalize', 'strip', 'lstrip', 'rstrip', 'split',
  'rsplit', 'splitlines', 'join', 'replace', 'find', 'rfind', 'index', 'count',
  'startswith', 'endswith', 'format', 'encode', 'isdigit', 'isalpha',
  'isalnum', 'isspace', 'isupper', 'islower', 'zfill', 'center', 'ljust',
  'rjust', 'removeprefix', 'removesuffix', 'casefold', 'swapcase', 'partition',
];

export const LIST_METHODS = [
  'append', 'extend', 'insert', 'remove', 'pop', 'clear', 'index', 'count',
  'sort', 'reverse', 'copy',
];

export const DICT_METHODS = [
  'keys', 'values', 'items', 'get', 'pop', 'popitem', 'update', 'setdefault',
  'clear', 'copy', 'fromkeys',
];

export const SET_METHODS = [
  'add', 'discard', 'remove', 'pop', 'union', 'intersection', 'difference',
  'symmetric_difference', 'issubset', 'issuperset', 'update', 'clear', 'copy',
];

export const MODULE_MEMBERS = {
  math: ['pi', 'e', 'tau', 'inf', 'nan', 'sqrt', 'pow', 'floor', 'ceil', 'fabs',
    'factorial', 'gcd', 'lcm', 'log', 'log2', 'log10', 'exp', 'sin', 'cos',
    'tan', 'asin', 'acos', 'atan', 'atan2', 'degrees', 'radians', 'hypot',
    'isclose', 'isnan', 'isinf', 'trunc', 'comb', 'perm', 'dist', 'prod'],
  random: ['random', 'randint', 'randrange', 'choice', 'choices', 'shuffle',
    'sample', 'uniform', 'gauss', 'seed', 'betavariate', 'triangular'],
  time: ['time', 'sleep', 'perf_counter', 'monotonic', 'strftime', 'localtime',
    'gmtime', 'time_ns', 'process_time'],
  json: ['dumps', 'loads', 'dump', 'load', 'JSONDecodeError'],
  os: ['getcwd', 'listdir', 'mkdir', 'makedirs', 'remove', 'rename', 'path',
    'environ', 'sep', 'walk', 'rmdir'],
  sys: ['argv', 'version', 'platform', 'exit', 'stdin', 'stdout', 'stderr',
    'maxsize', 'path', 'getrecursionlimit', 'setrecursionlimit'],
  re: ['match', 'search', 'findall', 'finditer', 'sub', 'subn', 'split',
    'compile', 'escape', 'fullmatch', 'IGNORECASE', 'MULTILINE', 'DOTALL'],
  datetime: ['date', 'time', 'datetime', 'timedelta', 'timezone'],
  itertools: ['count', 'cycle', 'repeat', 'chain', 'product', 'permutations',
    'combinations', 'groupby', 'accumulate', 'islice', 'zip_longest'],
  functools: ['reduce', 'lru_cache', 'cache', 'partial', 'wraps',
    'cached_property', 'total_ordering'],
  collections: ['Counter', 'defaultdict', 'OrderedDict', 'deque', 'namedtuple',
    'ChainMap', 'UserDict', 'UserList'],
  statistics: ['mean', 'median', 'mode', 'stdev', 'variance', 'pstdev',
    'quantiles', 'fmean', 'multimode'],
  string: ['ascii_letters', 'ascii_lowercase', 'ascii_uppercase', 'digits',
    'punctuation', 'whitespace', 'printable', 'capwords'],
};
