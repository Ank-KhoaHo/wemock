export function operationName(body?: string): string | null {
  if (!body || typeof body !== 'string') {
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }

  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return null;
  }

  const obj = json as Record<string, unknown>;

  if (typeof obj.operationName === 'string' && obj.operationName.trim().length > 0) {
    return obj.operationName;
  }

  if (typeof obj.query === 'string') {
    const match = obj.query.match(/(?:query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}
