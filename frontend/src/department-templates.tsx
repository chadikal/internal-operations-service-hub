import { ChangeEvent } from 'react';
import { ApprovalPolicy, DepartmentTemplate, TemplateSuggestion } from './api';

export type DraftSuggestion = TemplateSuggestion & { key: string };

let draftKey = 0;

export function draftsFromTemplate(template: DepartmentTemplate | undefined): DraftSuggestion[] {
  if (!template) {
    return [];
  }
  return template.suggestions.map((item) => ({
    key: `suggestion-${draftKey++}`,
    name: item.name,
    approvalPolicy: item.approvalPolicy,
  }));
}

export function confirmedSuggestions(drafts: DraftSuggestion[]): TemplateSuggestion[] {
  return drafts.map((item) => ({
    name: item.name.trim(),
    approvalPolicy: item.approvalPolicy,
  }));
}

export function TemplateSuggestionEditor({
  drafts,
  scope,
  onChange,
}: {
  drafts: DraftSuggestion[];
  scope: string;
  onChange: (next: DraftSuggestion[]) => void;
}) {
  return (
    <div className="type-block" data-testid={`template-suggestions-for-${scope}`}>
      <p className="muted">Suggested request types for {scope}</p>
      {drafts.length === 0 ? <p className="muted">No suggested types in this review.</p> : null}
      {drafts.map((draft, index) => (
        <div className="actions" key={draft.key}>
          <label>
            Suggested type name {index + 1} for {scope}
            <input
              value={draft.name}
              onChange={(event) => {
                const next = drafts.map((item) =>
                  item.key === draft.key ? { ...item, name: event.target.value } : item,
                );
                onChange(next);
              }}
              required
              maxLength={200}
            />
          </label>
          <label>
            Suggested approval policy {index + 1} for {scope}
            <select
              value={draft.approvalPolicy}
              onChange={(event) => {
                const next = drafts.map((item) =>
                  item.key === draft.key
                    ? { ...item, approvalPolicy: event.target.value as ApprovalPolicy }
                    : item,
                );
                onChange(next);
              }}
            >
              <option value="NONE">None</option>
              <option value="DEPARTMENT_ADMIN">Department Admin</option>
              <option value="SUPER_ADMIN">Super Admin</option>
            </select>
          </label>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => onChange(drafts.filter((item) => item.key !== draft.key))}
          >
            Remove suggested type {index + 1} for {scope}
          </button>
        </div>
      ))}
      <button
        className="btn-secondary"
        type="button"
        onClick={() =>
          onChange([
            ...drafts,
            { key: `suggestion-${draftKey++}`, name: '', approvalPolicy: 'NONE' },
          ])
        }
      >
        Add a suggested type for {scope}
      </button>
    </div>
  );
}

export function TemplatePicker({
  id,
  label,
  templates,
  value,
  allowNone,
  onChange,
}: {
  id?: string;
  label: string;
  templates: DepartmentTemplate[];
  value: string;
  allowNone?: boolean;
  onChange: (templateId: string) => void;
}) {
  return (
    <label>
      {label}
      <select
        id={id}
        value={value}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.currentTarget.value)}
      >
        {allowNone ? <option value="">No template selected</option> : null}
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </select>
    </label>
  );
}
