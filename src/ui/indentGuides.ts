import { getIndentUnit } from '@codemirror/language';
import { RangeSetBuilder, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

function indentColumns(line: string, unit: number): number {
  let columns = 0;
  for (const ch of line) {
    if (ch === ' ') columns += 1;
    else if (ch === '\t') columns += unit;
    else break;
  }
  return columns;
}

function nearestDepth(depths: number[], index: number, step: number): number {
  for (let i = index + step; i >= 0 && i < depths.length; i += step) {
    const depth = depths[i]!;
    if (depth >= 0) return depth;
  }
  return 0;
}

export function indentDepths(lines: readonly string[], unit: number): number[] {
  const depths = lines.map((line) => (line.trim() ? Math.floor(indentColumns(line, unit) / unit) : -1));
  return depths.map((depth, i) =>
    depth >= 0 ? depth : Math.max(nearestDepth(depths, i, -1), nearestDepth(depths, i, 1)),
  );
}

const guideLines = new Map<string, Decoration>();

function guideLine(depth: number, unit: number): Decoration {
  const key = `${depth}/${unit}`;
  let decoration = guideLines.get(key);
  if (!decoration) {
    decoration = Decoration.line({
      class: 'cm-indent-guides',
      attributes: { style: `--wm-guides: ${depth}; --wm-indent: ${unit}` },
    });
    guideLines.set(key, decoration);
  }
  return decoration;
}

function outwardToText(doc: Text, lineNumber: number, step: number): number {
  let n = lineNumber;
  while (!doc.line(n).text.trim() && n + step >= 1 && n + step <= doc.lines) n += step;
  return n;
}

function guideDecorations(view: EditorView): DecorationSet {
  const { doc } = view.state;
  const unit = getIndentUnit(view.state);
  const builder = new RangeSetBuilder<Decoration>();
  let lastLine = 0;
  for (const { from, to } of view.visibleRanges) {
    const first = Math.max(doc.lineAt(from).number, lastLine + 1);
    const last = doc.lineAt(to).number;
    if (first > last) continue;
    const start = outwardToText(doc, first, -1);
    const end = outwardToText(doc, last, 1);
    const texts: string[] = [];
    for (let n = start; n <= end; n++) texts.push(doc.line(n).text);
    const depths = indentDepths(texts, unit);
    for (let n = first; n <= last; n++) {
      const depth = depths[n - start]!;
      if (depth > 0) builder.add(doc.line(n).from, doc.line(n).from, guideLine(depth, unit));
    }
    lastLine = last;
  }
  return builder.finish();
}

export function indentGuides() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = guideDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = guideDecorations(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
