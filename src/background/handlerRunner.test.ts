import { describe, expect, it, vi } from 'vitest';
import { emptyState, newProject, type Mock, type WemockState } from '../core/types';
import { findCodeMock, isRunHandlerMessage, runHandler, type RunHandlerMessage } from './handlerRunner';

const EXT = 'extid';

function mock(id: string, reply?: 'code' | 'fixed'): Mock {
  return {
    id,
    enabled: true,
    method: 'GET',
    urlPattern: '/doc/:id',
    ...(reply ? { reply } : {}),
    code: 'return 1',
    response: { status: 200, headers: {}, body: '', bodyEncoding: 'text', delayMs: 0 },
    source: 'manual',
    createdAt: 0,
  };
}

function state(): WemockState {
  const a = newProject('pa', 'http://a.test');
  a.scenarios[0]!.mocks.push(mock('code-a', 'code'), mock('fixed-a'));
  a.scenarios.push({ id: 's2', name: 'Two', mocks: [mock('code-a2', 'code')] });
  const b = newProject('pb', 'http://b.test');
  b.scenarios[0]!.mocks.push(mock('code-b', 'code'));
  return { ...emptyState(), projects: [a, b] };
}

const req = { method: 'GET', url: 'http://a.test/doc/1', headers: {} };
const msg = (mockId: string, projectId?: string): RunHandlerMessage => ({ type: 'run-handler', mockId, request: req, ...(projectId ? { projectId } : {}) });
const tab = (url: string) => ({ id: EXT, url, tab: { id: 1 } });
const panel = { id: EXT, url: `chrome-extension://${EXT}/panel.html?tabId=1` };

describe('findCodeMock', () => {
  it('a tab runs code mocks of its own origin, in the active scenario or default', () => {
    expect(findCodeMock(state(), tab('http://a.test/page'), msg('code-a'), EXT)?.id).toBe('code-a');
    expect(findCodeMock(state(), tab('http://a.test/page'), msg('code-a2'), EXT)).toBeNull();
    const withS2 = {
      ...state(),
      projects: state().projects.map((p) => (p.id === 'pa' ? { ...p, activeScenarioId: 's2' } : p)),
    };
    expect(findCodeMock(withS2, tab('http://a.test/page'), msg('code-a2'), EXT)?.id).toBe('code-a2');
  });
  it('a tab cannot reach another project, even naming its project id', () => {
    expect(findCodeMock(state(), tab('http://a.test/page'), msg('code-b'), EXT)).toBeNull();
    expect(findCodeMock(state(), tab('http://a.test/page'), msg('code-b', 'pb'), EXT)).toBeNull();
  });
  it('a fixed mock is never run', () => {
    expect(findCodeMock(state(), tab('http://a.test/page'), msg('fixed-a'), EXT)).toBeNull();
  });
  it('our own page names the project; without one it gets nothing', () => {
    expect(findCodeMock(state(), panel, msg('code-b', 'pb'), EXT)?.id).toBe('code-b');
    expect(findCodeMock(state(), panel, msg('code-b'), EXT)).toBeNull();
    expect(findCodeMock(state(), { ...panel, tab: { id: 3 } }, msg('code-b', 'pb'), EXT)?.id).toBe('code-b');
  });
  it('another extension, or a look-alike URL, gets nothing', () => {
    expect(findCodeMock(state(), { ...panel, id: 'other' }, msg('code-b', 'pb'), EXT)).toBeNull();
    expect(findCodeMock(state(), tab(`http://a.test/chrome-extension://${EXT}/`), msg('code-b', 'pb'), EXT)).toBeNull();
  });
});

describe('isRunHandlerMessage', () => {
  it('accepts a well-formed message and rejects bad shapes', () => {
    expect(isRunHandlerMessage(msg('x'))).toBe(true);
    expect(isRunHandlerMessage({ ...msg('x'), code: 'evil' })).toBe(true); // extra fields are ignored, never run
    expect(isRunHandlerMessage({ ...msg('x'), type: 'log' })).toBe(false);
    expect(isRunHandlerMessage({ ...msg('x'), request: { ...req, headers: { a: 1 } } })).toBe(false);
    expect(isRunHandlerMessage({ ...msg('x'), request: { ...req, body: 3 } })).toBe(false);
    expect(isRunHandlerMessage({ ...msg('x'), projectId: 4 })).toBe(false);
  });
});

describe('runHandler', () => {
  it('sends the stored code, never code from the message, and converts the outcome', async () => {
    const runInOffscreen = vi.fn(async () => ({ ok: true as const, kind: 'json' as const, value: '1', res: { status: 202, headers: {}, delayMs: 0 } }));
    const reply = await runHandler(
      { ...msg('code-a'), code: 'evil' } as RunHandlerMessage,
      tab('http://a.test/p'),
      { extensionId: EXT, loadState: async () => state(), runInOffscreen },
    );
    expect(runInOffscreen).toHaveBeenCalledWith(expect.objectContaining({ code: 'return 1', timeoutMs: 1000, target: 'wemock-offscreen' }));
    expect(reply.response.status).toBe(202);
  });
  it('answers the error reply when the mock is missing or the sandbox throws', async () => {
    const io = { extensionId: EXT, loadState: async () => state(), runInOffscreen: vi.fn() };
    expect((await runHandler(msg('nope'), tab('http://a.test/p'), io)).response.status).toBe(500);
    expect(io.runInOffscreen).not.toHaveBeenCalled();
    const broken = { ...io, runInOffscreen: async () => { throw new Error('gone'); } };
    expect((await runHandler(msg('code-a'), tab('http://a.test/p'), broken)).error).toMatch(/gone/);
  });
});
