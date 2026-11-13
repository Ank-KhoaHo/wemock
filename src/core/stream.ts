import type { MockStream } from './types';

const SSE_FIELD_RE = /^(?:event:|id:|data:|retry:|:)/;

export function sseFrame(chunk: string): string {
  const normalized = chunk.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const allFields = lines.length > 0 && lines.every((line) => SSE_FIELD_RE.test(line));
  if (allFields) {
    return normalized.replace(/\n*$/, '') + '\n\n';
  }
  return lines.map((line) => `data: ${line}`).join('\n') + '\n\n';
}

export interface ParsedSseFrame {
  event: string;
  id: string;
  data: string;
}

export function parseSseFrame(frame: string): ParsedSseFrame {
  const trimmed = frame.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  if (!trimmed) {
    return { event: 'message', id: '', data: '' };
  }
  const lines = trimmed.split('\n');
  const hasFieldLines = lines.some((l) => SSE_FIELD_RE.test(l));
  if (!hasFieldLines) {
    return { event: 'message', id: '', data: trimmed };
  }

  let event = 'message';
  let id = '';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('event:')) {
      let val = line.slice(6);
      if (val.startsWith(' ')) val = val.slice(1);
      event = val;
    } else if (line.startsWith('id:')) {
      let val = line.slice(3);
      if (val.startsWith(' ')) val = val.slice(1);
      id = val;
    } else if (line.startsWith('data:')) {
      let val = line.slice(5);
      if (val.startsWith(' ')) val = val.slice(1);
      dataLines.push(val);
    }
  }

  return {
    event,
    id,
    data: dataLines.join('\n'),
  };
}

export function streamBodyText(stream: MockStream): string {
  if (stream.sse) {
    return stream.chunks.map(sseFrame).join('');
  }
  return stream.chunks.join('');
}
