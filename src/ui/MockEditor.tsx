import React, { Suspense, useEffect, useState } from 'react';
import { hasConditions } from '../core/conditions';
import { DEFAULT_CODE } from '../core/handler';
import { compilePattern } from '../core/match';
import { isValidStatus, STATUS_TEXT } from '../core/statusText';
import type { BodyEncoding, HttpMethod, Mock, MockMatch, MockResponse, MockSequence } from '../core/types';
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

interface KeyValueRow {
  id: string;
  key: string;
  value: string;
}

interface StepDraft {
  status: string;
  delayMs: string;
  body: string;
}

export function MockEditor({ mock, onSave, onDelete, isDark = false }: MockEditorProps) {
  const [draft, setDraft] = useState<Mock | null>(mock);
  const [statusInput, setStatusInput] = useState<string>(mock ? String(mock.response.status) : '200');
  const [delayInput, setDelayInput] = useState<string>(mock ? String(mock.response.delayMs) : '0');
  const [seqDraft, setSeqDraft] = useState<{
    steps: StepDraft[];
    after: 'stay' | 'loop';
  } | null>(() => {
    if (mock?.sequence?.steps?.length) {
      return {
        steps: mock.sequence.steps.map((s) => ({
          status: String(s.status),
          delayMs: String(s.delayMs),
          body: s.body,
        })),
        after: mock.sequence.after,
      };
    }
    return null;
  });
  const [matchExpanded, setMatchExpanded] = useState<boolean>(mock ? hasConditions(mock) : false);
  const [queryRows, setQueryRows] = useState<KeyValueRow[]>(() => {
    if (!mock?.match?.query) return [];
    return Object.entries(mock.match.query).map(([key, value], idx) => ({
      id: `q-${idx}-${key}`,
      key,
      value,
    }));
  });
  const [headerRows, setHeaderRows] = useState<KeyValueRow[]>(() => {
    if (!mock?.match?.headers) return [];
    return Object.entries(mock.match.headers).map(([key, value], idx) => ({
      id: `h-${idx}-${key}`,
      key,
      value,
    }));
  });
  const [matchBody, setMatchBody] = useState<string>(mock?.match?.body ?? '');

  useEffect(() => {
    setDraft(mock);
    if (mock) {
      setStatusInput(String(mock.response.status));
      setDelayInput(String(mock.response.delayMs));
      setMatchExpanded(hasConditions(mock));
      setQueryRows(
        mock.match?.query
          ? Object.entries(mock.match.query).map(([key, value], idx) => ({
              id: `q-${idx}-${key}`,
              key,
              value,
            }))
          : [],
      );
      setHeaderRows(
        mock.match?.headers
          ? Object.entries(mock.match.headers).map(([key, value], idx) => ({
              id: `h-${idx}-${key}`,
              key,
              value,
            }))
          : [],
      );
      setMatchBody(mock.match?.body ?? '');
      if (mock.sequence?.steps?.length) {
        setSeqDraft({
          steps: mock.sequence.steps.map((s) => ({
            status: String(s.status),
            delayMs: String(s.delayMs),
            body: s.body,
          })),
          after: mock.sequence.after,
        });
      } else {
        setSeqDraft(null);
      }
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
  const isCode = draft.reply === 'code';
  const isSequence = draft.reply === 'sequence';
  const isFixed = !isCode && !isSequence;

  const isStatusValid = isValidStatus(Number(statusInput));
  const isDelayValid = !Number.isNaN(Number(delayInput)) && Number(delayInput) >= 0;
  const isFixedValid = isStatusValid && isDelayValid;

  const isSequenceValid = Boolean(
    seqDraft &&
      seqDraft.steps.length > 0 &&
      seqDraft.steps.every(
        (s) =>
          isValidStatus(Number(s.status)) &&
          !Number.isNaN(Number(s.delayMs)) &&
          Number(s.delayMs) >= 0,
      ),
  );

  const canSave = patternResult.ok && (isSequence ? isSequenceValid : isFixedValid);

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

  const setReply = (reply: 'fixed' | 'code' | 'sequence') => {
    if (reply === 'sequence') {
      if (!seqDraft || seqDraft.steps.length === 0) {
        setSeqDraft({
          steps: [
            {
              status: statusInput || String(draft.response.status || 200),
              delayMs: delayInput || String(draft.response.delayMs || 0),
              body: draft.response.body,
            },
          ],
          after: 'stay',
        });
      }
    }
    setDraft((prev) => {
      if (!prev) return prev;
      if (reply === 'fixed') return { ...prev, reply: 'fixed' };
      if (reply === 'sequence') return { ...prev, reply: 'sequence' };
      return { ...prev, reply: 'code', code: prev.code && prev.code.trim() ? prev.code : DEFAULT_CODE };
    });
  };

  const handleSave = () => {
    if (!canSave) return;
    const finalStatus = Number(statusInput);
    const finalDelay = Math.max(0, Math.min(60000, Number(delayInput) || 0));

    const cleanQuery: Record<string, string> = {};
    for (const r of queryRows) {
      const k = r.key.trim();
      if (k) {
        cleanQuery[k] = r.value;
      }
    }

    const cleanHeaders: Record<string, string> = {};
    for (const r of headerRows) {
      const k = r.key.trim();
      if (k) {
        cleanHeaders[k] = r.value;
      }
    }

    const cleanBody = matchBody.trim();

    const matchObj: MockMatch = {
      ...(Object.keys(cleanQuery).length > 0 ? { query: cleanQuery } : {}),
      ...(Object.keys(cleanHeaders).length > 0 ? { headers: cleanHeaders } : {}),
      ...(cleanBody.length > 0 ? { body: matchBody } : {}),
    };

    const hasAnyConditions =
      Boolean(matchObj.query && Object.keys(matchObj.query).length > 0) ||
      Boolean(matchObj.headers && Object.keys(matchObj.headers).length > 0) ||
      Boolean(typeof matchObj.body === 'string' && matchObj.body.trim().length > 0);

    if (draft.reply === 'sequence') {
      if (!seqDraft || seqDraft.steps.length === 0) return;
      const sequence: MockSequence = {
        steps: seqDraft.steps.map((s) => ({
          status: Number(s.status),
          headers: { ...draft.response.headers },
          body: s.body,
          bodyEncoding: 'text',
          delayMs: Math.max(0, Number(s.delayMs) || 0),
        })),
        after: seqDraft.after,
      };

      const saved: Mock = {
        ...draft,
        reply: 'sequence',
        sequence,
        response: {
          ...draft.response,
          status: sequence.steps[0]?.status ?? 200,
          delayMs: sequence.steps[0]?.delayMs ?? 0,
          body: sequence.steps[0]?.body ?? '',
          headers: { ...draft.response.headers },
          bodyEncoding: 'text',
        },
        ...(hasAnyConditions ? { match: matchObj } : {}),
      };

      if (!hasAnyConditions) {
        delete saved.match;
      }

      onSave(saved);
      return;
    }

    const saved: Mock = {
      ...draft,
      response: {
        ...draft.response,
        status: finalStatus,
        delayMs: finalDelay,
      },
      ...(hasAnyConditions ? { match: matchObj } : {}),
    };

    if (!hasAnyConditions) {
      delete saved.match;
    }

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

        {/* Match only when (A11) */}
        {!matchExpanded ? (
          <div className="form-group">
            <button
              type="button"
              data-testid="match-toggle"
              className="btn-secondary match-toggle-btn"
              onClick={() => setMatchExpanded(true)}
            >
              Match only when…
            </button>
          </div>
        ) : (
          <div data-testid="match-section" className="match-section">
            <div className="match-section-header">
              <label className="field-label">Match only when</label>
              <div className="field-help">Use * as a value for &quot;present, any value&quot;.</div>
            </div>

            {/* Query */}
            <div className="match-subset-group">
              <div className="match-subset-header">
                <label className="field-label">Query</label>
                <button
                  type="button"
                  data-testid="match-query-add"
                  className="btn-link"
                  onClick={() =>
                    setQueryRows((prev) => [
                      ...prev,
                      { id: `q-${Date.now()}-${prev.length}`, key: '', value: '' },
                    ])
                  }
                >
                  + Add query param
                </button>
              </div>
              {queryRows.map((r) => (
                <div key={r.id} className="match-row">
                  <input
                    type="text"
                    data-testid="match-query-key"
                    className="text-input"
                    placeholder="Key"
                    value={r.key}
                    onChange={(e) => {
                      const val = e.target.value;
                      setQueryRows((prev) =>
                        prev.map((item) => (item.id === r.id ? { ...item, key: val } : item)),
                      );
                    }}
                  />
                  <input
                    type="text"
                    data-testid="match-query-value"
                    className="text-input"
                    placeholder="Value"
                    value={r.value}
                    onChange={(e) => {
                      const val = e.target.value;
                      setQueryRows((prev) =>
                        prev.map((item) => (item.id === r.id ? { ...item, value: val } : item)),
                      );
                    }}
                  />
                  <button
                    type="button"
                    data-testid="match-query-remove"
                    className="match-remove-btn"
                    title="Remove query condition"
                    onClick={() => setQueryRows((prev) => prev.filter((item) => item.id !== r.id))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {/* Headers */}
            <div className="match-subset-group">
              <div className="match-subset-header">
                <label className="field-label">Headers</label>
                <button
                  type="button"
                  data-testid="match-header-add"
                  className="btn-link"
                  onClick={() =>
                    setHeaderRows((prev) => [
                      ...prev,
                      { id: `h-${Date.now()}-${prev.length}`, key: '', value: '' },
                    ])
                  }
                >
                  + Add header
                </button>
              </div>
              {headerRows.map((r) => (
                <div key={r.id} className="match-row">
                  <input
                    type="text"
                    data-testid="match-header-key"
                    className="text-input"
                    placeholder="Header"
                    value={r.key}
                    onChange={(e) => {
                      const val = e.target.value;
                      setHeaderRows((prev) =>
                        prev.map((item) => (item.id === r.id ? { ...item, key: val } : item)),
                      );
                    }}
                  />
                  <input
                    type="text"
                    data-testid="match-header-value"
                    className="text-input"
                    placeholder="Value"
                    value={r.value}
                    onChange={(e) => {
                      const val = e.target.value;
                      setHeaderRows((prev) =>
                        prev.map((item) => (item.id === r.id ? { ...item, value: val } : item)),
                      );
                    }}
                  />
                  <button
                    type="button"
                    data-testid="match-header-remove"
                    className="match-remove-btn"
                    title="Remove header condition"
                    onClick={() => setHeaderRows((prev) => prev.filter((item) => item.id !== r.id))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {/* Body contains */}
            <div className="match-subset-group">
              <label className="field-label">Body contains</label>
              <textarea
                data-testid="match-body"
                className="text-input match-body-textarea"
                placeholder="JSON: these fields must be in the body. Other text: the body must contain it."
                value={matchBody}
                onChange={(e) => setMatchBody(e.target.value)}
                rows={3}
              />
              <div className="field-help">
                JSON: these fields must be in the body. Other text: the body must contain it.
              </div>
            </div>
          </div>
        )}

        {/* Status & Delay */}
        {!isSequence && (
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
        )}

        {/* Headers Table */}
        <HeadersTable headers={draft.response.headers} onChange={handleHeadersChange} />

        {/* Reply type (A2) */}
        <div className="form-group">
          <label className="field-label">Reply</label>
          <div className="reply-switch" role="group" aria-label="Reply type">
            <button
              type="button"
              data-testid="reply-fixed"
              className={`reply-btn ${isFixed ? 'active' : ''}`}
              aria-pressed={isFixed ? 'true' : 'false'}
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
            <button
              type="button"
              data-testid="reply-sequence"
              className={`reply-btn ${isSequence ? 'active' : ''}`}
              aria-pressed={isSequence ? 'true' : 'false'}
              onClick={() => setReply('sequence')}
            >
              Sequence
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
        ) : isSequence ? (
          <div className="sequence-reply-view" data-testid="sequence-view">
            <p className="field-help">
              Each call to this mock gets the next step. The count restarts when the page reloads, the mock is saved, or the scenario changes.
            </p>

            {seqDraft && (
              <div className="seq-steps-list">
                {seqDraft.steps.map((step, idx) => (
                  <div key={idx} className="seq-step" data-testid="seq-step">
                    <div className="seq-step-header">
                      <span className="seq-step-number">Call {idx + 1}</span>
                      {seqDraft.steps.length > 1 && (
                        <button
                          type="button"
                          data-testid="seq-step-remove"
                          className="btn-link btn-danger-link seq-step-remove-btn"
                          onClick={() => {
                            setSeqDraft({
                              ...seqDraft,
                              steps: seqDraft.steps.filter((_, i) => i !== idx),
                            });
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <div className="form-row seq-step-row">
                      <div className="form-group status-group">
                        <label className="field-label">Status</label>
                        <input
                          type="number"
                          data-testid="seq-status"
                          className={`text-input ${!isValidStatus(Number(step.status)) ? 'input-error' : ''}`}
                          value={step.status}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSeqDraft({
                              ...seqDraft,
                              steps: seqDraft.steps.map((s, i) => (i === idx ? { ...s, status: val } : s)),
                            });
                          }}
                        />
                      </div>

                      <div className="form-group delay-group">
                        <label className="field-label">Delay (ms)</label>
                        <input
                          type="number"
                          data-testid="seq-delay"
                          min="0"
                          className="text-input"
                          value={step.delayMs}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSeqDraft({
                              ...seqDraft,
                              steps: seqDraft.steps.map((s, i) => (i === idx ? { ...s, delayMs: val } : s)),
                            });
                          }}
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="field-label">Body</label>
                      <textarea
                        data-testid="seq-body"
                        className="text-input seq-body-textarea"
                        rows={4}
                        value={step.body}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSeqDraft({
                            ...seqDraft,
                            steps: seqDraft.steps.map((s, i) => (i === idx ? { ...s, body: val } : s)),
                          });
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="seq-actions-row">
              <button
                type="button"
                data-testid="seq-step-add"
                className="btn-secondary seq-step-add-btn"
                onClick={() => {
                  if (seqDraft) {
                    const last = seqDraft.steps[seqDraft.steps.length - 1];
                    if (last) {
                      setSeqDraft({
                        ...seqDraft,
                        steps: [...seqDraft.steps, { ...last }],
                      });
                    }
                  }
                }}
              >
                + Add call
              </button>

              {seqDraft && (
                <div className="form-group seq-after-group">
                  <select
                    data-testid="seq-after"
                    className="select-input"
                    value={seqDraft.after}
                    onChange={(e) => {
                      setSeqDraft({
                        ...seqDraft,
                        after: e.target.value as 'stay' | 'loop',
                      });
                    }}
                  >
                    <option value="stay">After the last call: keep answering the last</option>
                    <option value="loop">After the last call: start over</option>
                  </select>
                </div>
              )}
            </div>

            <div className="form-group templates-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  data-testid="field-templates"
                  checked={Boolean(draft.templates)}
                  onChange={(e) => setDraft({ ...draft, templates: e.target.checked })}
                />
                Fill {'{{templates}}'}
              </label>
              <div className="field-help">
                tags: params.id, query.page, headers.name, body.path, uuid, now, timestamp
              </div>
            </div>
          </div>
        ) : (
          <>
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
            <div className="form-group templates-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  data-testid="field-templates"
                  checked={Boolean(draft.templates)}
                  onChange={(e) => setDraft({ ...draft, templates: e.target.checked })}
                />
                Fill {'{{templates}}'}
              </label>
              <div className="field-help">
                tags: params.id, query.page, headers.name, body.path, uuid, now, timestamp
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default MockEditor;
