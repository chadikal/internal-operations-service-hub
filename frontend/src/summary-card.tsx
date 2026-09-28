import { ReactNode } from 'react';

export type SummaryItem = {
  key: string;
  label: string;
  value: number;
  testId?: string;
  href?: string;
  onOpen?: () => void;
};

export function SummaryCard({
  title,
  total,
  totalTestId,
  icon,
  href,
  onOpen,
  items,
  note,
  testId,
  className,
}: {
  title: string;
  total: number;
  totalTestId?: string;
  icon: ReactNode;
  href?: string;
  onOpen?: () => void;
  items: SummaryItem[];
  note?: string;
  testId?: string;
  className?: string;
}) {
  const lead = (
    <>
      <span className="summary-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="summary-figure">
        <strong className="summary-total" data-testid={totalTestId}>
          {total}
        </strong>
        <span className="summary-label">{title}</span>
      </span>
    </>
  );

  return (
    <article
      className={`summary-card${className ? ` ${className}` : ''}${href && onOpen ? ' summary-card-linked' : ''}`}
      data-testid={testId}
    >
      {href && onOpen ? (
        <a
          className="summary-lead summary-card-main"
          href={href}
          onClick={(event) => {
            event.preventDefault();
            onOpen();
          }}
        >
          {lead}
        </a>
      ) : (
        <div className="summary-lead">{lead}</div>
      )}
      {items.length > 0 || note ? (
      <div className="summary-side">
        {items.length > 0 ? (
          <ul className="summary-breakdown">
            {items.map((item) => {
              const body = (
                <>
                  <span>{item.label}</span>
                  <strong data-testid={item.testId}>{item.value}</strong>
                </>
              );
              return (
                <li key={item.key}>
                  {item.href && item.onOpen ? (
                    <a
                      href={item.href}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        item.onOpen?.();
                      }}
                    >
                      {body}
                    </a>
                  ) : (
                    <span className="summary-static">{body}</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
        {note ? <p className="summary-note">{note}</p> : null}
      </div>
      ) : null}
    </article>
  );
}

export function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M16.2 14.6c2.2.3 3.8 1.6 4.3 4.4" />
    </svg>
  );
}

export function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 20V6l8-3 8 3v14" />
      <path d="M9 20v-5h6v5" />
      <path d="M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01" />
    </svg>
  );
}

export function ApprovalsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 12.5l2.2 2.2 4.8-5" />
    </svg>
  );
}

export function RequestsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 3h8l4 4v14H7z" />
      <path d="M15 3v5h5" />
      <path d="M10 12h6M10 16h6" />
    </svg>
  );
}

export function MyRequestsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="3" />
      <path d="M6 19c.8-3 2.8-4.5 6-4.5s5.2 1.5 6 4.5" />
    </svg>
  );
}
