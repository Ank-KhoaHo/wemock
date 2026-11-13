import { bytesToBase64 } from './bodies';
import { compilePattern } from './match';
import { isValidStatus } from './statusText';
import { type HttpMethod, type Mock, newProject, type Project } from './types';

export type MockFileShape = 'export-v2' | 'store-v1' | 'mock-file';

export interface MockFileImport {
  shape: MockFileShape;
  project: Project;
  summary: {
    mocks: number;
    /** Mocks dropped: no URL, a pattern wemock cannot use, or a status outside 200-599. */
    mocksSkipped: number;
    /** Function mocks, imported as code mocks. */
    codeMocks: number;
    headerRulesSkipped: number;
  };
}

const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY']);

export function detectMockFile(data: unknown): MockFileShape | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  // Wemock export file check
  if ('wemock' in data) {
    return null;
  }

  // Mock-file array check
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return null;
    }
    const first = data[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const rec = first as Record<string, unknown>;
      if (
        'schema_version' in rec ||
        'url_pattern' in rec ||
        'endpoint' in rec ||
        'response_body_type' in rec
      ) {
        return 'mock-file';
      }
    }
    return null;
  }

  const obj = data as Record<string, unknown>;

  // Export v2: has both projects array and mocks array
  if ('projects' in obj && Array.isArray(obj.projects) && 'mocks' in obj && Array.isArray(obj.mocks)) {
    return 'export-v2';
  }

  // Store v1: has mocks array without projects
  if ('mocks' in obj && Array.isArray(obj.mocks) && !('projects' in obj)) {
    return 'store-v1';
  }

  // Single mock file: schema_version: 1 or specific mock-file fields
  if (
    ('schema_version' in obj && obj.schema_version === 1) ||
    'response_body_type' in obj ||
    ('url_pattern' in obj && 'response' in obj) ||
    ('endpoint' in obj && 'response' in obj)
  ) {
    return 'mock-file';
  }

  return null;
}

export function mockFileUrlToPattern(url: string): string {
  if (typeof url !== 'string') return '';
  let cleaned = url.trim();
  if (!cleaned) return '';

  // Drop query parameters and hash
  const qIdx = cleaned.indexOf('?');
  if (qIdx !== -1) {
    cleaned = cleaned.slice(0, qIdx);
  }
  const hIdx = cleaned.indexOf('#');
  if (hIdx !== -1) {
    cleaned = cleaned.slice(0, hIdx);
  }

  // Handle host without protocol: keep path only
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
    // Has protocol: keep full URL
  } else if (cleaned.startsWith('/')) {
    // Already an absolute path
  } else {
    // Starts with host without protocol or relative pattern
    const slashIdx = cleaned.indexOf('/');
    if (slashIdx !== -1) {
      cleaned = cleaned.slice(slashIdx);
    } else {
      if (cleaned.includes('.') || cleaned.includes(':')) {
        cleaned = '/';
      } else {
        cleaned = '/' + cleaned;
      }
    }
  }

  // Convert (.*) to *rest wildcard syntax compatible with path-to-regexp 8
  let wildcardIndex = 0;
  cleaned = cleaned.replace(/\(\.\*\)/g, () => {
    wildcardIndex++;
    return wildcardIndex === 1 ? '*rest' : `*rest${wildcardIndex}`;
  });

  return cleaned;
}

export function importMockFile(
  data: unknown,
  origin: string,
  newId: () => string,
  now: number,
): { ok: true; result: MockFileImport } | { ok: false; error: string } {
  try {
    const shape = detectMockFile(data);
    if (!shape) {
      return { ok: false, error: 'Unrecognized mock file format' };
    }

    const project = newProject(newId(), origin);
    const targetScenario = project.scenarios[0];
    if (!targetScenario) {
      return { ok: false, error: 'Failed to initialize default scenario' };
    }

    let headerRulesSkipped = 0;
    let rawMocks: unknown[] = [];

    if (shape === 'export-v2') {
      const v2 = data as {
        projects?: Array<{ name?: string }>;
        mocks?: unknown[];
        headers?: unknown[];
      };
      if (Array.isArray(v2.headers)) {
        headerRulesSkipped = v2.headers.length;
      }
      if (Array.isArray(v2.projects) && v2.projects[0] && typeof v2.projects[0].name === 'string') {
        const trimmed = v2.projects[0].name.trim();
        if (trimmed) {
          project.name = trimmed;
        }
      }
      if (Array.isArray(v2.mocks)) {
        rawMocks = v2.mocks;
      }
    } else if (shape === 'store-v1') {
      const v1 = data as { mocks?: unknown[] };
      if (Array.isArray(v1.mocks)) {
        rawMocks = v1.mocks;
      }
    } else {
      // mock-file: single object or array
      rawMocks = Array.isArray(data) ? data : [data];
    }

    let codeMocks = 0;
    let mocksSkipped = 0;
    const keptMocks: Mock[] = [];

    for (const item of rawMocks) {
      if (!item || typeof item !== 'object') {
        mocksSkipped++;
        continue;
      }
      const m = item as Record<string, unknown>;

      // Extract raw URL: url_pattern (REST), endpoint (GraphQL), or url
      const rawUrl =
        typeof m.url_pattern === 'string'
          ? m.url_pattern
          : typeof m.endpoint === 'string'
            ? m.endpoint
            : typeof m.url === 'string'
              ? m.url
              : undefined;

      if (!rawUrl || !rawUrl.trim()) {
        mocksSkipped++;
        continue;
      }

      const urlPattern = mockFileUrlToPattern(rawUrl);
      if (!urlPattern) {
        mocksSkipped++;
        continue;
      }

      const patternCheck = compilePattern(urlPattern);
      if (!patternCheck.ok) {
        mocksSkipped++;
        continue;
      }

      // Extract response status
      const resObj =
        m.response && typeof m.response === 'object' && !Array.isArray(m.response)
          ? (m.response as Record<string, unknown>)
          : undefined;

      const rawStatus = resObj?.status !== undefined ? resObj.status : m.status;
      const status = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus);
      if (!isValidStatus(status)) {
        mocksSkipped++;
        continue;
      }

      // GraphQL operation
      const rawOp = m.operation_name ?? m.operationName;
      const graphqlOperation =
        typeof rawOp === 'string' && rawOp.trim().length > 0 ? rawOp.trim() : undefined;

      const isGraphQL =
        m.type === 'graphql' || m.requestType === 'GRAPHQL' || Boolean(graphqlOperation);

      // Method: uppercase, defaults to POST for GraphQL if missing, otherwise GET
      let rawMethod = typeof m.method === 'string' ? m.method.trim().toUpperCase() : '';
      if (!rawMethod) {
        rawMethod = isGraphQL ? 'POST' : 'GET';
      }
      const method: HttpMethod = VALID_METHODS.has(rawMethod) ? (rawMethod as HttpMethod) : 'GET';

      // Function mock detection
      // The function runs only when its source is not empty; otherwise it serves the
      // static response. 2.x also says which in responseType, and a STATIC mock may keep old source.
      const source =
        typeof m.function === 'string' && m.function.trim().length > 0
          ? m.function
          : typeof m.function_source === 'string' && m.function_source.trim().length > 0
            ? m.function_source
            : '';
      const isFunctionMock =
        source.length > 0 && (typeof m.responseType === 'string' ? m.responseType === 'FUNCTION' : true);

      const enabled = m.active !== false && m.enabled !== false;
      if (isFunctionMock) {
        codeMocks++;
      }

      // Delay ms
      const rawDelay = resObj?.delay_ms ?? m.delay_ms ?? m.delay ?? 0;
      const delayMs = Math.max(0, typeof rawDelay === 'number' ? rawDelay : Number(rawDelay) || 0);

      // Name
      const name =
        typeof m.name === 'string' && m.name.trim().length > 0 ? m.name.trim() : undefined;

      // Headers mapping: array of { name, value } or object of { key: value }
      const headers: Record<string, string> = {};
      const rawHeaders =
        shape === 'mock-file' && resObj?.headers !== undefined ? resObj.headers : m.headers;

      if (Array.isArray(rawHeaders)) {
        for (const h of rawHeaders) {
          if (h && typeof h === 'object') {
            const hRec = h as Record<string, unknown>;
            if (typeof hRec.name === 'string' && hRec.value !== undefined && hRec.value !== null) {
              headers[hRec.name.toLowerCase()] = String(hRec.value);
            }
          }
        }
      } else if (rawHeaders && typeof rawHeaders === 'object') {
        for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) {
          if (v !== undefined && v !== null) {
            headers[k.toLowerCase()] = String(v);
          }
        }
      }

      // Body and BodyEncoding
      const rawBodyType =
        resObj?.response_body_type ?? m.response_body_type ?? m.responseBodyType;
      const isBinary = rawBodyType === 'binary';

      const rawBody =
        resObj?.body !== undefined
          ? resObj.body
          : m.response !== undefined
            ? m.response
            : m.body;

      let body = '';
      const bodyEncoding: 'text' | 'base64' = isBinary ? 'base64' : 'text';

      if (isBinary) {
        if (typeof rawBody === 'string') {
          body = rawBody;
        } else if (rawBody instanceof Uint8Array) {
          body = bytesToBase64(rawBody);
        } else if (Array.isArray(rawBody) && rawBody.every((n) => typeof n === 'number')) {
          body = bytesToBase64(new Uint8Array(rawBody as number[]));
        } else if (rawBody !== undefined && rawBody !== null) {
          body = String(rawBody);
        }
      } else {
        if (typeof rawBody === 'object' && rawBody !== null) {
          body = JSON.stringify(rawBody);
        } else if (typeof rawBody === 'string') {
          body = rawBody;
        } else if (rawBody !== undefined && rawBody !== null) {
          body = String(rawBody);
        }
      }

      keptMocks.push({
        id: newId(),
        name,
        enabled,
        method,
        urlPattern,
        graphqlOperation,
        response: {
          status,
          headers,
          body,
          bodyEncoding,
          delayMs,
        },
        ...(isFunctionMock ? { reply: 'code' as const, code: source } : {}),
        source: 'manual',
        createdAt: now,
      });
    }

    targetScenario.mocks = keptMocks;

    return {
      ok: true,
      result: {
        shape,
        project,
        summary: {
          mocks: keptMocks.length,
          mocksSkipped,
          codeMocks,
          headerRulesSkipped,
        },
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
