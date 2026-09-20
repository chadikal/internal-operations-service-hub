import { Injectable } from '@nestjs/common';
import {
  AiDepartmentContext,
  AiProvider,
  AiProviderInput,
} from './ai-provider';
import { IntakeResult } from './intake.schema';

@Injectable()
export class MockAiProvider implements AiProvider {
  async complete(input: AiProviderInput): Promise<IntakeResult> {
    return buildMockIntakeOutput(input.employeeText, input.departments);
  }
}

export function buildMockIntakeOutput(
  employeeText: string,
  departments: AiDepartmentContext[],
): IntakeResult {
  const text = employeeText.trim();
  const lower = text.toLowerCase();
  const itId = departmentIdByName(departments, 'IT');
  const hrId = departmentIdByName(departments, 'HR');

  if (/\blegal\b/.test(lower)) {
    return {
      situation: 'need',
      troubleshootingSteps: [],
      missingInformation: [
        'The requested department is not available. Choose IT, HR, or Finance, or add more detail.',
      ],
      draft: null,
    };
  }

  const mentionsProblem =
    /broken|won't|will not|not working|can't|cannot|issue|problem|connect|wi-fi|wifi/.test(
      lower,
    );
  const mentionsCertificate = /certificate/.test(lower);
  if (mentionsProblem && mentionsCertificate) {
    return {
      situation: 'need',
      troubleshootingSteps: [],
      missingInformation: [
        'This message describes more than one need. Say whether you want help with a computer problem or an HR document.',
      ],
      draft: null,
    };
  }

  if (/^\s*i need help\.?\s*$/i.test(text) || /^\s*help\.?\s*$/i.test(text)) {
    return {
      situation: 'need',
      troubleshootingSteps: [],
      missingInformation: [
        'What you need help with',
        'Which department should handle this',
      ],
      draft: null,
    };
  }

  if (/employment certificate|certificate from hr/.test(lower)) {
    return {
      situation: 'need',
      troubleshootingSteps: [],
      missingInformation: [
        'Purpose or recipient of the certificate',
        'Deadline if there is one',
        'Preferred format or language',
      ],
      draft: {
        departmentId: hrId,
        summary: 'Employment certificate',
        description: text,
      },
    };
  }

  if (
    /wi-fi|wifi|won't connect|will not connect|cannot connect|can't connect/.test(
      lower,
    )
  ) {
    return {
      situation: 'problem',
      troubleshootingSteps: [
        'Turn Wi-Fi off and on again on the laptop.',
        'Forget the network and reconnect using the company password.',
        'Restart the laptop and try another known working network if one is available.',
      ],
      missingInformation: [],
      draft: {
        departmentId: itId,
        summary: 'Laptop cannot connect to Wi-Fi',
        description: text,
      },
    };
  }

  if (/need a laptop|need a new laptop/.test(lower)) {
    return {
      situation: 'need',
      troubleshootingSteps: [],
      missingInformation: [],
      draft: {
        departmentId: itId,
        summary: 'Laptop request',
        description: text,
      },
    };
  }

  return {
    situation: 'need',
    troubleshootingSteps: [],
    missingInformation: [
      'More detail about what you need so a department and summary can be suggested.',
    ],
    draft: null,
  };
}

function departmentIdByName(
  departments: AiDepartmentContext[],
  name: string,
): number | null {
  const match = departments.find(
    (department) => department.name.toLowerCase() === name.toLowerCase(),
  );
  return match ? match.id : null;
}
