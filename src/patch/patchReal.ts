import { bytesToBase64, isTextual } from '../core/bodies';
import { applyPatch } from '../core/patchResponse';
import type { Mock, MockResponse } from '../core/types';

export async function patchRealResponse(realRes: Response, mock: Mock): Promise<MockResponse> {
  const headersRecord: Record<string, string> = {};
  realRes.headers.forEach((val, key) => {
    headersRecord[key.toLowerCase()] = val;
  });
  // The body is already decoded here, so its old encoding no longer describes it.
  delete headersRecord['content-encoding'];

  const contentType = realRes.headers.get('content-type');
  const textual = isTextual(contentType);

  if (textual) {
    const text = await realRes.text();
    const patched = applyPatch(
      { status: realRes.status, headers: headersRecord, body: text },
      mock.patch ?? {},
    );
    return {
      status: patched.status,
      headers: patched.headers,
      body: patched.body,
      bodyEncoding: 'text',
      delayMs: mock.response.delayMs,
    };
  }

  const buf = await realRes.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const patched = applyPatch(
    { status: realRes.status, headers: headersRecord, body: '' },
    mock.patch ?? {},
  );
  return {
    status: patched.status,
    headers: patched.headers,
    body: bytesToBase64(bytes),
    bodyEncoding: 'base64',
    delayMs: mock.response.delayMs,
  };
}
