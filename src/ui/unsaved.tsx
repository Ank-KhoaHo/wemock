import { type Ref, useImperativeHandle, useRef, useState } from 'react';
import { Dialog } from './Dialog';

export interface EditorHandle {
  isDirty: () => boolean;
  canSave: () => boolean;
  save: () => Promise<boolean>;
}

export const IDLE_EDITOR: EditorHandle = {
  isDirty: () => false,
  canSave: () => false,
  save: () => Promise.resolve(false),
};

export function useUnsavedChanges(ref: Ref<EditorHandle> | undefined) {
  const [baseline, setBaseline] = useState<{ id: string; snapshot: string } | null>(null);
  const handleRef = useRef<EditorHandle>(IDLE_EDITOR);
  useImperativeHandle(
    ref,
    () => ({
      isDirty: () => handleRef.current.isDirty(),
      canSave: () => handleRef.current.canSave(),
      save: () => handleRef.current.save(),
    }),
    [],
  );

  return {
    isDirty(id: string, snapshot: string): boolean {
      if (baseline?.id !== id) {
        setBaseline({ id, snapshot });
        return false;
      }
      return baseline.snapshot !== snapshot;
    },
    markSaved(id: string, snapshot: string) {
      setBaseline({ id, snapshot });
    },
    expose(handle: EditorHandle) {
      handleRef.current = handle;
    },
  };
}

export function DirtyMark() {
  return (
    <span data-testid="editor-dirty" className="editor-dirty" role="img" aria-label="Unsaved changes" title="Unsaved changes">
      •
    </span>
  );
}

export interface UnsavedDialogProps {
  canSave: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedDialog({ canSave, onSave, onDiscard, onCancel }: Readonly<UnsavedDialogProps>) {
  return (
    <Dialog
      title="Save your changes?"
      onClose={onCancel}
      testId="unsaved-dialog"
      role="alertdialog"
      footer={
        <>
          <button type="button" data-testid="unsaved-cancel" className="btn" autoFocus onClick={onCancel}>
            Cancel
          </button>
          <button type="button" data-testid="unsaved-discard" className="btn" onClick={onDiscard}>
            Discard
          </button>
          <button
            type="button"
            data-testid="unsaved-save"
            className="btn blue"
            disabled={!canSave}
            title={canSave ? undefined : 'Fix the form to save'}
            onClick={onSave}
          >
            Save
          </button>
        </>
      }
    >
      <div className="db">
        <p style={{ margin: 0, color: 'var(--muted)' }}>Your edits here are not saved yet.</p>
      </div>
    </Dialog>
  );
}
