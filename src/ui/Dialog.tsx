import { type ReactNode, useEffect, useId } from 'react';

export interface DialogProps {
  title: ReactNode;
  onClose: () => void;
  testId: string;
  className?: string;
  role?: 'dialog' | 'alertdialog';
  headerAction?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

export function Dialog({
  title,
  onClose,
  testId,
  className,
  role = 'dialog',
  headerAction,
  footer,
  children,
}: Readonly<DialogProps>) {
  const titleId = useId();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={className ? `dialog ${className}` : 'dialog'}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          {headerAction}
        </header>
        {children}
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}
