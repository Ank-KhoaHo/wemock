import React, { Suspense, useEffect, useState } from 'react';
import { base64ToBytes, bytesToBase64 } from '../core/bodies';
import type { BodyEncoding } from '../core/types';

const CodeEditor = React.lazy(() => import('./CodeEditor'));

export interface BodyEditorProps {
  body: string;
  bodyEncoding: BodyEncoding;
  contentType: string;
  onChangeBody: (body: string, encoding: BodyEncoding) => void;
  onChangeContentType: (contentType: string) => void;
  onLoadFile?: (body: string, encoding: BodyEncoding, contentType: string) => void;
  mockName?: string;
  isDark?: boolean;
}

export function BodyEditor({
  body,
  bodyEncoding,
  contentType,
  onChangeBody,
  onChangeContentType,
  onLoadFile,
  mockName,
  isDark = false,
}: BodyEditorProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Validate JSON if content-type contains json and bodyEncoding is text
  let isJsonWarning = false;
  const isJsonType = contentType.toLowerCase().includes('json');
  if (isJsonType && bodyEncoding === 'text' && body.trim()) {
    try {
      JSON.parse(body);
    } catch {
      isJsonWarning = true;
    }
  }

  // Manage preview URL for base64 image bodies
  useEffect(() => {
    if (bodyEncoding !== 'base64' || !body) {
      setPreviewUrl(null);
      return;
    }
    const isImage = contentType.toLowerCase().startsWith('image/');
    if (!isImage) {
      setPreviewUrl(null);
      return;
    }
    try {
      const bytes = base64ToBytes(body);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: contentType });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } catch {
      setPreviewUrl(null);
    }
  }, [body, bodyEncoding, contentType]);

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const base64 = bytesToBase64(bytes);
      const type = file.type || 'application/octet-stream';
      if (onLoadFile) {
        onLoadFile(base64, 'base64', type);
      } else {
        onChangeContentType(type);
        onChangeBody(base64, 'base64');
      }
    } catch {}
    e.target.value = '';
  };

  const handleDownload = () => {
    try {
      const bytes = base64ToBytes(body);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: contentType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = mockName || 'mock-file';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {}
  };

  let byteLength = 0;
  if (bodyEncoding === 'base64') {
    try {
      byteLength = base64ToBytes(body).byteLength;
    } catch {
      byteLength = 0;
    }
  }

  return (
    <div className="body-editor-container">
      <div className="body-editor-toolbar">
        <label className="field-label">Response Body</label>
        <div className="file-input-wrapper">
          <button type="button" className="btn-secondary load-file-label">
            Load file
          </button>
          <input
            type="file"
            data-testid="load-file"
            className="overlay-file-input"
            onChange={handleFilePicked}
          />
        </div>
      </div>

      {isJsonWarning && (
        <div data-testid="json-warning" className="json-warning-banner">
          Warning: Body is not valid JSON. It will still be saved and served.
        </div>
      )}

      {bodyEncoding === 'base64' ? (
        <div className="binary-body-view">
          <div data-testid="body-size" className="body-size-info">
            {byteLength} bytes, {contentType || 'application/octet-stream'}
          </div>

          {previewUrl && (
            <div className="body-preview-container">
              <img
                data-testid="body-preview"
                src={previewUrl}
                alt="Binary preview"
                className="body-preview-image"
              />
            </div>
          )}

          <div className="binary-actions">
            <button
              type="button"
              data-testid="body-download"
              className="btn-secondary"
              onClick={handleDownload}
            >
              Download
            </button>
            <button
              type="button"
              data-testid="body-to-text"
              className="btn-secondary"
              onClick={() => onChangeBody('', 'text')}
            >
              Switch to text
            </button>
          </div>
        </div>
      ) : (
        <div className="text-editor-view">
          <Suspense fallback={<div className="editor-loading">Loading editor...</div>}>
            <CodeEditor
              value={body}
              dark={isDark}
              onChange={(val) => onChangeBody(val, 'text')}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}

export default BodyEditor;
