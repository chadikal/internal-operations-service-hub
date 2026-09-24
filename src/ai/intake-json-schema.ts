export const INTAKE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    situation: {
      type: 'string',
      enum: ['problem', 'need'],
    },
    troubleshootingSteps: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 3,
    },
    missingInformation: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Details required before a request can be prepared. When this array is not empty, draft must be null. Do not put optional extras here.',
    },
    suggestions: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Optional helpful details. These do not block preparing a request. A valid draft may still be present when this array is not empty.',
    },
    draft: {
      description:
        'Null unless a specific allowed department and summary can be produced. Must be null for thin input such as "I need help."',
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            departmentId: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
            summary: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            description: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
              description:
                'First-person text the employee will submit, such as "I need a certificate from HR". Preserve their meaning and details. Do not invent missing information or write in the third person.',
            },
          },
          required: ['departmentId', 'summary', 'description'],
        },
      ],
    },
  },
  required: ['situation', 'troubleshootingSteps', 'missingInformation', 'suggestions', 'draft'],
};
