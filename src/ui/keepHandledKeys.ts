import { ViewPlugin } from '@codemirror/view';

/**
 * DevTools forwards the panel's shortcut keys to itself from a listener on the document, even keys the
 * page already used, so Ctrl+F in the editor would also open DevTools' own find bar. A key the editor
 * used stops at the editor.
 */
export function keepHandledKeys() {
  return ViewPlugin.define((view) => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) e.stopPropagation();
    };
    view.dom.addEventListener('keydown', onKeyDown);
    return { destroy: () => view.dom.removeEventListener('keydown', onKeyDown) };
  });
}
