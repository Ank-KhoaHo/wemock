import React, { Suspense } from 'react';
import { bodyLanguage } from '../core/bodies';
import { Copyable } from './Copyable';
import { ResizableBody } from './Splitter';

const CodeEditor = React.lazy(() => import('./CodeEditor'));

export interface ResponseBodyProps {
  value: string;
  dark?: boolean;
  testId?: string;
  /** Without it the body is read-only. */
  onChange?: (value: string) => void;
}

export function ResponseBody({ value, dark = false, testId, onChange }: Readonly<ResponseBodyProps>) {
  return (
    <ResizableBody>
      <Copyable text={value} label="Copy response body">
        <div data-testid={testId} className="text-editor-view">
          <Suspense fallback={<div className="editor-loading">Loading editor...</div>}>
            <CodeEditor
              value={value}
              dark={dark}
              language={bodyLanguage(value)}
              readOnly={!onChange}
              fill
              onChange={onChange}
            />
          </Suspense>
        </div>
      </Copyable>
    </ResizableBody>
  );
}
