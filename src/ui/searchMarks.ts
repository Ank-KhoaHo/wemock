import { getSearchQuery, type SearchQuery, searchPanelOpen } from '@codemirror/search';
import type { EditorState, SelectionRange } from '@codemirror/state';
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

export const MAX_MATCHES = 1000;

export interface Match {
  from: number;
  to: number;
}

export interface Matches {
  list: Match[];
  capped: boolean;
}

const NO_MATCHES: Matches = { list: [], capped: false };

export function findMatches(state: EditorState, query: SearchQuery): Matches {
  if (!query.valid) return NO_MATCHES;
  const list: Match[] = [];
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (list.length === MAX_MATCHES) return { list, capped: true };
    list.push({ from: next.value.from, to: next.value.to });
  }
  return { list, capped: false };
}

export function activeIndex({ list }: Matches, selection: SelectionRange): number {
  return list.findIndex((m) => m.from === selection.from && m.to === selection.to);
}

export function countLabel(matches: Matches, active: number): string {
  if (matches.list.length === 0) return 'No results';
  const total = matches.capped ? `${MAX_MATCHES}+` : String(matches.list.length);
  return `${active === -1 ? '?' : active + 1} of ${total}`;
}

/** Adds the match count to the find box and marks every match on a strip at the editor's right edge. */
class SearchMarks {
  private matches = NO_MATCHES;
  private marks: HTMLElement[] = [];
  private active = -1;
  private stale = false;
  private readonly count = document.createElement('span');
  private readonly strip = document.createElement('div');

  constructor(private readonly view: EditorView) {
    this.count.className = 'cm-search-count';
    this.count.setAttribute('aria-live', 'polite');
    this.strip.className = 'cm-match-strip';
    this.strip.setAttribute('aria-hidden', 'true');
    view.dom.appendChild(this.strip);
  }

  update(update: ViewUpdate) {
    const { state, startState } = update;
    const open = searchPanelOpen(state);
    const query = getSearchQuery(state);
    const changed =
      update.docChanged || open !== searchPanelOpen(startState) || !query.eq(getSearchQuery(startState));
    if (changed) this.matches = open ? findMatches(state, query) : NO_MATCHES;
    this.stale ||= changed || (update.heightChanged && this.marks.length > 0);
    if (this.stale || update.selectionSet) {
      // The find box is built by the search panel during this same update, so it is filled in afterwards.
      this.view.requestMeasure({ key: this, read: () => null, write: () => this.render(open && query.search !== '') });
    }
  }

  private render(showCount: boolean) {
    if (this.stale) this.placeMarks();
    this.stale = false;
    const active = activeIndex(this.matches, this.view.state.selection.main);
    this.marks[this.active]?.classList.remove('cm-match-mark-active');
    this.marks[active]?.classList.add('cm-match-mark-active');
    this.active = active;
    this.renderCount(showCount);
  }

  private placeMarks() {
    const height = this.view.contentHeight;
    this.marks = this.matches.list.map((match) => {
      const mark = document.createElement('div');
      mark.className = 'cm-match-mark';
      mark.style.top = `${(this.view.lineBlockAt(match.from).top / height) * 100}%`;
      return mark;
    });
    this.active = -1;
    this.strip.replaceChildren(...this.marks);
  }

  private renderCount(show: boolean) {
    if (!show) {
      this.count.remove();
      return;
    }
    if (!this.count.isConnected) this.view.dom.querySelector('.cm-search [main-field]')?.after(this.count);
    this.count.textContent = countLabel(this.matches, this.active);
    this.count.classList.toggle('cm-search-count-none', this.matches.list.length === 0);
  }

  destroy() {
    this.count.remove();
    this.strip.remove();
  }
}

export function searchMarks() {
  return ViewPlugin.fromClass(SearchMarks);
}
