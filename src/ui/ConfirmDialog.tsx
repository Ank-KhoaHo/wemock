import React from 'react';
import { Dialog } from './Dialog';
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
  if (!isOpen) return null;

  return (
    <Dialog
      title={`Delete all scenarios and mocks in ${siteName}?`}
      onClose={onCancel}
      testId="confirm-dialog"
      className="confirm-dialog"
      role="alertdialog"
      footer={
        <>
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
        </>
      }
    >
      <div className="db">
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          All scenarios and mocks go. You can undo it.
        </p>
      </div>
    </Dialog>
  );
}

export default ConfirmDialog;
