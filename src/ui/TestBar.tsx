import { useEffect, useRef, useState } from 'react';
import { base64ToBytes } from '../core/bodies';
import { errorReply, type HandlerReply, type HandlerRequest } from '../core/handler';
import { RUN_HANDLER, isHandlerReply } from '../core/messages';
import { statusTextFor } from '../core/statusText';
import { testCall } from '../core/testCall';
import type { Mock, MockResponse, Project } from '../core/types';
import { DEFAULT_SCENARIO_ID } from '../core/types';

export interface TestBarProps {
  project: Project | null;
  pageOrigin: string;
  onOpenMock: (scenarioId: string, mockId: string) => void;
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function formatBodyOut(response: MockResponse): string {
  if (response.bodyEncoding === 'base64') {
    let byteLength = 0;
    try {
      byteLength = base64ToBytes(response.body).byteLength;
    } catch {
      // fallback
    }
    const contentType =
      findHeader(response.headers, 'content-type') || 'application/octet-stream';
    return `${byteLength} bytes, ${contentType}`;
  }
  return response.body;
}

function findScenarioId(project: Project, mockId: string): string {
  const activeSc = project.scenarios.find((s) => s.id === project.activeScenarioId);
  if (activeSc && activeSc.mocks.some((m) => m.id === mockId)) {
    return activeSc.id;
  }
  const defaultSc =
    project.scenarios.find((s) => s.id === DEFAULT_SCENARIO_ID) ?? project.scenarios[0];
  if (defaultSc && defaultSc.mocks.some((m) => m.id === mockId)) {
    return defaultSc.id;
  }
  const found = project.scenarios.find((s) => s.mocks.some((m) => m.id === mockId));
  return found?.id ?? project.activeScenarioId;
}

export function TestBar({ project, pageOrigin, onOpenMock }: TestBarProps) {
  const [method, setMethod] = useState<string>('GET');
  const [url, setUrl] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [testOutput, setTestOutput] = useState<
    | { kind: 'nomatch' }
    | {
        kind: 'match';
        mock: Mock;
        scenarioName: string | null;
        scenarioId: string;
        reply: HandlerReply | null;
      }
    | null
  >(null);

  const prevProjectIdRef = useRef<string | null>(project?.id ?? null);
  useEffect(() => {
    if (prevProjectIdRef.current !== (project?.id ?? null)) {
      prevProjectIdRef.current = project?.id ?? null;
      setUrlError(null);
      setTestOutput(null);
    }
  }, [project?.id]);

  const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const isRunDisabled = !url.trim() || isRunning || !project;

  const handleRun = async () => {
    if (isRunDisabled) return;

    const reqBody = hasBody && body.length > 0 ? body : undefined;
    const result = testCall(
      project,
      {
        method,
        url,
        body: reqBody,
      },
      pageOrigin,
    );

    if (!result.ok) {
      setUrlError(result.error);
      setTestOutput(null);
      return;
    }

    setUrlError(null);

    if (!result.mock) {
      setTestOutput({ kind: 'nomatch' });
      return;
    }

    const matchedMock = result.mock;
    const scenarioId = findScenarioId(project, matchedMock.id);

    if (matchedMock.reply !== 'code') {
      setTestOutput({
        kind: 'match',
        mock: matchedMock,
        scenarioName: result.scenarioName,
        scenarioId,
        reply: { response: matchedMock.response },
      });
      return;
    }

    setIsRunning(true);
    setTestOutput({
      kind: 'match',
      mock: matchedMock,
      scenarioName: result.scenarioName,
      scenarioId,
      reply: null,
    });

    try {
      const request: HandlerRequest = {
        method,
        url: result.url,
        headers: {},
        ...(reqBody !== undefined ? { body: reqBody } : {}),
      };

      const reply = await browser.runtime.sendMessage({
        type: RUN_HANDLER,
        mockId: matchedMock.id,
        projectId: project.id,
        request,
      });

      if (isHandlerReply(reply)) {
        setTestOutput((prev) =>
          prev && prev.kind === 'match' ? { ...prev, reply } : prev,
        );
      } else {
        setTestOutput((prev) =>
          prev && prev.kind === 'match'
            ? { ...prev, reply: errorReply('Invalid reply from background') }
            : prev,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestOutput((prev) =>
        prev && prev.kind === 'match' ? { ...prev, reply: errorReply(msg) } : prev,
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div data-testid="test-bar" className="test-bar">
      <div className="test-bar-row">
        <select
          data-testid="test-method"
          className="test-method-select"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
          <option value="HEAD">HEAD</option>
          <option value="OPTIONS">OPTIONS</option>
        </select>
        <input
          type="text"
          data-testid="test-url"
          className="test-url-input"
          placeholder="/api/users/1 or https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isRunDisabled) {
              e.preventDefault();
              handleRun();
            }
          }}
        />
        <button
          type="button"
          data-testid="test-run"
          className="btn-primary test-run-btn"
          disabled={isRunDisabled}
          onClick={handleRun}
        >
          Test
        </button>
      </div>

      {hasBody && (
        <div className="test-body-row">
          <textarea
            data-testid="test-body"
            className="test-body-textarea"
            placeholder="Request body (optional)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
      )}

      {urlError && (
        <div data-testid="test-url-error" className="test-url-error">
          {urlError}
        </div>
      )}

      {testOutput && testOutput.kind === 'nomatch' && (
        <div data-testid="test-nomatch" className="test-nomatch">
          No mock — the real server answers
        </div>
      )}

      {testOutput && testOutput.kind === 'match' && (
        <div className="test-result">
          <div data-testid="test-match" className="test-match">
            <span className="test-match-label">Matched: </span>
            <button
              type="button"
              data-testid="test-open"
              className="test-open-btn"
              onClick={() => onOpenMock(testOutput.scenarioId, testOutput.mock.id)}
            >
              {testOutput.mock.name?.trim() ? testOutput.mock.name : testOutput.mock.urlPattern}
            </button>
            {testOutput.scenarioName && (
              <span data-testid="test-scenario" className="test-scenario-badge">
                {testOutput.scenarioName}
              </span>
            )}
          </div>

          {isRunning ? (
            <div className="test-running">Running…</div>
          ) : testOutput.reply ? (
            <div className="test-reply">
              {testOutput.reply.error && (
                <div data-testid="test-error" className="test-error">
                  Code failed: {testOutput.reply.error}
                </div>
              )}
              <div data-testid="test-status" className="test-status">
                {`${testOutput.reply.response.status} ${statusTextFor(testOutput.reply.response.status)}`.trim()}
              </div>
              {Object.keys(testOutput.reply.response.headers).length > 0 && (
                <div data-testid="test-headers" className="test-headers">
                  {Object.entries(testOutput.reply.response.headers)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join('\n')}
                </div>
              )}
              <div data-testid="test-body-out" className="test-body-out">
                {formatBodyOut(testOutput.reply.response)}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default TestBar;
