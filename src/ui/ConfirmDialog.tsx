import React, { useEffect } from 'react';
import { TrashIcon } from './icons';

export interface ConfirmDialogProps {
  isOpen: boolean;
  siteName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  siteName,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element | null {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="dialog confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        data-testid="confirm-dialog"
      >
        <header>
          <h2>Delete all scenarios and mocks in {siteName}?</h2>
        </header>
        <div className="db">
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            All scenarios and mocks go. You can undo it.
          </p>
        </div>
        <footer>
          <button
            type="button"
            data-testid="confirm-cancel"
            className="btn"
            // Focus starts on the safe choice, so Enter alone never deletes.
            autoFocus
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="confirm-ok"
            className="btn red-btn"
            style={{
              background: 'var(--danger)',
              borderColor: 'var(--danger)',
              color: '#fff',
            }}
            onClick={onConfirm}
          >
            <TrashIcon size={16} />
            Delete all
          </button>
        </footer>
      </div>
    </div>
  );
}

export default ConfirmDialog;
