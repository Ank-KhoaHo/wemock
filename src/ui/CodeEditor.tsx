import { useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { search } from '@codemirror/search';
import { codeCompletions } from '../core/codeHints';
import { indentGuides } from './indentGuides';

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  dark?: boolean;
  /** Code mocks edit JavaScript; bodies edit JSON, or plain text when large or not JSON. */
  language?: 'json' | 'javascript' | 'text';
  paramNames?: string[];
  fill?: boolean;
  readOnly?: boolean;
}

export default function CodeEditor({
  value,
  onChange,
  dark = false,
  language = 'json',
  paramNames,
  fill = false,
  readOnly = false,
}: Readonly<CodeEditorProps>) {
  const paramNamesRef = useRef(paramNames);
  paramNamesRef.current = paramNames;

  const extensions = useMemo(() => {
    const shared = [search({ top: true }), indentGuides()];
    if (language === 'javascript') {
      const source = (context: CompletionContext): CompletionResult | null => {
        const textBefore = context.state.sliceDoc(0, context.pos);
        const result = codeCompletions(textBefore, paramNamesRef.current ?? []);
        if (!result) return null;
        return {
          from: result.from,
          options: result.options,
          validFor: /^[a-zA-Z0-9_$]*$/,
        };
      };
      return [javascript(), autocompletion({ override: [source] }), ...shared];
    }
    if (language === 'text') return shared;
    return [json(), ...shared];
  }, [language]);

  return (
    <CodeMirror
      value={value}
      height={fill ? '100%' : '220px'}
      className={fill ? 'cm-fill' : undefined}
      theme={dark ? 'dark' : 'light'}
      extensions={extensions}
      readOnly={readOnly}
      onChange={onChange}
    />
  );
}
