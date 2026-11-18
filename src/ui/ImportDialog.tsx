import React, { useEffect, useRef, useState } from 'react';
import { parseProjectFile, parseScenarioFile } from '../core/exportFile';
import { detectHar, harSummaryText, importHar } from '../core/harImport';
import { importMockFile } from '../core/mockFileImport';
import { detectOpenApi, importOpenApi, openApiSummaryText, parseSpecText } from '../core/openapiImport';
import type { Project, Scenario } from '../core/types';
import { newId } from '../shared/ids';
import { Dialog } from './Dialog';
import { FileIcon, ImportIcon, XIcon } from './icons';

export interface PendingImport {
  fileName: string;
  kind: 'project' | 'scenario';
  importedProject?: Project;
  importedScenario?: Scenario;
  summaryText: string;
}

export function formatImportSummary(summary: {
  mocks: number;
  mocksSkipped?: number;
  codeMocks?: number;
  headerRulesSkipped?: number;
}): string {
  const parts: string[] = [];
  if (summary.mocks > 0) {
    parts.push(`${summary.mocks} mock${summary.mocks === 1 ? '' : 's'} imported`);
  }
  if (summary.mocksSkipped && summary.mocksSkipped > 0) {
    parts.push(`${summary.mocksSkipped} skipped`);
  }
  if (summary.codeMocks && summary.codeMocks > 0) {
    parts.push(`${summary.codeMocks} as code mock${summary.codeMocks === 1 ? '' : 's'}`);
  }
  if (summary.headerRulesSkipped && summary.headerRulesSkipped > 0) {
    parts.push(
      `${summary.headerRulesSkipped} header rule${summary.headerRulesSkipped === 1 ? '' : 's'} not imported`,
    );
  }
  if (parts.length === 0) {
    return '0 mocks imported';
  }
  return parts.join(', ');
}

export interface ImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
  tabOrigin: string;
  onImportAdd: (data: PendingImport) => Promise<void>;
  onImportReplace: (data: PendingImport) => Promise<void>;
  onCreateProjectFromImport: (data: PendingImport) => Promise<void>;
}

/**
 * True when the project holds nothing an import could lose: only its first scenario, with no mock or
 * socket mock, and no header rule. A named empty scenario counts as something to keep.
 */
function hasNoMocks(project: Project): boolean {
  return (
    project.scenarios.length <= 1 &&
    (project.headerRules?.length ?? 0) === 0 &&
    project.scenarios.every((s) => s.mocks.length === 0 && (s.sockets?.length ?? 0) === 0)
  );
}

export function ImportDialog({
  isOpen,
  onClose,
  project,
  tabOrigin,
  onImportAdd,
  onImportReplace,
  onCreateProjectFromImport,
}: ImportDialogProps): React.JSX.Element | null {
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [choice, setChoice] = useState<'add' | 'replace'>('add');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setPendingImport(null);
    setImportError(null);
    setChoice('add');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  useEffect(() => {
    if (!isOpen) reset();
  }, [isOpen]);

  const processFile = async (file: File) => {
    setImportError(null);
    setPendingImport(null);

    try {
      const text = await file.text();

      // Check scenario file
      const scenarioResult = parseScenarioFile(text);
      if (scenarioResult.ok) {
        const sc = scenarioResult.scenario;
        const pending: PendingImport = {
          fileName: file.name,
          kind: 'scenario',
          importedScenario: sc,
          summaryText: `Scenario ${sc.name} added`,
        };
        if (!project) {
          await onCreateProjectFromImport(pending);
          handleClose();
          return;
        }
        // An empty project loses nothing, so there is nothing to ask.
        if (hasNoMocks(project)) {
          await onImportAdd(pending);
          handleClose();
          return;
        }
        setPendingImport(pending);
        setChoice('add');
        return;
      }

      let importedProject: Project | null = null;
      let summaryText = '';

      const wemockResult = parseProjectFile(text);
      if (wemockResult.ok) {
        const p = wemockResult.project;
        const totalMocks = p.scenarios.reduce((acc, s) => acc + s.mocks.length, 0);
        importedProject = {
          ...p,
          id: newId(),
        };
        summaryText = formatImportSummary({ mocks: totalMocks });
      } else {
        const parsed = parseSpecText(text);
        if (!parsed || typeof parsed !== 'object') {
          setImportError('Unrecognized file format: expected wemock, HAR, OpenAPI or a JSON mock file');
          return;
        }

        if ('wemock' in parsed) {
          const err =
            (parsed as { wemock?: unknown }).wemock === 'scenario'
              ? scenarioResult.error
              : wemockResult.error;
          setImportError(err);
          return;
        }

        if (detectHar(parsed)) {
          const originToUse = tabOrigin || project?.origins[0] || '';
          const harResult = importHar(parsed, file.name, originToUse, newId, Date.now());
          if (harResult.ok) {
            importedProject = harResult.result.project;
            summaryText = harSummaryText(harResult.result.summary);
          } else {
            setImportError(harResult.error);
            return;
          }
        } else if (detectOpenApi(parsed)) {
          const originToUse = tabOrigin || project?.origins[0] || '';
          const openApiResult = importOpenApi(parsed, originToUse, newId, Date.now());
          if (openApiResult.ok) {
            importedProject = openApiResult.result.project;
            summaryText = openApiSummaryText(openApiResult.result.summary);
          } else {
            setImportError(openApiResult.error);
            return;
          }
        } else {
          const fileResult = importMockFile(parsed, tabOrigin, newId, Date.now());
          if (fileResult.ok) {
            importedProject = fileResult.result.project;
            summaryText = formatImportSummary(fileResult.result.summary);
          } else {
            setImportError('Unrecognized file format: expected wemock, HAR, OpenAPI or a JSON mock file');
            return;
          }
        }
      }

      if (!importedProject) return;

      const pending: PendingImport = {
        fileName: file.name,
        kind: 'project',
        importedProject,
        summaryText,
      };

      if (!project) {
        await onCreateProjectFromImport(pending);
        handleClose();
        return;
      }
      // Replace, not Add: it also makes the file's scenario active, so its mocks answer at once.
      if (hasNoMocks(project)) {
        await onImportReplace(pending);
        handleClose();
        return;
      }

      setPendingImport(pending);
      setChoice('add');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    }
  };

  if (!isOpen) return null;

  const siteName = project?.origins[0]
    ? (() => {
        try {
          return new URL(project.origins[0]).host;
        } catch {
          return project.name;
        }
      })()
    : project?.name || 'this site';

  const handleConfirm = async () => {
    if (!pendingImport) return;
    try {
      if (choice === 'replace') {
        await onImportReplace(pendingImport);
      } else {
        await onImportAdd(pendingImport);
      }
      handleClose();
    } catch (err) {
      // The dialog stays open and says why, rather than failing without a word.
      setImportError(err instanceof Error ? `Import failed: ${err.message}` : 'Import failed');
    }
  };

  const hasFooter = Boolean(pendingImport || importError);

  return (
    <Dialog
      title={pendingImport ? `Import ${pendingImport.fileName}` : 'Import'}
      onClose={handleClose}
      testId="import-dialog"
      className="import-dialog"
      headerAction={
        <button type="button" className="ibtn" aria-label="Close" onClick={handleClose}>
          <XIcon size={16} />
        </button>
      }
      footer={
        hasFooter && (
          <>
            <button type="button" data-testid="import-cancel" className="btn" onClick={handleClose}>
              Cancel
            </button>
            {pendingImport && !importError && (
              <button type="button" data-testid="import-confirm" className="btn blue" onClick={handleConfirm}>
                <ImportIcon size={16} />
                Import
              </button>
            )}
          </>
        )
      }
    >
      <input
        type="file"
        ref={fileInputRef}
        data-testid="import"
        accept=".json,.har,.yaml,.yml"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) processFile(f);
          e.target.value = '';
        }}
      />

      <div className="db">
        {importError && (
          <div
            data-testid="import-error"
            className="import-error-text"
            style={{ color: 'var(--danger)', marginBottom: 12 }}
          >
            {importError}
          </div>
        )}

        {pendingImport && !importError ? (
          <>
            <div data-testid="import-found" className="found">
              <FileIcon size={22} className="ico" />
              <div>
                <b>{pendingImport.fileName}: {pendingImport.summaryText}</b>
              </div>
            </div>

            {pendingImport.kind === 'scenario' ? (
              <label data-testid="import-add" className="radio">
                <input
                  type="radio"
                  name="import-choice"
                  value="add"
                  checked={true}
                  readOnly
                />
                Add as a new scenario
              </label>
            ) : (
              <>
                <label data-testid="import-add" className="radio">
                  <input
                    type="radio"
                    name="import-choice"
                    value="add"
                    checked={choice === 'add'}
                    onChange={() => setChoice('add')}
                  />
                  Add to what you have
                </label>
                <label data-testid="import-replace" className="radio danger">
                  <input
                    type="radio"
                    name="import-choice"
                    value="replace"
                    checked={choice === 'replace'}
                    onChange={() => setChoice('replace')}
                  />
                  Replace everything in {siteName}
                </label>
              </>
            )}
          </>
        ) : (
          <div
            data-testid="import-drop"
            className="drop"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const f = e.dataTransfer.files?.[0];
              if (f) processFile(f);
            }}
          >
            <ImportIcon size={28} className="ico" />
            <div>
              <b>Drop a file here</b> or
            </div>
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn blue"
                // Keyboard users land inside the dialog, on its main action.
                autoFocus
                onClick={() => fileInputRef.current?.click()}
              >
                <FileIcon size={16} />
                Choose file
              </button>
            </div>
            <div className="kinds">
              <span>wemock export</span>
              <span>HAR from Network</span>
              <span>OpenAPI or Swagger</span>
              <span>JSON mock file</span>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export default ImportDialog;
