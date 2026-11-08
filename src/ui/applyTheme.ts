/**
 * Sets the `dark` class that the dark-only CSS rules hang on.
 * Inside DevTools the DevTools theme decides; elsewhere (the popup, or the
 * panel opened as a page) the system colour scheme decides, and is followed live.
 */
export function applyTheme(doc: Document = document): void {
  const set = (dark: boolean) => {
    doc.documentElement.classList.toggle('dark', dark);
    doc.body?.classList.toggle('dark', dark);
  };
  const devtoolsTheme =
    typeof browser !== 'undefined' ? browser.devtools?.panels?.themeName : undefined;
  if (devtoolsTheme) {
    set(devtoolsTheme === 'dark');
    return;
  }
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  set(media?.matches ?? false);
  media?.addEventListener('change', (e) => set(e.matches));
}
