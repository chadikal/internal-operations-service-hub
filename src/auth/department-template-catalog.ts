export const TEMPLATE_POLICIES = ['NONE', 'DEPARTMENT_ADMIN', 'SUPER_ADMIN'] as const;

export type TemplatePolicy = (typeof TEMPLATE_POLICIES)[number];

export type CatalogSuggestion = {
  name: string;
  approvalPolicy: TemplatePolicy;
};

export type CatalogTemplate = {
  id: 'IT' | 'HR' | 'FINANCE' | 'OPERATIONS' | 'MARKETING' | 'FACILITIES' | 'CUSTOM_EMPTY';
  name: string;
  suggestions: CatalogSuggestion[];
};

function suggestion(name: string, approvalPolicy: TemplatePolicy): CatalogSuggestion {
  return { name, approvalPolicy };
}

/** Same catalog the Departments page reviews before applying request types. */
export const DEPARTMENT_TEMPLATE_CATALOG: CatalogTemplate[] = [
  {
    id: 'IT',
    name: 'IT',
    suggestions: [
      suggestion('Hardware', 'NONE'),
      suggestion('Software', 'NONE'),
      suggestion('Access', 'DEPARTMENT_ADMIN'),
    ],
  },
  {
    id: 'HR',
    name: 'HR',
    suggestions: [
      suggestion('Leave', 'DEPARTMENT_ADMIN'),
      suggestion('Certificate', 'NONE'),
    ],
  },
  {
    id: 'FINANCE',
    name: 'Finance',
    suggestions: [
      suggestion('Expense', 'DEPARTMENT_ADMIN'),
      suggestion('Purchase exception', 'SUPER_ADMIN'),
    ],
  },
  {
    id: 'OPERATIONS',
    name: 'Operations',
    suggestions: [
      suggestion('Process change', 'DEPARTMENT_ADMIN'),
      suggestion('Operational support', 'NONE'),
    ],
  },
  {
    id: 'MARKETING',
    name: 'Marketing',
    suggestions: [
      suggestion('Campaign', 'DEPARTMENT_ADMIN'),
      suggestion('Brand asset', 'NONE'),
    ],
  },
  {
    id: 'FACILITIES',
    name: 'Facilities',
    suggestions: [
      suggestion('Maintenance / Repair', 'NONE'),
      suggestion('Access badge', 'DEPARTMENT_ADMIN'),
    ],
  },
  {
    id: 'CUSTOM_EMPTY',
    name: 'Custom/Empty',
    suggestions: [],
  },
];
