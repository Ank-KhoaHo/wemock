export function getInspectedTabId(): number {
  if (typeof browser !== 'undefined' && browser.devtools?.inspectedWindow?.tabId) {
    return browser.devtools.inspectedWindow.tabId;
  }
  let search = '';
  if (typeof window !== 'undefined' && window.location?.search) {
    search = window.location.search;
  } else if (typeof location !== 'undefined' && location.search) {
    search = location.search;
  }
  if (search) {
    const params = new URLSearchParams(search);
    const tabIdParam = params.get('tabId');
    if (tabIdParam) {
      const parsed = Number(tabIdParam);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return 0;
}
