// A34: code-mock hints and URL parameter extraction.

export interface CodeCompletionOption {
  label: string;
  detail: string;
}

export interface CodeCompletionsResult {
  from: number;
  options: CodeCompletionOption[];
}

/**
 * URL parameters in the path part (:name and *name), in order.
 * A host's :port is not a parameter; an escaped \: or \* is not one either.
 */
export function paramNamesOf(pattern: string): string[] {
  let pathPart = pattern;
  const schemeIdx = pattern.indexOf('://');
  if (schemeIdx !== -1) {
    const slashIdx = pattern.indexOf('/', schemeIdx + 3);
    pathPart = slashIdx !== -1 ? pattern.slice(slashIdx) : '';
  }
  const qIdx = pathPart.indexOf('?');
  if (qIdx !== -1) {
    pathPart = pathPart.slice(0, qIdx);
  }
  const hashIdx = pathPart.indexOf('#');
  if (hashIdx !== -1) {
    pathPart = pathPart.slice(0, hashIdx);
  }

  const names: string[] = [];
  let i = 0;
  while (i < pathPart.length) {
    const ch = pathPart[i] ?? '';
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === ':' || ch === '*') {
      let j = i + 1;
      while (j < pathPart.length && /[a-zA-Z0-9_]/.test(pathPart[j] ?? '')) {
        j++;
      }
      if (j > i + 1) {
        names.push(pathPart.slice(i + 1, j));
        i = j;
        continue;
      }
    }
    i++;
  }
  return names;
}

/**
 * Sample URL filling :name with 1, *name with a/b, and unescaping \x.
 * If the pattern has its own http(s):// host, it keeps it; otherwise origin goes in front.
 */
export function sampleUrl(pattern: string, origin: string): string {
  let base: string;
  let pathStart = 0;

  if (/^https?:\/\//i.test(pattern)) {
    base = pattern;
    const schemeIdx = pattern.indexOf('://');
    const slashIdx = pattern.indexOf('/', schemeIdx + 3);
    pathStart = slashIdx !== -1 ? slashIdx : pattern.length;
  } else {
    if (origin) {
      const orig = origin.replace(/\/+$/, '');
      const pat = pattern.startsWith('/') ? pattern : `/${pattern}`;
      base = orig + pat;
      pathStart = orig.length;
    } else {
      base = pattern;
      pathStart = 0;
    }
  }

  const prefix = base.slice(0, pathStart);
  const toProcess = base.slice(pathStart);

  let result = '';
  let i = 0;
  while (i < toProcess.length) {
    const ch = toProcess[i] ?? '';
    if (ch === '\\' && i + 1 < toProcess.length) {
      result += toProcess[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (ch === ':') {
      let j = i + 1;
      while (j < toProcess.length && /[a-zA-Z0-9_]/.test(toProcess[j] ?? '')) {
        j++;
      }
      if (j > i + 1) {
        result += '1';
        i = j;
        continue;
      }
    }
    if (ch === '*') {
      let j = i + 1;
      while (j < toProcess.length && /[a-zA-Z0-9_]/.test(toProcess[j] ?? '')) {
        j++;
      }
      if (j > i + 1) {
        result += 'a/b';
        i = j;
        continue;
      }
    }
    result += ch;
    i++;
  }

  return prefix + result;
}

function isInsideString(text: string): boolean {
  let inQuote: string | null = null;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      }
    } else if (ch === "'" || ch === '"' || ch === '`') {
      inQuote = ch;
    }
  }
  return inQuote !== null;
}

const REQ_OPTIONS: CodeCompletionOption[] = [
  { label: 'method', detail: 'HTTP method (GET, POST, ...)' },
  { label: 'url', detail: 'Full request URL' },
  { label: 'path', detail: 'URL pathname' },
  { label: 'params', detail: 'Route parameters from the pattern' },
  { label: 'query', detail: 'Query parameters object' },
  { label: 'headers', detail: 'Request headers object' },
  { label: 'body', detail: 'Parsed JSON body or string' },
  { label: 'bodyText', detail: 'Raw request body text' },
  { label: 'callCount', detail: 'Call count for this mock' },
];

const RES_OPTIONS: CodeCompletionOption[] = [
  { label: 'status', detail: 'HTTP status code (200-599)' },
  { label: 'headers', detail: 'Response headers object' },
  { label: 'delayMs', detail: 'Delay before response in ms' },
];

const BARE_OPTIONS: CodeCompletionOption[] = [
  { label: 'req', detail: 'Request object' },
  { label: 'res', detail: 'Response template' },
  { label: 'params', detail: 'Route parameters (req.params)' },
  { label: 'query', detail: 'Query parameters (req.query)' },
  { label: 'body', detail: 'Request body (req.body)' },
];

/**
 * Autocompletions for code mock handler editors.
 */
export function codeCompletions(
  textBefore: string,
  paramNames: string[],
): CodeCompletionsResult | null {
  if (isInsideString(textBefore)) {
    return null;
  }

  const match = textBefore.match(/([a-zA-Z0-9_$]*)$/);
  const word = match?.[1] ?? '';
  const from = textBefore.length - word.length;
  const prefix = textBefore.slice(0, from);

  if (
    /(?:^|[^a-zA-Z0-9_$.])req\.params\.$/.test(prefix) ||
    /(?:^|[^a-zA-Z0-9_$.])params\.$/.test(prefix)
  ) {
    if (paramNames.length === 0) return null;
    return {
      from,
      options: paramNames.map((name) => ({
        label: name,
        detail: 'URL parameter from pattern',
      })),
    };
  }

  if (/(?:^|[^a-zA-Z0-9_$.])req\.$/.test(prefix)) {
    return {
      from,
      options: REQ_OPTIONS,
    };
  }

  if (/(?:^|[^a-zA-Z0-9_$.])res\.$/.test(prefix)) {
    return {
      from,
      options: RES_OPTIONS,
    };
  }

  if (prefix.endsWith('.')) {
    return null;
  }

  if (word.length > 0 && /^[a-zA-Z]/.test(word)) {
    if (from === 0 || /[\s(=]$/.test(prefix)) {
      return {
        from,
        options: BARE_OPTIONS,
      };
    }
  }

  return null;
}
