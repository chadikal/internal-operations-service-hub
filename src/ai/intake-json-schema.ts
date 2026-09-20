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
        'Optional extra details the employee can add. A valid draft may still be present when this array is not empty.',
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
            description: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
          required: ['departmentId', 'summary', 'description'],
        },
      ],
    },
  },
  required: ['situation', 'troubleshootingSteps', 'missingInformation', 'draft'],
};
