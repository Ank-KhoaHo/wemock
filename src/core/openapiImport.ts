import { parse as parseYaml } from 'yaml';
import { type HttpMethod, type Mock, newProject, type Project, type Scenario } from './types';

export interface OpenApiSummary {
  mocks: number;
  operations: number;
}

export type OpenApiImportResult =
  | {
      ok: true;
      result: {
        project: Project;
        summary: OpenApiSummary;
      };
    }
  | {
      ok: false;
      error: string;
    };

export function parseSpecText(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    try {
      const doc = parseYaml(text);
      return doc ?? null;
    } catch {
      return null;
    }
  }
}

export function detectOpenApi(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  const isOpenApi3 = typeof obj.openapi === 'string' && obj.openapi.startsWith('3');
  const isSwagger2 = obj.swagger === '2.0';
  if (!isOpenApi3 && !isSwagger2) {
    return false;
  }
  if (!('paths' in obj) || !obj.paths || typeof obj.paths !== 'object' || Array.isArray(obj.paths)) {
    return false;
  }
  return true;
}

function resolveRef(ref: string, root: unknown): unknown {
  if (!ref.startsWith('#/')) {
    return null;
  }
  const parts = ref
    .slice(2)
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));

  let cur: unknown = root;
  for (const part of parts) {
    if (!cur || typeof cur !== 'object') {
      return null;
    }
    cur = (cur as Record<string, unknown>)[part];
    if (cur === undefined) {
      return null;
    }
  }
  return cur ?? null;
}

export function sampleFromSchema(schema: unknown, root: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== 'object') {
    return null;
  }

  let s = schema as Record<string, unknown>;

  if ('example' in s && s.example !== undefined) {
    return s.example;
  }
  if ('default' in s && s.default !== undefined) {
    return s.default;
  }
  if (Array.isArray(s.enum) && s.enum.length > 0) {
    return s.enum[0];
  }

  const seenRefs = new Set<string>();
  while (typeof s.$ref === 'string') {
    if (seenRefs.has(s.$ref)) {
      return null;
    }
    seenRefs.add(s.$ref);
    const target = resolveRef(s.$ref, root);
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      return null;
    }
    s = target as Record<string, unknown>;
  }

  if ('example' in s && s.example !== undefined) {
    return s.example;
  }
  if ('default' in s && s.default !== undefined) {
    return s.default;
  }
  if (Array.isArray(s.enum) && s.enum.length > 0) {
    return s.enum[0];
  }

  if (Array.isArray(s.allOf) && s.allOf.length > 0) {
    if (depth >= 6) {
      return null;
    }
    const merged: Record<string, unknown> = {};
    for (const part of s.allOf) {
      const partSample = sampleFromSchema(part, root, depth);
      if (partSample && typeof partSample === 'object' && !Array.isArray(partSample)) {
        Object.assign(merged, partSample);
      }
    }
    if (s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties)) {
      for (const [propName, propSchema] of Object.entries(s.properties)) {
        merged[propName] = sampleFromSchema(propSchema, root, depth + 1);
      }
    }
    return merged;
  }

  if (Array.isArray(s.oneOf) && s.oneOf.length > 0) {
    return sampleFromSchema(s.oneOf[0], root, depth);
  }
  if (Array.isArray(s.anyOf) && s.anyOf.length > 0) {
    return sampleFromSchema(s.anyOf[0], root, depth);
  }

  const rawType = s.type;
  const type = Array.isArray(rawType) ? rawType[0] : rawType;

  if (type === 'object' || (!type && s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties))) {
    if (depth >= 6) {
      return null;
    }
    const obj: Record<string, unknown> = {};
    if (s.properties && typeof s.properties === 'object' && !Array.isArray(s.properties)) {
      for (const [propName, propSchema] of Object.entries(s.properties)) {
        obj[propName] = sampleFromSchema(propSchema, root, depth + 1);
      }
    }
    return obj;
  }

  if (type === 'array') {
    if (depth >= 6) {
      return null;
    }
    if (s.items && typeof s.items === 'object') {
      const itemSample = sampleFromSchema(s.items, root, depth + 1);
      return [itemSample];
    }
    return [];
  }

  if (type === 'string') {
    const format = typeof s.format === 'string' ? s.format.toLowerCase() : '';
    if (format === 'date-time') {
      return '2026-01-01T00:00:00Z';
    }
    if (format === 'date') {
      return '2026-01-01';
    }
    if (format === 'email') {
      return 'user@example.com';
    }
    if (format === 'uuid') {
      return '00000000-0000-4000-8000-000000000000';
    }
    if (format === 'uri' || format === 'url') {
      return 'https://example.com';
    }
    return 'string';
  }

  if (type === 'integer' || type === 'number') {
    if (typeof s.minimum === 'number') {
      return s.minimum;
    }
    return 0;
  }

  if (type === 'boolean') {
    return true;
  }

  if (type === 'null') {
    return null;
  }

  return null;
}

function extractBasePath(doc: Record<string, unknown>): string {
  let raw = '';
  if (typeof doc.openapi === 'string' && doc.openapi.startsWith('3')) {
    if (Array.isArray(doc.servers) && doc.servers.length > 0) {
      const first = doc.servers[0];
      if (first && typeof first === 'object') {
        const urlVal = (first as Record<string, unknown>).url;
        if (typeof urlVal === 'string') {
          const u = urlVal.trim();
          if (u) {
            try {
              if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u)) {
                raw = new URL(u).pathname;
              } else {
                raw = new URL(u, 'http://dummy.test').pathname;
              }
            } catch {
              raw = u;
            }
          }
        }
      }
    }
  } else if (doc.swagger === '2.0') {
    if (typeof doc.basePath === 'string') {
      raw = doc.basePath.trim();
    }
  }

  if (raw && !raw.startsWith('/')) {
    raw = '/' + raw;
  }
  while (raw.endsWith('/')) {
    raw = raw.slice(0, -1);
  }
  return raw;
}

function isJsonMediaType(mediaType: string): boolean {
  const mime = mediaType.toLowerCase().split(';')[0]?.trim() ?? '';
  return mime === 'application/json' || mime.endsWith('+json');
}

const OPERATION_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options']);

export function importOpenApi(
  doc: unknown,
  pageOrigin: string,
  newId: () => string,
  now: number,
): OpenApiImportResult {
  if (!detectOpenApi(doc)) {
    return { ok: false, error: 'Unrecognized OpenAPI format' };
  }

  const docObj = doc as Record<string, unknown>;
  const isOpenApi3 = typeof docObj.openapi === 'string' && docObj.openapi.startsWith('3');
  const basePath = extractBasePath(docObj);

  const pathsObj = docObj.paths as Record<string, unknown>;
  const mocks: Mock[] = [];
  let operations = 0;

  for (const path of Object.keys(pathsObj)) {
    const pathItem = pathsObj[path];
    if (!pathItem || typeof pathItem !== 'object' || Array.isArray(pathItem)) {
      continue;
    }

    const pathRec = pathItem as Record<string, unknown>;
    for (const opKey of Object.keys(pathRec)) {
      const lowerKey = opKey.toLowerCase();
      if (!OPERATION_METHODS.has(lowerKey)) {
        continue;
      }

      const opVal = pathRec[opKey];
      if (!opVal || typeof opVal !== 'object' || Array.isArray(opVal)) {
        continue;
      }

      operations++;
      const opObj = opVal as Record<string, unknown>;
      const method = lowerKey.toUpperCase() as HttpMethod;
      const normalizedPath = path.replace(/\{([^}]+)\}/g, ':$1');
      const pattern = basePath + normalizedPath;

      let name = '';
      if (typeof opObj.operationId === 'string' && opObj.operationId.trim()) {
        name = opObj.operationId.trim();
      } else if (typeof opObj.summary === 'string' && opObj.summary.trim()) {
        name = opObj.summary.trim();
      } else {
        name = `${method} ${path}`;
      }

      // Response: lowest 2xx code present, else default (200), else 200 with empty body and no headers
      let chosenKey: string | null = null;
      let chosenStatus = 200;

      const responses = opObj.responses;
      if (responses && typeof responses === 'object' && !Array.isArray(responses)) {
        const respRec = responses as Record<string, unknown>;
        const codes2xx: { key: string; code: number }[] = [];
        for (const k of Object.keys(respRec)) {
          const n = Number(k);
          if (!Number.isNaN(n) && n >= 200 && n <= 299) {
            codes2xx.push({ key: k, code: n });
          }
        }
        if (codes2xx.length > 0) {
          codes2xx.sort((a, b) => a.code - b.code);
          chosenKey = codes2xx[0]!.key;
          chosenStatus = codes2xx[0]!.code;
        } else if ('default' in respRec) {
          chosenKey = 'default';
          chosenStatus = 200;
        }
      }

      let body = '';
      const headers: Record<string, string> = {};

      if (chosenKey !== null && responses && typeof responses === 'object') {
        let respObj = (responses as Record<string, unknown>)[chosenKey];
        const seenRespRefs = new Set<string>();
        while (respObj && typeof respObj === 'object' && typeof (respObj as Record<string, unknown>).$ref === 'string') {
          const ref = (respObj as Record<string, unknown>).$ref as string;
          if (seenRespRefs.has(ref)) break;
          seenRespRefs.add(ref);
          const target = resolveRef(ref, doc);
          if (!target || typeof target !== 'object') break;
          respObj = target;
        }

        if (isOpenApi3) {
          if (
            respObj &&
            typeof respObj === 'object' &&
            'content' in respObj &&
            respObj.content &&
            typeof respObj.content === 'object' &&
            !Array.isArray(respObj.content)
          ) {
            const content = respObj.content as Record<string, unknown>;
            const contentKeys = Object.keys(content);
            if (contentKeys.length > 0) {
              const jsonKey = contentKeys.find(
                (k) => k.toLowerCase().split(';')[0]?.trim() === 'application/json',
              );
              const mediaType = jsonKey || contentKeys[0]!;
              const mediaObj = content[mediaType];

              if (mediaObj && typeof mediaObj === 'object' && !Array.isArray(mediaObj)) {
                const mo = mediaObj as Record<string, unknown>;
                let bodyVal: unknown = undefined;
                let hasBodySource = false;

                if ('example' in mo && mo.example !== undefined) {
                  bodyVal = mo.example;
                  hasBodySource = true;
                } else if (
                  'examples' in mo &&
                  mo.examples &&
                  typeof mo.examples === 'object' &&
                  !Array.isArray(mo.examples)
                ) {
                  const exKeys = Object.keys(mo.examples);
                  if (exKeys.length > 0) {
                    const firstEx = (mo.examples as Record<string, unknown>)[exKeys[0]!];
                    if (firstEx && typeof firstEx === 'object' && !Array.isArray(firstEx) && 'value' in firstEx) {
                      bodyVal = (firstEx as Record<string, unknown>).value;
                    } else {
                      bodyVal = firstEx;
                    }
                    hasBodySource = true;
                  }
                }

                if (!hasBodySource && 'schema' in mo && mo.schema !== undefined) {
                  bodyVal = sampleFromSchema(mo.schema, doc);
                  hasBodySource = true;
                }

                if (hasBodySource) {
                  headers['content-type'] = mediaType;
                  if (!isJsonMediaType(mediaType) && typeof bodyVal === 'string') {
                    body = bodyVal;
                  } else {
                    body = bodyVal !== undefined ? (JSON.stringify(bodyVal, null, 2) ?? '') : '';
                  }
                }
              }
            }
          }
        } else {
          // Swagger 2
          let mediaType = 'application/json';
          if (Array.isArray(opObj.produces) && opObj.produces.length > 0 && typeof opObj.produces[0] === 'string') {
            mediaType = opObj.produces[0];
          } else if (
            Array.isArray(docObj.produces) &&
            docObj.produces.length > 0 &&
            typeof docObj.produces[0] === 'string'
          ) {
            mediaType = docObj.produces[0];
          }

          if (respObj && typeof respObj === 'object') {
            const ro = respObj as Record<string, unknown>;
            let bodyVal: unknown = undefined;
            let hasBodySource = false;

            if (ro.examples && typeof ro.examples === 'object' && !Array.isArray(ro.examples)) {
              const ex = ro.examples as Record<string, unknown>;
              if (mediaType in ex && ex[mediaType] !== undefined) {
                bodyVal = ex[mediaType];
                hasBodySource = true;
              } else {
                const exKeys = Object.keys(ex);
                if (exKeys.length > 0) {
                  bodyVal = ex[exKeys[0]!];
                  hasBodySource = true;
                }
              }
            }

            if (!hasBodySource && 'schema' in ro && ro.schema !== undefined) {
              bodyVal = sampleFromSchema(ro.schema, doc);
              hasBodySource = true;
            }

            if (hasBodySource) {
              headers['content-type'] = mediaType;
              if (!isJsonMediaType(mediaType) && typeof bodyVal === 'string') {
                body = bodyVal;
              } else {
                body = bodyVal !== undefined ? (JSON.stringify(bodyVal, null, 2) ?? '') : '';
              }
            }
          }
        }
      }

      mocks.push({
        id: newId(),
        name,
        enabled: true,
        method,
        urlPattern: pattern,
        response: {
          status: chosenStatus,
          headers,
          body,
          bodyEncoding: 'text',
          delayMs: 0,
        },
        source: 'manual',
        createdAt: now,
      });
    }
  }

  if (operations === 0) {
    return { ok: false, error: 'This OpenAPI file has no operations' };
  }

  const project = newProject(newId(), pageOrigin);
  let infoTitle = 'OpenAPI';
  if (docObj.info && typeof docObj.info === 'object') {
    const rawTitle = (docObj.info as Record<string, unknown>).title;
    if (typeof rawTitle === 'string' && rawTitle.trim()) {
      infoTitle = rawTitle.trim();
    }
  }

  const scenarioId = newId();
  const scenario: Scenario = {
    id: scenarioId,
    name: infoTitle,
    mocks,
  };
  project.scenarios.push(scenario);
  project.activeScenarioId = scenarioId;

  return {
    ok: true,
    result: {
      project,
      summary: {
        mocks: mocks.length,
        operations,
      },
    },
  };
}

export function openApiSummaryText(summary: { mocks: number; operations: number }): string {
  const mockPart = `${summary.mocks} mock${summary.mocks === 1 ? '' : 's'}`;
  const opPart = `${summary.operations} operation${summary.operations === 1 ? '' : 's'}`;
  return `${mockPart} from ${opPart}`;
}
