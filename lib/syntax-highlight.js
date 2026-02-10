/**
 * Albert — Lightweight Syntax Highlighter
 * Tokenizes JavaScript and CSS source code and wraps tokens in <span> elements
 * with class names for styling. No external dependencies.
 */

const SyntaxHighlight = (() => {

  // ── JavaScript Tokenizer ──────────────────────────────

  const JS_KEYWORDS = new Set([
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends',
    'finally', 'for', 'from', 'function', 'if', 'import', 'in', 'instanceof',
    'let', 'new', 'of', 'return', 'static', 'super', 'switch', 'throw',
    'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
  ]);

  const JS_LITERALS = new Set([
    'true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'this',
  ]);

  /**
   * Tokenize JavaScript source into an array of { type, value } objects.
   */
  function tokenizeJS(code) {
    const tokens = [];
    let i = 0;
    const len = code.length;

    while (i < len) {
      const ch = code[i];

      // Single-line comment
      if (ch === '/' && code[i + 1] === '/') {
        const end = code.indexOf('\n', i);
        const slice = end === -1 ? code.slice(i) : code.slice(i, end);
        tokens.push({ type: 'comment', value: slice });
        i += slice.length;
        continue;
      }

      // Multi-line comment
      if (ch === '/' && code[i + 1] === '*') {
        const end = code.indexOf('*/', i + 2);
        const slice = end === -1 ? code.slice(i) : code.slice(i, end + 2);
        tokens.push({ type: 'comment', value: slice });
        i += slice.length;
        continue;
      }

      // Template literal
      if (ch === '`') {
        let j = i + 1;
        let val = '`';
        while (j < len && code[j] !== '`') {
          if (code[j] === '\\') {
            val += code[j] + (code[j + 1] || '');
            j += 2;
          } else {
            val += code[j];
            j++;
          }
        }
        if (j < len) { val += '`'; j++; }
        tokens.push({ type: 'string', value: val });
        i = j;
        continue;
      }

      // String (single or double quote)
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        let val = ch;
        while (j < len && code[j] !== ch) {
          if (code[j] === '\\') {
            val += code[j] + (code[j + 1] || '');
            j += 2;
          } else {
            val += code[j];
            j++;
          }
        }
        if (j < len) { val += ch; j++; }
        tokens.push({ type: 'string', value: val });
        i = j;
        continue;
      }

      // Regex literal (simple heuristic: after certain tokens)
      if (ch === '/' && i > 0) {
        // Look back to see if this could be a regex
        const prevToken = tokens.length > 0 ? tokens[tokens.length - 1] : null;
        const isRegex = !prevToken ||
          prevToken.type === 'punctuation' ||
          prevToken.type === 'keyword' ||
          prevToken.type === 'operator';
        if (isRegex) {
          let j = i + 1;
          let val = '/';
          let inCharClass = false;
          while (j < len) {
            if (code[j] === '\\') {
              val += code[j] + (code[j + 1] || '');
              j += 2;
            } else if (code[j] === '[') {
              inCharClass = true;
              val += code[j]; j++;
            } else if (code[j] === ']') {
              inCharClass = false;
              val += code[j]; j++;
            } else if (code[j] === '/' && !inCharClass) {
              val += '/'; j++;
              // Flags
              while (j < len && /[gimsuy]/.test(code[j])) {
                val += code[j]; j++;
              }
              break;
            } else if (code[j] === '\n') {
              break; // Not a regex
            } else {
              val += code[j]; j++;
            }
          }
          if (val.length > 1 && val[val.length - 1] !== '\n') {
            tokens.push({ type: 'regex', value: val });
            i = j;
            continue;
          }
        }
      }

      // Number
      if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < len && /[0-9]/.test(code[i + 1]))) {
        let j = i;
        // Hex
        if (ch === '0' && (code[j + 1] === 'x' || code[j + 1] === 'X')) {
          j += 2;
          while (j < len && /[0-9a-fA-F_]/.test(code[j])) j++;
        } else {
          while (j < len && /[0-9_]/.test(code[j])) j++;
          if (j < len && code[j] === '.') { j++; while (j < len && /[0-9_]/.test(code[j])) j++; }
          if (j < len && (code[j] === 'e' || code[j] === 'E')) {
            j++;
            if (j < len && (code[j] === '+' || code[j] === '-')) j++;
            while (j < len && /[0-9_]/.test(code[j])) j++;
          }
        }
        // Suffix like 'n' for BigInt
        if (j < len && code[j] === 'n') j++;
        tokens.push({ type: 'number', value: code.slice(i, j) });
        i = j;
        continue;
      }

      // Word (identifier or keyword)
      if (/[a-zA-Z_$]/.test(ch)) {
        let j = i;
        while (j < len && /[a-zA-Z0-9_$]/.test(code[j])) j++;
        const word = code.slice(i, j);
        if (JS_KEYWORDS.has(word)) {
          tokens.push({ type: 'keyword', value: word });
        } else if (JS_LITERALS.has(word)) {
          tokens.push({ type: 'literal', value: word });
        } else {
          // Check if it's a function call (followed by `(`)
          let k = j;
          while (k < len && code[k] === ' ') k++;
          if (k < len && code[k] === '(') {
            tokens.push({ type: 'function', value: word });
          } else {
            tokens.push({ type: 'identifier', value: word });
          }
        }
        i = j;
        continue;
      }

      // Operators
      if ('=+-*/%<>!&|^~?:'.includes(ch)) {
        let op = ch;
        let j = i + 1;
        // Greedily consume multi-char operators
        while (j < len && '=+-*/%<>!&|^~?:'.includes(code[j]) && (j - i) < 4) {
          op += code[j]; j++;
        }
        tokens.push({ type: 'operator', value: op });
        i = j;
        continue;
      }

      // Punctuation
      if ('(){}[];,.'.includes(ch)) {
        tokens.push({ type: 'punctuation', value: ch });
        i++;
        continue;
      }

      // Whitespace
      if (/\s/.test(ch)) {
        let j = i;
        while (j < len && /\s/.test(code[j])) j++;
        tokens.push({ type: 'whitespace', value: code.slice(i, j) });
        i = j;
        continue;
      }

      // Anything else
      tokens.push({ type: 'plain', value: ch });
      i++;
    }

    return tokens;
  }

  // ── CSS Tokenizer ─────────────────────────────────────

  function tokenizeCSS(code) {
    const tokens = [];
    let i = 0;
    const len = code.length;
    let context = 'selector'; // 'selector' | 'property' | 'value'

    while (i < len) {
      const ch = code[i];

      // Comment
      if (ch === '/' && code[i + 1] === '*') {
        const end = code.indexOf('*/', i + 2);
        const slice = end === -1 ? code.slice(i) : code.slice(i, end + 2);
        tokens.push({ type: 'comment', value: slice });
        i += slice.length;
        continue;
      }

      // String
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        let val = ch;
        while (j < len && code[j] !== ch) {
          if (code[j] === '\\') { val += code[j] + (code[j + 1] || ''); j += 2; }
          else { val += code[j]; j++; }
        }
        if (j < len) { val += ch; j++; }
        tokens.push({ type: 'string', value: val });
        i = j;
        continue;
      }

      // Braces
      if (ch === '{') {
        tokens.push({ type: 'punctuation', value: ch });
        context = 'property';
        i++;
        continue;
      }
      if (ch === '}') {
        tokens.push({ type: 'punctuation', value: ch });
        context = 'selector';
        i++;
        continue;
      }

      // Colon (property → value)
      if (ch === ':' && context === 'property') {
        tokens.push({ type: 'punctuation', value: ch });
        context = 'value';
        i++;
        continue;
      }

      // Semicolon (value → property)
      if (ch === ';') {
        tokens.push({ type: 'punctuation', value: ch });
        context = 'property';
        i++;
        continue;
      }

      // At-rules (@media, @keyframes, etc.)
      if (ch === '@') {
        let j = i + 1;
        while (j < len && /[a-zA-Z-]/.test(code[j])) j++;
        tokens.push({ type: 'at-rule', value: code.slice(i, j) });
        i = j;
        continue;
      }

      // Number (with optional unit)
      if (context === 'value' && (/[0-9]/.test(ch) || (ch === '.' && i + 1 < len && /[0-9]/.test(code[i + 1])))) {
        let j = i;
        while (j < len && /[0-9.]/.test(code[j])) j++;
        // Unit suffix
        while (j < len && /[a-zA-Z%]/.test(code[j])) j++;
        tokens.push({ type: 'number', value: code.slice(i, j) });
        i = j;
        continue;
      }

      // Hex color
      if (ch === '#' && context === 'value') {
        let j = i + 1;
        while (j < len && /[0-9a-fA-F]/.test(code[j])) j++;
        tokens.push({ type: 'color', value: code.slice(i, j) });
        i = j;
        continue;
      }

      // Words
      if (/[a-zA-Z_-]/.test(ch)) {
        let j = i;
        while (j < len && /[a-zA-Z0-9_-]/.test(code[j])) j++;
        const word = code.slice(i, j);

        if (context === 'selector') {
          tokens.push({ type: 'selector', value: word });
        } else if (context === 'property') {
          tokens.push({ type: 'property', value: word });
        } else if (context === 'value') {
          // Check if it's a function like rgb(...), var(...)
          let k = j;
          while (k < len && code[k] === ' ') k++;
          if (k < len && code[k] === '(') {
            tokens.push({ type: 'function', value: word });
          } else if (isCSSColorName(word)) {
            tokens.push({ type: 'color', value: word });
          } else if (word === '!important') {
            tokens.push({ type: 'keyword', value: word });
          } else {
            tokens.push({ type: 'value', value: word });
          }
        } else {
          tokens.push({ type: 'plain', value: word });
        }
        i = j;
        continue;
      }

      // Selector symbols
      if (context === 'selector' && '.#>+~[](),:'.includes(ch)) {
        tokens.push({ type: 'selector-punct', value: ch });
        i++;
        continue;
      }

      // Whitespace
      if (/\s/.test(ch)) {
        let j = i;
        while (j < len && /\s/.test(code[j])) j++;
        tokens.push({ type: 'whitespace', value: code.slice(i, j) });
        i = j;
        continue;
      }

      // Anything else (parens, commas in values, etc.)
      tokens.push({ type: 'punctuation', value: ch });
      i++;
    }

    return tokens;
  }

  const CSS_COLORS = new Set([
    'transparent', 'currentcolor', 'inherit', 'initial', 'unset',
    'red', 'blue', 'green', 'white', 'black', 'gray', 'grey',
    'orange', 'yellow', 'purple', 'pink', 'cyan', 'magenta',
  ]);
  function isCSSColorName(word) {
    return CSS_COLORS.has(word.toLowerCase());
  }

  // ── Renderer ──────────────────────────────────────────

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const TOKEN_CLASS_MAP = {
    comment:       'sh-comment',
    string:        'sh-string',
    regex:         'sh-regex',
    number:        'sh-number',
    keyword:       'sh-keyword',
    literal:       'sh-literal',
    'function':    'sh-function',
    operator:      'sh-operator',
    punctuation:   'sh-punct',
    identifier:    'sh-ident',
    // CSS-specific
    selector:      'sh-selector',
    'selector-punct': 'sh-selector-punct',
    property:      'sh-property',
    value:         'sh-value',
    color:         'sh-color',
    'at-rule':     'sh-at-rule',
  };

  function tokensToHTML(tokens) {
    return tokens.map(t => {
      const cls = TOKEN_CLASS_MAP[t.type];
      const escaped = escapeHtml(t.value);
      if (cls) {
        return `<span class="${cls}">${escaped}</span>`;
      }
      return escaped;
    }).join('');
  }

  // ── Public API ────────────────────────────────────────

  function highlightJS(code) {
    return tokensToHTML(tokenizeJS(code));
  }

  function highlightCSS(code) {
    return tokensToHTML(tokenizeCSS(code));
  }

  return { highlightJS, highlightCSS };
})();
