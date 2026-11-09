// Spec A2. The script of the Worker that runs one code mock, then is thrown away.
// It is a string because it starts from a blob: URL inside the sandbox page,
// whose CSP allows eval; extension pages and workers never do.
//
// Message in:  { code, input: HandlerInput }
// Message out: { ok: true, kind, value, res } | { ok: false, error }
//   kind 'bytes' carries a Uint8Array; the sandbox page turns it into base64.
export const WORKER_SOURCE = `
'use strict';
self.onmessage = async (event) => {
  const { code, input } = event.data;
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const req = input.req;
    const res = input.res;
    const fn = new AsyncFunction('req', 'res', 'params', 'query', 'body', 'urlParams', 'searchQuery', code);
    const value = await fn(req, res, req.params, req.query, req.body, req.params, req.query);
    let kind = 'json';
    let out;
    if (value === undefined) {
      kind = 'undefined';
    } else if (typeof value === 'string') {
      kind = 'string';
      out = value;
    } else if (value instanceof ArrayBuffer) {
      kind = 'bytes';
      out = new Uint8Array(value);
    } else if (ArrayBuffer.isView(value)) {
      kind = 'bytes';
      out = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else {
      out = JSON.stringify(value);
      if (out === undefined) throw new Error('The return value cannot be written as JSON');
    }
    const plainRes = { status: res && res.status, headers: res && res.headers, delayMs: res && res.delayMs };
    self.postMessage({ ok: true, kind, value: out, res: JSON.parse(JSON.stringify(plainRes)) });
  } catch (err) {
    const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
    self.postMessage({ ok: false, error: message || 'The code failed' });
  }
};
`;
