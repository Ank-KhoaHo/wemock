import { useEffect, useState } from 'react';
import { compilePattern } from '../core/match';
import { normalizePattern } from '../core/sockets';
import type { SocketMock, SocketPush, SocketReply } from '../core/types';
import { newId } from '../shared/ids';

export function getPushDataError(kind: 'signalr' | 'plain', data: string): string | null {
  if (kind !== 'signalr') return null;
  const trimmed = data.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      return 'Arguments must be a JSON array';
    }
    return null;
  } catch {
    return 'Arguments must be a JSON array';
  }
}

interface PushRowProps {
  push: SocketPush;
  kind: 'signalr' | 'plain';
  onChange: (updated: SocketPush) => void;
  onRemove: () => void;
}

function PushRow({ push, kind, onChange, onRemove }: PushRowProps) {
  const error = getPushDataError(kind, push.data);

  return (
    <div data-testid="push-row" className="push-row">
      <div className="form-group push-after-group">
        <label className="field-label">After (ms)</label>
        <input
          type="number"
          min="0"
          data-testid="push-after"
          className="text-input"
          value={push.afterMs}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            onChange({ ...push, afterMs: isNaN(v) ? 0 : Math.max(0, v) });
          }}
        />
      </div>

      {kind === 'signalr' && (
        <div className="form-group push-target-group">
          <label className="field-label">Hub method</label>
          <input
            type="text"
            data-testid="push-target"
            className="text-input"
            value={push.target}
            onChange={(e) => onChange({ ...push, target: e.target.value })}
            placeholder="Hub method"
          />
        </div>
      )}

      <div className="form-group push-data-group">
        <label className="field-label">
          {kind === 'signalr' ? 'Arguments (JSON array)' : 'Text'}
        </label>
        <input
          type="text"
          data-testid="push-data"
          className={`text-input ${error ? 'input-error' : ''}`}
          value={push.data}
          onChange={(e) => onChange({ ...push, data: e.target.value })}
          placeholder={kind === 'signalr' ? '["arg1", "arg2"]' : 'Text'}
        />
        {error && (
          <div data-testid="push-data-error" className="error-message">
            {error}
          </div>
        )}
      </div>

      <div className="push-remove-wrapper">
        <button
          type="button"
          data-testid="push-remove"
          className="btn-danger push-remove-btn"
          onClick={onRemove}
          title="Remove"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export interface SocketEditorProps {
  socket: SocketMock | null;
  onSave: (socket: SocketMock) => void;
  onDelete: (socketId: string) => void;
  onDuplicate?: (socketId: string) => void;
  isDark?: boolean;
}

export function SocketEditor({ socket, onSave, onDelete, onDuplicate }: SocketEditorProps) {
  const [draft, setDraft] = useState<SocketMock | null>(socket);

  useEffect(() => {
    setDraft(socket);
  }, [socket?.id]);

  if (!draft) {
    return (
      <div className="mock-editor-empty">
        <p>Select a socket or click &quot;New socket&quot; to edit</p>
      </div>
    );
  }

  const patternResult = compilePattern(normalizePattern(draft.urlPattern));
  const patternError = !patternResult.ok ? patternResult.error : null;

  const hasOnConnectError = draft.onConnect.some(
    (p) => getPushDataError(draft.kind, p.data) !== null,
  );
  const hasReplyPushError = draft.replies.some((r) =>
    r.pushes.some((p) => getPushDataError(draft.kind, p.data) !== null),
  );

  const canSave = !patternError && !hasOnConnectError && !hasReplyPushError;

  const handleSave = () => {
    if (!canSave || !draft) return;
    const toSave: SocketMock = {
      ...draft,
      name: draft.name ? draft.name : undefined,
    };
    onSave(toSave);
  };

  const handleAddOnConnectPush = () => {
    const newPush: SocketPush = {
      id: newId(),
      afterMs: 0,
      target: '',
      data: '',
    };
    setDraft((prev) => (prev ? { ...prev, onConnect: [...prev.onConnect, newPush] } : prev));
  };

  const handleUpdateOnConnectPush = (index: number, updated: SocketPush) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = [...prev.onConnect];
      next[index] = updated;
      return { ...prev, onConnect: next };
    });
  };

  const handleRemoveOnConnectPush = (index: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        onConnect: prev.onConnect.filter((_, i) => i !== index),
      };
    });
  };

  const handleAddReply = () => {
    const newReply: SocketReply = {
      id: newId(),
      when: '',
      respond: 'fixed',
      result: '',
      pushes: [],
    };
    setDraft((prev) => (prev ? { ...prev, replies: [...prev.replies, newReply] } : prev));
  };

  const handleUpdateReply = (index: number, updater: (r: SocketReply) => SocketReply) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = [...prev.replies];
      next[index] = updater(next[index]!);
      return { ...prev, replies: next };
    });
  };

  const handleRemoveReply = (index: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        replies: prev.replies.filter((_, i) => i !== index),
      };
    });
  };

  const handleAddReplyPush = (replyIndex: number) => {
    const newPush: SocketPush = {
      id: newId(),
      afterMs: 0,
      target: '',
      data: '',
    };
    handleUpdateReply(replyIndex, (r) => ({
      ...r,
      pushes: [...r.pushes, newPush],
    }));
  };

  const handleUpdateReplyPush = (replyIndex: number, pushIndex: number, updated: SocketPush) => {
    handleUpdateReply(replyIndex, (r) => {
      const nextPushes = [...r.pushes];
      nextPushes[pushIndex] = updated;
      return { ...r, pushes: nextPushes };
    });
  };

  const handleRemoveReplyPush = (replyIndex: number, pushIndex: number) => {
    handleUpdateReply(replyIndex, (r) => ({
      ...r,
      pushes: r.pushes.filter((_, i) => i !== pushIndex),
    }));
  };

  return (
    <div className="mock-editor-container">
      <div className="mock-editor-header">
        <div className="mock-editor-title">
          <h3>Edit Socket</h3>
          <span className="mock-id-badge">{draft.kind}</span>
        </div>
        <div className="mock-editor-actions">
          {onDuplicate && (
            <button
              type="button"
              data-testid="socket-duplicate"
              className="btn-secondary"
              onClick={() => onDuplicate(draft.id)}
            >
              Duplicate
            </button>
          )}
          <button
            type="button"
            data-testid="socket-delete"
            className="btn-danger"
            onClick={() => onDelete(draft.id)}
          >
            Delete
          </button>
          <button
            type="button"
            data-testid="socket-save"
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
            data-testid="socket-name"
            className="text-input"
            placeholder="Optional name"
            value={draft.name ?? ''}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>

        {/* Kind & URL Pattern */}
        <div className="form-row">
          <div className="form-group socket-kind-group">
            <label className="field-label">Kind</label>
            <select
              data-testid="socket-kind"
              className="select-input"
              value={draft.kind}
              onChange={(e) =>
                setDraft({ ...draft, kind: e.target.value as 'signalr' | 'plain' })
              }
            >
              <option value="signalr">SignalR (JSON)</option>
              <option value="plain">Plain WebSocket</option>
            </select>
          </div>

          <div className="form-group pattern-group">
            <label className="field-label">URL Pattern</label>
            <input
              type="text"
              data-testid="socket-pattern"
              className={`text-input ${patternError ? 'input-error' : ''}`}
              placeholder="/hub"
              value={draft.urlPattern}
              onChange={(e) => setDraft({ ...draft, urlPattern: e.target.value })}
            />
            {patternError && (
              <div data-testid="socket-pattern-error" className="error-message">
                {patternError}
              </div>
            )}
          </div>
        </div>

        {/* On connect */}
        <div className="socket-section">
          <div className="socket-section-header">
            <h4>On connect</h4>
            <button
              type="button"
              data-testid="push-add"
              className="btn-secondary"
              onClick={handleAddOnConnectPush}
            >
              + Add message
            </button>
          </div>

          <div className="socket-pushes-list">
            {draft.onConnect.map((push, idx) => (
              <PushRow
                key={push.id}
                push={push}
                kind={draft.kind}
                onChange={(updated) => handleUpdateOnConnectPush(idx, updated)}
                onRemove={() => handleRemoveOnConnectPush(idx)}
              />
            ))}
          </div>
        </div>

        {/* Replies */}
        <div className="socket-section">
          <div className="socket-section-header">
            <h4>Replies</h4>
            <button
              type="button"
              data-testid="reply-add"
              className="btn-secondary"
              onClick={handleAddReply}
            >
              + Add reply
            </button>
          </div>

          <div className="socket-replies-list">
            {draft.replies.map((reply, rIdx) => (
              <div key={reply.id} data-testid="reply-row" className="reply-row">
                <div className="reply-row-top">
                  <div className="form-group reply-when-group">
                    <label className="field-label">
                      {draft.kind === 'signalr'
                        ? 'Client calls (hub method)'
                        : 'Client text contains (empty = any)'}
                    </label>
                    <input
                      type="text"
                      data-testid="reply-when"
                      className="text-input"
                      value={reply.when}
                      onChange={(e) =>
                        handleUpdateReply(rIdx, (r) => ({ ...r, when: e.target.value }))
                      }
                    />
                  </div>

                  <div className="form-group reply-respond-group">
                    <label className="field-label">Respond</label>
                    <select
                      data-testid="reply-respond"
                      className="select-input"
                      value={reply.respond}
                      onChange={(e) =>
                        handleUpdateReply(rIdx, (r) => ({
                          ...r,
                          respond: e.target.value as 'fixed' | 'code',
                        }))
                      }
                    >
                      <option value="fixed">Fixed</option>
                      <option value="code">Code</option>
                    </select>
                  </div>

                  <div className="reply-remove-wrapper">
                    <button
                      type="button"
                      data-testid="reply-remove"
                      className="btn-danger reply-remove-btn"
                      onClick={() => handleRemoveReply(rIdx)}
                      title="Remove reply"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="reply-body-group">
                  {reply.respond === 'fixed' ? (
                    <div className="form-group">
                      <label className="field-label">
                        {draft.kind === 'signalr'
                          ? 'Result (JSON, empty = none)'
                          : 'Reply text (empty = none)'}
                      </label>
                      <input
                        type="text"
                        data-testid="reply-result"
                        className="text-input"
                        value={reply.result}
                        onChange={(e) =>
                          handleUpdateReply(rIdx, (r) => ({ ...r, result: e.target.value }))
                        }
                      />
                    </div>
                  ) : (
                    <div className="form-group">
                      <label className="field-label">Code</label>
                      <textarea
                        data-testid="reply-code"
                        className="text-input code-textarea"
                        rows={5}
                        value={reply.code ?? ''}
                        onChange={(e) =>
                          handleUpdateReply(rIdx, (r) => ({ ...r, code: e.target.value }))
                        }
                      />
                      <div className="field-help-text">
                        Return the result. body holds the client&apos;s arguments (SignalR) or text (plain). Runs in a sandbox, at most 1 s.
                      </div>
                    </div>
                  )}
                </div>

                {/* Then send */}
                <div className="reply-then-send">
                  <div className="reply-then-send-header">
                    <span className="field-label">Then send</span>
                    <button
                      type="button"
                      data-testid="reply-push-add"
                      className="btn-secondary btn-sm"
                      onClick={() => handleAddReplyPush(rIdx)}
                    >
                      + Add message
                    </button>
                  </div>
                  <div className="reply-pushes-list">
                    {reply.pushes.map((p, pIdx) => (
                      <PushRow
                        key={p.id}
                        push={p}
                        kind={draft.kind}
                        onChange={(updated) => handleUpdateReplyPush(rIdx, pIdx, updated)}
                        onRemove={() => handleRemoveReplyPush(rIdx, pIdx)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SocketEditor;
