import React, { Suspense, useEffect, useState } from 'react';
import { DEFAULT_CODE } from '../core/handler';
import { compilePattern } from '../core/match';
import { isValidStatus, STATUS_TEXT } from '../core/statusText';
import type { BodyEncoding, HttpMethod, Mock } from '../core/types';
import { BodyEditor } from './BodyEditor';
import { HeadersTable } from './HeadersTable';

const CodeEditor = React.lazy(() => import('./CodeEditor'));

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY'];

export interface MockEditorProps {
  mock: Mock | null;
  onSave: (mock: Mock) => void;
  onDelete: (mockId: string) => void;
  isDark?: boolean;
}

export function MockEditor({ mock, onSave, onDelete, isDark = false }: MockEditorProps) {
  const [draft, setDraft] = useState<Mock | null>(mock);
  const [statusInput, setStatusInput] = useState<string>(mock ? String(mock.response.status) : '200');
  const [delayInput, setDelayInput] = useState<string>(mock ? String(mock.response.delayMs) : '0');

  useEffect(() => {
    setDraft(mock);
    if (mock) {
      setStatusInput(String(mock.response.status));
      setDelayInput(String(mock.response.delayMs));
    }
  }, [mock?.id]);

  if (!draft) {
    return (
      <div className="mock-editor-empty">
        <p>Select a mock or click &quot;New mock&quot; to edit</p>
      </div>
    );
  }

  const patternResult = compilePattern(draft.urlPattern);
  const isStatusValid = isValidStatus(Number(statusInput));
  const canSave = patternResult.ok && isStatusValid;

  const getContentType = (): string => {
    const entry = Object.entries(draft.response.headers).find(
      ([k]) => k.toLowerCase() === 'content-type',
    );
    return entry ? entry[1] : '';
  };

  const handleContentTypeChange = (newType: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const headers = { ...prev.response.headers };
      const existingKey =
        Object.keys(headers).find((k) => k.toLowerCase() === 'content-type') || 'content-type';
      headers[existingKey] = newType;
      return {
        ...prev,
        response: {
          ...prev.response,
          headers,
        },
      };
    });
  };

  const handleHeadersChange = (newHeaders: Record<string, string>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        response: {
          ...prev.response,
          headers: newHeaders,
        },
      };
    });
  };

  const handleBodyChange = (body: string, bodyEncoding: BodyEncoding) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        response: {
          ...prev.response,
          body,
          bodyEncoding,
        },
      };
    });
  };

  const handleLoadFile = (body: string, bodyEncoding: BodyEncoding, contentType: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const headers = { ...prev.response.headers };
      const existingKey =
        Object.keys(headers).find((k) => k.toLowerCase() === 'content-type') || 'content-type';
      headers[existingKey] = contentType;
      return {
        ...prev,
        response: {
          ...prev.response,
          body,
          bodyEncoding,
          headers,
        },
      };
    });
  };

  const isCode = draft.reply === 'code';

  const setReply = (reply: 'fixed' | 'code') => {
    setDraft((prev) => {
      if (!prev) return prev;
      if (reply === 'fixed') return { ...prev, reply: 'fixed' };
      return { ...prev, reply: 'code', code: prev.code && prev.code.trim() ? prev.code : DEFAULT_CODE };
    });
  };

  const handleSave = () => {
    if (!canSave) return;
    const finalStatus = Number(statusInput);
    const finalDelay = Math.max(0, Math.min(60000, Number(delayInput) || 0));
    const saved: Mock = {
      ...draft,
      response: {
        ...draft.response,
        status: finalStatus,
        delayMs: finalDelay,
      },
    };
    onSave(saved);
  };

  return (
    <div className="mock-editor-container">
      <div className="mock-editor-header">
        <div className="mock-editor-title">
          <h3>Edit Mock</h3>
          <span className="mock-id-badge">{draft.source}</span>
        </div>
        <div className="mock-editor-actions">
          <button
            type="button"
            data-testid="mock-delete"
            className="btn-danger"
            onClick={() => onDelete(draft.id)}
          >
            Delete
          </button>
          <button
            type="button"
            data-testid="mock-save"
            className="btn-primary"
            disabled={!canSave}
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </div>

      <div className="mock-editor-body">
        {/* Name */}
        <div className="form-group">
          <label className="field-label">Name</label>
          <input
            type="text"
            data-testid="field-name"
            className="text-input"
            placeholder="Optional name"
            value={draft.name ?? ''}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>

        {/* Method & URL Pattern */}
        <div className="form-row">
          <div className="form-group method-group">
            <label className="field-label">Method</label>
            <select
              data-testid="field-method"
              className="select-input"
              value={draft.method}
              onChange={(e) => setDraft({ ...draft, method: e.target.value as HttpMethod })}
            >
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group pattern-group">
            <label className="field-label">URL Pattern</label>
            <input
              type="text"
              data-testid="field-pattern"
              className={`text-input ${!patternResult.ok ? 'input-error' : ''}`}
              placeholder="/api/users/:id or https://..."
              value={draft.urlPattern}
              onChange={(e) => setDraft({ ...draft, urlPattern: e.target.value })}
            />
            {!patternResult.ok && (
              <div data-testid="pattern-error" className="error-message">
                {patternResult.error}
              </div>
            )}
          </div>
        </div>

        {/* GraphQL Operation */}
        <div className="form-group">
          <label className="field-label">GraphQL Operation</label>
          <input
            type="text"
            data-testid="field-graphql"
            className="text-input"
            placeholder="operationName (optional)"
            value={draft.graphqlOperation ?? ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                graphqlOperation: e.target.value ? e.target.value : undefined,
              })
            }
          />
        </div>

        {/* Status & Delay */}
        <div className="form-row">
          <div className="form-group status-group">
            <label className="field-label">Status</label>
            <input
              type="number"
              data-testid="field-status"
              list="status-datalist"
              className={`text-input ${!isStatusValid ? 'input-error' : ''}`}
              value={statusInput}
              onChange={(e) => setStatusInput(e.target.value)}
            />
            <datalist id="status-datalist">
              {Object.entries(STATUS_TEXT).map(([code, reason]) => (
                <option key={code} value={code}>
                  {code} {reason}
                </option>
              ))}
            </datalist>
            {!isStatusValid && (
              <div data-testid="status-error" className="error-message">
                Invalid status code (must be 200–599)
              </div>
            )}
          </div>

          <div className="form-group delay-group">
            <label className="field-label">Delay (ms)</label>
            <input
              type="number"
              data-testid="field-delay"
              min="0"
              max="60000"
              className="text-input"
              value={delayInput}
              onChange={(e) => setDelayInput(e.target.value)}
            />
          </div>
        </div>

        {/* Headers Table */}
        <HeadersTable headers={draft.response.headers} onChange={handleHeadersChange} />

        {/* Reply type (A2) */}
        <div className="form-group">
          <label className="field-label">Reply</label>
          <div className="reply-switch" role="group" aria-label="Reply type">
            <button
              type="button"
              data-testid="reply-fixed"
              className={`reply-btn ${!isCode ? 'active' : ''}`}
              aria-pressed={!isCode ? 'true' : 'false'}
              onClick={() => setReply('fixed')}
            >
              Fixed body
            </button>
            <button
              type="button"
              data-testid="reply-code"
              className={`reply-btn ${isCode ? 'active' : ''}`}
              aria-pressed={isCode ? 'true' : 'false'}
              onClick={() => setReply('code')}
            >
              Code
            </button>
          </div>
        </div>

        {isCode ? (
          <div className="code-reply-view" data-testid="code-view">
            <p className="field-help">
              Return the body. <code>params</code>, <code>query</code>, <code>body</code> and <code>req</code> describe
              the call. <code>res</code> starts with the status, headers and delay above; change it to answer
              differently. Runs in a sandbox, at most 1 s.
            </p>
            <Suspense fallback={<div className="editor-loading">Loading editor...</div>}>
              <CodeEditor
                value={draft.code ?? ''}
                dark={isDark}
                language="javascript"
                onChange={(val) => setDraft((prev) => (prev ? { ...prev, code: val } : prev))}
              />
            </Suspense>
          </div>
        ) : (
          <BodyEditor
            body={draft.response.body}
            bodyEncoding={draft.response.bodyEncoding}
            contentType={getContentType()}
            mockName={draft.name}
            isDark={isDark}
            onChangeBody={handleBodyChange}
            onChangeContentType={handleContentTypeChange}
            onLoadFile={handleLoadFile}
          />
        )}
      </div>
    </div>
  );
}

export default MockEditor;
