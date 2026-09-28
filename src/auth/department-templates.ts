import { ApprovalPolicy } from '@prisma/client';
import { DEPARTMENT_TEMPLATE_CATALOG, TemplatePolicy } from './department-template-catalog';

export const DEPARTMENT_TEMPLATE_IDS = DEPARTMENT_TEMPLATE_CATALOG.map((item) => item.id);

export type DepartmentTemplateId = (typeof DEPARTMENT_TEMPLATE_CATALOG)[number]['id'];

export type TemplateSuggestion = {
  name: string;
  approvalPolicy: ApprovalPolicy;
};

export type DepartmentTemplate = {
  id: DepartmentTemplateId;
  name: string;
  suggestions: TemplateSuggestion[];
  suggestionsRecorded: boolean;
};

function policy(value: TemplatePolicy): ApprovalPolicy {
  if (value === 'DEPARTMENT_ADMIN') return ApprovalPolicy.DEPARTMENT_ADMIN;
  if (value === 'SUPER_ADMIN') return ApprovalPolicy.SUPER_ADMIN;
  return ApprovalPolicy.NONE;
}

/**
 * Recommended catalog recorded in docs/product-spec.md. These are suggestions
 * for review, not company policy, until a Super Admin or founder confirms them.
 * Changing a suggestion does not rename types already stored for a company
 * or rewrite captured approval policies on submitted requests.
 */
export const DEPARTMENT_TEMPLATES: Record<DepartmentTemplateId, DepartmentTemplate> = Object.fromEntries(
  DEPARTMENT_TEMPLATE_CATALOG.map((item) => [
    item.id,
    {
      id: item.id,
      name: item.name,
      suggestions: item.suggestions.map((entry) => ({
        name: entry.name,
        approvalPolicy: policy(entry.approvalPolicy),
      })),
      suggestionsRecorded: true,
    },
  ]),
) as Record<DepartmentTemplateId, DepartmentTemplate>;

export function isDepartmentTemplateId(value: string): value is DepartmentTemplateId {
  return (DEPARTMENT_TEMPLATE_IDS as readonly string[]).includes(value);
}

export function listDepartmentTemplates(): DepartmentTemplate[] {
  return DEPARTMENT_TEMPLATE_IDS.map((id) => DEPARTMENT_TEMPLATES[id]);
}

export function getDepartmentTemplate(id: string): DepartmentTemplate | null {
  if (!isDepartmentTemplateId(id)) {
    return null;
  }
  return DEPARTMENT_TEMPLATES[id];
}

export function unspecifiedTemplateNotice(template: DepartmentTemplate): string | null {
  if (template.suggestionsRecorded) {
    return null;
  }
  return `The product spec names the ${template.name} template but does not list suggested request types or approval policies.`;
}

export type DepartmentTemplatePreview = DepartmentTemplate & {
  unspecifiedNotice: string | null;
};

export function toTemplatePreview(template: DepartmentTemplate): DepartmentTemplatePreview {
  return {
    ...template,
    unspecifiedNotice: unspecifiedTemplateNotice(template),
  };
}
