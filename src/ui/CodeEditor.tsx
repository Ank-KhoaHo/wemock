import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  dark?: boolean;
}

export default function CodeEditor({ value, onChange, dark = false }: CodeEditorProps) {
  return (
    <CodeMirror
      value={value}
      height="220px"
      theme={dark ? 'dark' : 'light'}
      extensions={[json()]}
      onChange={onChange}
    />
  );
}
