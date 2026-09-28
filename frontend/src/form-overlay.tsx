import { ReactNode, useEffect, useId, useLayoutEffect, useRef } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function FormOverlay({
  title,
  returnFocusId,
  onClose,
  wide,
  listenForKeys = true,
  children,
}: {
  title: string;
  returnFocusId: string;
  onClose: () => void;
  wide?: boolean;
  listenForKeys?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusIdRef = useRef(returnFocusId);
  onCloseRef.current = onClose;
  returnFocusIdRef.current = returnFocusId;

  useLayoutEffect(() => {
    closeRef.current?.focus();
    return () => {
      document.getElementById(returnFocusIdRef.current)?.focus();
    };
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (!listenForKeys) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [listenForKeys]);

  return (
    <div className="form-overlay">
      <div className="form-overlay-backdrop" onMouseDown={(event) => event.preventDefault()} />
      <div
        ref={dialogRef}
        className={wide ? 'form-overlay-dialog form-overlay-dialog-wide' : 'form-overlay-dialog'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="form-overlay"
      >
        <div className="form-overlay-toolbar">
          <h2 id={titleId}>{title}</h2>
          <button
            ref={closeRef}
            className="icon-button"
            type="button"
            aria-label="Close"
            onClick={onClose}
            data-testid="close-form"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="form-overlay-body">{children}</div>
      </div>
    </div>
  );
}
