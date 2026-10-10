export type EventType =
  | 'TASK_OPENED'
  | 'AI_PROMPT_SENT'
  | 'AI_RESPONSE_RECEIVED'
  | 'CODE_RUN_TESTS'
  | 'CODE_SNAPSHOT'
  | 'SUBMISSION_FINALIZED';

export interface SessionEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  type: EventType;
  payload: any;
}

export interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  executionTimeMs: number;
  isEdgeCase: boolean;
}

export interface EvidenceCard {
  id: string;
  skillDimension: 'Technical Correctness' | 'AI Collaboration' | 'Debugging & Verification' | 'Code Quality';
  observation: string;
  interpretation: string;
  evidenceChain: {
    eventId: string;
    description: string;
    codeSnippet?: string;
  }[];
  confidence: 'High' | 'Moderate' | 'Insufficient Evidence';
}

export interface RecruiterReport {
  sessionId: string;
  candidateName: string;
  taskTitle: string;
  durationMinutes: number;
  overallVerdict: string;
  scores: {
    correctnessScore: number;       // 0 - 100 based on test suite
    aiFluencyScore: number;          // 0 - 100 based on prompting & verification
    debuggingVelocityScore: number;  // 0 - 100 based on error-to-fix iterations
  };
  evidenceCards: EvidenceCard[];
  fairnessDisclaimer: string;
}

export interface CandidateFeedback {
  sessionId: string;
  candidateName: string;
  summary: string;
  strengths: string[];
  actionableGrowthAreas: string[];
  suggestedPracticeTopics: string[];
}
