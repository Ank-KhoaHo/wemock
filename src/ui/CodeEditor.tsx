import { useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { codeCompletions } from '../core/codeHints';

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  dark?: boolean;
  /** A2: code mocks edit JavaScript; bodies edit JSON. */
  language?: 'json' | 'javascript';
  paramNames?: string[];
}

export default function CodeEditor({
  value,
  onChange,
  dark = false,
  language = 'json',
  paramNames,
}: CodeEditorProps) {
  const paramNamesRef = useRef(paramNames);
  paramNamesRef.current = paramNames;

  const extensions = useMemo(() => {
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
      return [javascript(), autocompletion({ override: [source] })];
    }
    return [json()];
  }, [language]);

  return (
    <CodeMirror
      value={value}
      height="220px"
      theme={dark ? 'dark' : 'light'}
      extensions={extensions}
      onChange={onChange}
    />
  );
}
