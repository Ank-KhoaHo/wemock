import { base64ToBytes } from '../core/bodies';
import { isValidStatus, statusTextFor } from '../core/statusText';
import type { LogEntry } from '../core/types';

export interface LogDetailProps {
  entry: LogEntry | null;
  onMockThis: (entry: LogEntry) => void;
  onClose?: () => void;
}

function formatResponseBody(entry: LogEntry): string {
  if (entry.truncated) {
    return 'not kept, over 1 MB';
  }
  if (entry.responseEncoding === 'base64') {
    const bytes = entry.responseBody ? base64ToBytes(entry.responseBody).length : 0;
    return `binary, ${bytes} bytes`;
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

export function LogDetail({ entry, onMockThis, onClose }: LogDetailProps) {
  if (!entry) {
    return (
      <div className="log-detail empty">
        <p className="empty-message">Select a request to view details</p>
      </div>
    );
  }

  const disabledReason = getMockDisabledReason(entry);
  const isMockDisabled = Boolean(disabledReason);
  const formattedBody = formatResponseBody(entry);
  const statusText = statusTextFor(entry.status);

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
          {onClose && (
            <button
              type="button"
              className="detail-close-btn"
              onClick={onClose}
              title="Close details"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="detail-content">
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

        {entry.requestBody ? (
          <section className="detail-section">
            <h4 className="section-title">Request Body</h4>
            <pre data-testid="request-body" className="detail-body-pre monospace">
              {entry.requestBody}
            </pre>
          </section>
        ) : null}

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
      </div>
    </div>
  );
}

export default LogDetail;
