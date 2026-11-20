import { type ReactNode, useEffect, useState } from 'react';
import { CheckIcon, CopyIcon } from './icons';
import { notify } from './Toasts';

const COPIED_MS = 1500;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function headersText(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
}

export interface CopyableProps {
  text: string;
  label: string;
  children: ReactNode;
}

export function Copyable({ text, label, children }: Readonly<CopyableProps>) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    if (await copyText(text)) setCopied(true);
    else notify('Could not copy', { tone: 'error' });
  };

  if (!text) return <>{children}</>;

  return (
    <div className="copyable">
      {children}
      <button
        type="button"
        className="copy-btn"
        aria-label={copied ? 'Copied' : label}
        title={copied ? 'Copied' : label}
        onClick={handleCopy}
      >
        {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      </button>
    </div>
  );
}
