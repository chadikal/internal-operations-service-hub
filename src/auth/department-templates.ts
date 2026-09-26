import { ApprovalPolicy } from '@prisma/client';

export const DEPARTMENT_TEMPLATE_IDS = [
  'IT',
  'HR',
  'FINANCE',
  'OPERATIONS',
  'MARKETING',
  'FACILITIES',
  'CUSTOM_EMPTY',
] as const;

export type DepartmentTemplateId = (typeof DEPARTMENT_TEMPLATE_IDS)[number];

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

function suggestion(name: string, approvalPolicy: ApprovalPolicy): TemplateSuggestion {
  return { name, approvalPolicy };
}

/**
 * Recommended catalog recorded in docs/product-spec.md. These are suggestions
 * for Super Admin review, not company policy, and are not applied at signup.
 * Changing a suggestion does not rename types already stored for a company
 * or rewrite captured approval policies on submitted requests.
 */
export const DEPARTMENT_TEMPLATES: Record<DepartmentTemplateId, DepartmentTemplate> = {
  IT: {
    id: 'IT',
    name: 'IT',
    suggestions: [
      suggestion('Hardware', ApprovalPolicy.NONE),
      suggestion('Software', ApprovalPolicy.NONE),
      suggestion('Access', ApprovalPolicy.DEPARTMENT_ADMIN),
    ],
    suggestionsRecorded: true,
  },
  HR: {
    id: 'HR',
    name: 'HR',
    suggestions: [
      suggestion('Leave', ApprovalPolicy.DEPARTMENT_ADMIN),
      suggestion('Certificate', ApprovalPolicy.NONE),
    ],
    suggestionsRecorded: true,
  },
  FINANCE: {
    id: 'FINANCE',
    name: 'Finance',
    suggestions: [
      suggestion('Expense', ApprovalPolicy.DEPARTMENT_ADMIN),
      suggestion('Purchase exception', ApprovalPolicy.SUPER_ADMIN),
    ],
    suggestionsRecorded: true,
  },
  OPERATIONS: {
    id: 'OPERATIONS',
    name: 'Operations',
    suggestions: [
      suggestion('Process change', ApprovalPolicy.DEPARTMENT_ADMIN),
      suggestion('Operational support', ApprovalPolicy.NONE),
    ],
    suggestionsRecorded: true,
  },
  MARKETING: {
    id: 'MARKETING',
    name: 'Marketing',
    suggestions: [
      suggestion('Campaign', ApprovalPolicy.DEPARTMENT_ADMIN),
      suggestion('Brand asset', ApprovalPolicy.NONE),
    ],
    suggestionsRecorded: true,
  },
  FACILITIES: {
    id: 'FACILITIES',
    name: 'Facilities',
    suggestions: [
      suggestion('Maintenance / Repair', ApprovalPolicy.NONE),
      suggestion('Access badge', ApprovalPolicy.DEPARTMENT_ADMIN),
    ],
    suggestionsRecorded: true,
  },
  CUSTOM_EMPTY: {
    id: 'CUSTOM_EMPTY',
    name: 'Custom/Empty',
    suggestions: [],
    suggestionsRecorded: true,
  },
};

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
