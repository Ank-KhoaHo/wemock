import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  dark?: boolean;
  /** A2: code mocks edit JavaScript; bodies edit JSON. */
  language?: 'json' | 'javascript';
}

export default function CodeEditor({ value, onChange, dark = false, language = 'json' }: CodeEditorProps) {
  return (
    <CodeMirror
      value={value}
      height="220px"
      theme={dark ? 'dark' : 'light'}
      extensions={[language === 'javascript' ? javascript() : json()]}
      onChange={onChange}
    />
  );
}
