export type SiteStatus = 'on' | 'site-off' | 'mocking-off' | 'unknown';

export function siteStatus(tabUrl: string, enabledOrigins: string[], enabled: boolean): SiteStatus {
  if (!tabUrl) {
    return 'unknown';
  }

  let parsed: URL;
  try {
    parsed = new URL(tabUrl);
  } catch {
    return 'unknown';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'unknown';
  }

  const isLocalHttp =
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');

  const isOriginEnabled = enabledOrigins.includes(parsed.origin);

  const siteOn = isLocalHttp || isOriginEnabled;

  if (!siteOn) {
    return 'site-off';
  }

  if (!enabled) {
    return 'mocking-off';
  }

  return 'on';
}
