export type EventType =
  | 'SESSION_ONBOARDED'
  | 'TASK_LOADED'
  | 'AI_PROMPT_SUBMITTED'
  | 'AI_GUIDANCE_SERVED'
  | 'CODE_DIFF_RECORDED'
  | 'TESTS_EXECUTED'
  | 'ASSESSMENT_SUBMITTED';

export interface TelemetryEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  type: EventType;
  metadata: Record<string, any>;
}

export interface AssessmentTask {
  id: string;
  title: string;
  roleLevel: string;
  description: string;
  starterCode: string;
  tests: {
    id: string;
    description: string;
    isEdgeCase: boolean;
    assertionCode: string;
  }[];
}

export interface EvidenceFinding {
  id: string;
  dimension: 'Technical Problem Solving' | 'AI Fluency & Critical Thinking' | 'Verification & Debugging';
  status: 'Strong' | 'Competent' | 'Requires Development';
  observation: string;
  interpretation: string;
  linkedEventIds: string[];
  evidenceTrail: {
    eventId: string;
    action: string;
    detail: string;
  }[];
  confidenceRating: 'High' | 'Moderate' | 'Insufficient Evidence';
}

export interface RecruiterSkillReport {
  sessionId: string;
  candidateName: string;
  taskTitle: string;
  totalTimeMinutes: number;
  executiveSummary: string;
  metrics: {
    testPassPercentage: number;
    aiVerificationScore: number;
    debuggingEfficiencyScore: number;
  };
  evidenceFindings: EvidenceFinding[];
  fairnessAudit: {
    totalPrompts: number;
    promptScoringExcluded: boolean;
    explanation: string;
  };
}

export interface CandidateFeedbackReport {
  sessionId: string;
  candidateName: string;
  headline: string;
  verifiedStrengths: string[];
  actionableGrowthAreas: string[];
  recommendedCurriculum: string[];
}
