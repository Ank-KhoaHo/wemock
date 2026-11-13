import { base64ToBytes } from '../core/bodies';
import { isValidStatus, statusTextFor } from '../core/statusText';
import type { LogEntry } from '../core/types';

export interface LogDetailProps {
  entry: LogEntry | null;
  onMockThis: (entry: LogEntry) => void;
  /** A6: turn the real socket connection this row opened into a socket mock. */
  onMockSocket?: (entry: LogEntry) => void;
  onClose?: () => void;
  answeredBy?: { label: string; scenarioName: string } | 'deleted' | null;
  onOpenMock?: () => void;
}

function formatResponseBody(entry: LogEntry): string {
  if (entry.truncated) {
    return 'not kept, over 1 MB';
  }
  if (entry.responseEncoding === 'base64') {
    if (entry.responseBody === null || entry.responseBody === undefined) {
      return 'binary, size unknown';
    }
    try {
      const bytes = base64ToBytes(entry.responseBody).length;
      return `binary, ${bytes} bytes`;
    } catch {
      return 'binary, size unknown';
    }
  }
  if (entry.responseBody !== null && entry.responseBody !== undefined) {
    try {
      const parsed = JSON.parse(entry.responseBody);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return entry.responseBody;
    }
  }
  return '';
}

function getMockDisabledReason(entry: LogEntry): string | undefined {
  if (entry.method.startsWith('WS')) {
    return 'Socket messages are mocked in the Sockets editor, not as HTTP mocks';
  }
  if (entry.truncated) {
    return 'Cannot mock truncated response (over 1 MB)';
  }
  if (!isValidStatus(entry.status)) {
    return `Cannot mock response with status outside 200-599 (${entry.status})`;
  }
  if (entry.badge === 'MOCK') {
    return 'Cannot mock already mocked response';
  }
  return undefined;
}

export function LogDetail({
  entry,
  onMockThis,
  onMockSocket,
  onClose,
  answeredBy,
  onOpenMock,
}: LogDetailProps) {
  if (!entry) {
    return (
      <div className="log-detail empty">
        <p className="empty-message">Select a request to view details</p>
      </div>
    );
  }

  const isSocket = entry.method.startsWith('WS');
  const disabledReason = getMockDisabledReason(entry);
  const isMockDisabled = Boolean(disabledReason);
  const formattedBody = formatResponseBody(entry);
  const statusText = statusTextFor(entry.status);
  const socketMessage = entry.method === 'WS ↑' ? entry.requestBody : entry.responseBody;

  return (
    <div className="log-detail">
      <div className="detail-header">
        <div className="detail-header-info">
          <span data-testid="detail-method" className="detail-method-tag">
            {entry.method}
          </span>
          <span
            data-testid="detail-url"
            className="detail-url monospace"
            title={entry.url}
          >
            {entry.url}
          </span>
        </div>
        <div className="detail-header-actions">
          {onMockSocket && entry.method === 'WS' && entry.status === 101 && entry.badge !== 'MOCK' && entry.connectionId && (
            <button
              type="button"
              data-testid="mock-socket"
              className="mock-this-button"
              title="Make a socket mock from this connection's messages"
              onClick={() => onMockSocket(entry)}
            >
              Mock this socket
            </button>
          )}
          {!isSocket && (
            <button
              type="button"
              data-testid="mock-this"
              className="mock-this-button"
              disabled={isMockDisabled}
              title={disabledReason || 'Create a mock from this call'}
              onClick={() => onMockThis(entry)}
            >
              Mock this
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="detail-close-btn"
              onClick={onClose}
              title="Close details"
              aria-label="Close details"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="detail-content">
        {entry.badge === 'MOCK' && answeredBy && (
          <div data-testid="answered-by" className="detail-answered-by">
            {answeredBy === 'deleted' ? (
              'Answered by a mock that was deleted'
            ) : (
              <>
                Answered by:{' '}
                <button
                  type="button"
                  data-testid="answered-by-link"
                  className="answered-by-link"
                  onClick={onOpenMock}
                >
                  {answeredBy.label}
                </button>
                {' · '}
                {answeredBy.scenarioName}
              </>
            )}
          </div>
        )}
        {entry.error && (
          <p data-testid="detail-error" className="log-error">
            Code failed: {entry.error}
          </p>
        )}
        <section className="detail-section">
          <h4 className="section-title">General</h4>
          <div className="key-value-grid">
            <span className="grid-key">Request URL:</span>
            <span className="grid-value monospace">{entry.url}</span>
            <span className="grid-key">Request Method:</span>
            <span className="grid-value">{entry.method}</span>
            <span className="grid-key">Status:</span>
            <span className="grid-value">
              {entry.status} {statusText}
            </span>
            <span className="grid-key">Duration:</span>
            <span className="grid-value">{Math.round(entry.durationMs)} ms</span>
            <span className="grid-key">Badge:</span>
            <span className="grid-value">
              <span className={`log-badge badge-${entry.badge.toLowerCase()}`}>
                {entry.badge}
              </span>
            </span>
          </div>
        </section>

        {isSocket ? (
          socketMessage !== null && socketMessage !== undefined && socketMessage !== '' ? (
            <section className="detail-section">
              <h4 className="section-title">
                {entry.method === 'WS ↑' ? 'Message sent' : 'Message received'}
              </h4>
              <pre data-testid="socket-message" className="detail-body-pre monospace">
                {socketMessage}
              </pre>
            </section>
          ) : null
        ) : (
          <>
            {entry.requestBody ? (
              <section className="detail-section">
                <h4 className="section-title">Request Body</h4>
                <pre data-testid="request-body" className="detail-body-pre monospace">
                  {entry.requestBody}
                </pre>
              </section>
            ) : null}

            {entry.requestHeaders && (
              <section className="detail-section">
                <h4 className="section-title">Request Headers</h4>
                <div data-testid="request-headers" className="headers-grid monospace">
                  {Object.entries(entry.requestHeaders).map(([key, value]) => {
                    const isChanged = entry.changedHeaders?.some(
                      (c) => c.toLowerCase() === key.toLowerCase(),
                    );
                    return (
                      <div
                        key={key}
                        className={`header-entry ${isChanged ? 'header-changed' : ''}`}
                        data-testid={isChanged ? 'request-header-changed' : undefined}
                      >
                        <span className="header-name">{key}:</span>{' '}
                        <span className="header-value">{value}</span>
                        {isChanged && (
                          <span
                            className="header-changed-marker"
                            title="changed by a header rule"
                          >
                            {' '}(changed by a header rule)
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {(entry.changedHeaders ?? [])
                    .filter((c) => !Object.keys(entry.requestHeaders ?? {}).some((k) => k.toLowerCase() === c.toLowerCase()))
                    .map((c) => (
                      <div key={`removed-${c}`} className="header-entry header-changed" data-testid="request-header-removed">
                        <span className="header-name">{c}</span>{' '}
                        <span className="header-changed-marker">(removed by a header rule)</span>
                      </div>
                    ))}
                </div>
              </section>
            )}

            <section className="detail-section">
              <h4 className="section-title">Response Headers</h4>
              {Object.keys(entry.responseHeaders).length === 0 ? (
                <p className="muted-text">No headers</p>
              ) : (
                <div className="headers-grid monospace">
                  {Object.entries(entry.responseHeaders).map(([key, value]) => (
                    <div key={key} className="header-entry">
                      <span className="header-name">{key}:</span>{' '}
                      <span className="header-value">{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="detail-section">
              <h4 className="section-title">Response Body</h4>
              <pre data-testid="response-body" className="detail-body-pre monospace">
                {formattedBody}
              </pre>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default LogDetail;
