import { useEffect, useRef } from 'react';
import type { LogEntry } from '../core/types';

export interface LogTableProps {
  entries: LogEntry[];
  selectedEntryId: string | null;
  onSelectEntry: (entry: LogEntry) => void;
}

function extractPath(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    return parsed.pathname || '/';
  } catch {
    const [path] = urlStr.split('?');
    return path || urlStr;
  }
}

export function LogTable({ entries, selectedEntryId, onSelectEntry }: LogTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const tolerance = 20;
    wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= tolerance;
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries]);

  return (
    <div
      ref={containerRef}
      className="log-table-container"
      onScroll={handleScroll}
    >
      <table className="log-table">
        <thead>
          <tr>
            <th className="log-th-method">Method</th>
            <th className="log-th-path">Path</th>
            <th className="log-th-status">Status</th>
            <th className="log-th-duration">Duration</th>
            <th className="log-th-badge">Type</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr className="empty-row">
              <td colSpan={5} className="empty-cell">
                No requests recorded
              </td>
            </tr>
          ) : (
            entries.map((entry) => {
              const isSelected = entry.id === selectedEntryId;
              const path = extractPath(entry.url);
              return (
                <tr
                  key={entry.id}
                  data-testid="log-row"
                  tabIndex={0}
                  aria-selected={isSelected ? 'true' : undefined}
                  className={`log-row ${isSelected ? 'selected' : ''}`}
                  onClick={() => onSelectEntry(entry)}
                  onKeyDown={(e) => {
                    const target = e.target as HTMLElement | null;
                    if (target?.closest('input, select, textarea, button')) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectEntry(entry);
                    }
                  }}
                >
                  <td className="log-col-method">{entry.method}</td>
                  <td className="log-col-path monospace" title={entry.url}>
                    {path}
                  </td>
                  {/* A6: a socket message has no status; 0 there is not a failure. */}
                  <td
                    className={`log-col-status ${
                      entry.method.startsWith('WS ') ? '' : entry.status >= 400 || entry.status === 0 ? 'status-error' : ''
                    }`}
                  >
                    {entry.method.startsWith('WS ') && entry.status === 0 ? '—' : entry.status}
                  </td>
                  <td className="log-col-duration">{Math.round(entry.durationMs)} ms</td>
                  <td className="log-col-badge">
                    <span className={`log-badge badge-${entry.badge.toLowerCase()}`}>
                      {entry.badge}
                    </span>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export default LogTable;
