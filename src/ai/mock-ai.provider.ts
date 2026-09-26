import { Injectable } from '@nestjs/common';
import {
  AiDepartmentContext,
  AiProvider,
  AiProviderInput,
  AiRequestTypeContext,
} from './ai-provider';
import { IntakeResult } from './intake.schema';

@Injectable()
export class MockAiProvider implements AiProvider {
  async complete(input: AiProviderInput): Promise<IntakeResult> {
    return buildMockIntakeOutput(input.employeeText, input.departments, input.requestTypes);
  }
}

export function buildMockIntakeOutput(
  employeeText: string,
  departments: AiDepartmentContext[],
  requestTypes: AiRequestTypeContext[] = [],
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
      suggestions: [],
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
      suggestions: [],
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
      suggestions: [],
      draft: null,
    };
  }

  if (/employment certificate|certificate from hr/.test(lower)) {
    return {
      situation: 'need',
      troubleshootingSteps: [],
      missingInformation: [],
      suggestions: [
        'Purpose or recipient of the certificate',
        'Deadline if there is one',
        'Preferred format or language',
      ],
      draft: {
        departmentId: hrId,
        requestTypeId: typeIdForIntent(requestTypes, hrId, 'certificate'),
        summary: 'Employment certificate',
        description: text,
      },
    };
  }

  const entitlement = hasEntitlementIntent(lower);
  const failure = hasFailureIntent(lower);
  const departmentId = departmentIdForText(lower, departments) ?? itId;

  if (entitlement && failure) {
    return {
      situation: 'problem',
      troubleshootingSteps: [
        'Check whether the account already has permission for this service.',
        'Retry the connection after signing out and back in.',
        'Note the exact error so the request can be routed to the right type.',
      ],
      missingInformation: [],
      suggestions: [
        'Choose whether this is a new permission or account entitlement, or an existing connection that is failing.',
      ],
      draft: {
        departmentId,
        requestTypeId: null,
        summary: 'Unclear whether this is a new permission or a failing connection',
        description: text,
      },
    };
  }

  if (entitlement) {
    return {
      situation: 'need',
      troubleshootingSteps: [],
      missingInformation: [],
      suggestions: [],
      draft: {
        departmentId,
        requestTypeId: typeIdForIntent(requestTypes, departmentId, 'entitlement'),
        summary: 'New permission or account entitlement',
        description: text,
      },
    };
  }

  if (
    failure &&
    /wi-fi|wifi|won't connect|will not connect|cannot connect|can't connect|vpn/.test(lower)
  ) {
    return {
      situation: 'problem',
      troubleshootingSteps: [
        'Turn the connection off and on again.',
        'Sign out and reconnect using the usual account.',
        'Restart the device and try a known working network if one is available.',
      ],
      missingInformation: [],
      suggestions: [],
      draft: {
        departmentId,
        requestTypeId: typeIdForIntent(requestTypes, departmentId, 'malfunction'),
        summary: /vpn/.test(lower)
          ? 'Existing VPN connection is failing'
          : 'Laptop cannot connect to Wi-Fi',
        description: text,
      },
    };
  }

  if (/need a laptop|need a new laptop/.test(lower)) {
    return {
      situation: 'need',
      troubleshootingSteps: [],
      missingInformation: [],
      suggestions: [],
      draft: {
        departmentId: itId,
        requestTypeId: typeIdForIntent(requestTypes, itId, 'unspecified'),
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
    suggestions: [],
    draft: null,
  };
}

function hasEntitlementIntent(lower: string): boolean {
  return /permission|entitlement|grant access|need access|new access/.test(lower);
}

function hasFailureIntent(lower: string): boolean {
  return /broken|won't|will not|not working|can't|cannot|issue|problem|connect|wi-fi|wifi|fail/.test(
    lower,
  );
}

function departmentIdForText(
  lower: string,
  departments: AiDepartmentContext[],
): number | null {
  if (/\bhr\b|human resources|certificate/.test(lower)) {
    return departmentIdByName(departments, 'HR');
  }
  if (/finance/.test(lower)) {
    return departmentIdByName(departments, 'Finance');
  }
  if (/vpn|laptop|computer|software|wi-fi|wifi/.test(lower)) {
    return departmentIdByName(departments, 'IT');
  }
  return null;
}

function typeIdForIntent(
  requestTypes: AiRequestTypeContext[],
  departmentId: number | null,
  intent: 'entitlement' | 'malfunction' | 'certificate' | 'unspecified',
): number | null {
  if (departmentId == null) {
    return null;
  }
  const inDepartment = requestTypes.filter((item) => item.departmentId === departmentId);
  if (inDepartment.length === 0) {
    return null;
  }
  if (intent === 'unspecified') {
    return inDepartment.length === 1 ? inDepartment[0].id : null;
  }
  const pattern =
    intent === 'entitlement'
      ? /access|permission|entitlement/i
      : intent === 'malfunction'
        ? /software|application|malfunction/i
        : /certificate/i;
  const named = inDepartment.filter((item) => pattern.test(item.name));
  if (named.length === 1) {
    return named[0].id;
  }
  if (named.length > 1) {
    return null;
  }
  return inDepartment.length === 1 ? inDepartment[0].id : null;
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
