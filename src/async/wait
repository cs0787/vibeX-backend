import express from 'express';
import cors from 'cors';
import vm from 'vm';
import { v4 as uuidv4 } from 'uuid';
import { TASK_LIBRARY } from './tasks/taskLibrary';
import { getCoachGuidance } from './services/socraticCoach';
import { compileEvidenceReport } from './services/evidenceEngine';
import { TelemetryEvent, RecruiterSkillReport, CandidateFeedbackReport } from './types/assessment';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// In-Memory Session & Telemetry State
const activeSessions: Record<string, any> = {};
const sessionTelemetry: Record<string, TelemetryEvent[]> = {};
const sessionReports: Record<string, { recruiterReport: RecruiterSkillReport; candidateFeedback: CandidateFeedbackReport }> = {};

// 1. Initialize Assessment Session
app.post('/api/sessions/start', (req, res) => {
  const { candidateName = "Chetan Shakhapure", taskId = "task-data-pipeline" } = req.body;
  const sessionId = uuidv4();
  const task = TASK_LIBRARY[taskId] || TASK_LIBRARY["task-data-pipeline"];

  activeSessions[sessionId] = {
    id: sessionId,
    candidateName,
    taskId: task.id,
    startTime: new Date().toISOString()
  };

  sessionTelemetry[sessionId] = [
    {
      id: uuidv4(),
      sessionId,
      timestamp: new Date().toISOString(),
      type: 'SESSION_ONBOARDED',
      metadata: { candidateName, taskId: task.id }
    }
  ];

  res.json({
    sessionId,
    candidateName,
    task
  });
});

// 2. Sandboxed Test Runner
app.post('/api/execute/run-tests', (req, res) => {
  const { sessionId, taskId = "task-data-pipeline", code } = req.body;
  const task = TASK_LIBRARY[taskId] || TASK_LIBRARY["task-data-pipeline"];
  const cleanCode = (code || '').replace(/export\s+/g, '');

  const results = task.tests.map(test => {
    const sandboxContext: Record<string, any> = {
      console: { log: () => {} },
      Error,
      Number,
      Math,
      JSON
    };

    try {
      vm.createContext(sandboxContext);
      vm.runInContext(cleanCode, sandboxContext, { timeout: 1500 });
      vm.runInContext(test.assertionCode, sandboxContext, { timeout: 1500 });
      return { id: test.id, description: test.description, passed: true, actual: "Pass", isEdgeCase: test.isEdgeCase };
    } catch (err: any) {
      return { id: test.id, description: test.description, passed: false, actual: err.message || "Runtime Error", isEdgeCase: test.isEdgeCase };
    }
  });

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  if (sessionId && sessionTelemetry[sessionId]) {
    sessionTelemetry[sessionId].push({
      id: uuidv4(),
      sessionId,
      timestamp: new Date().toISOString(),
      type: 'TESTS_EXECUTED',
      metadata: { passedCount, failedCount, total: results.length }
    });
  }

  res.json({ results });
});

// 3. Socratic AI Coach with NVIDIA NIM
app.post('/api/ai/coach', async (req, res) => {
  const { sessionId, prompt, code, failedTestList = [] } = req.body;
  
  // Call NVIDIA NIM
  const guidance = await getCoachGuidance(prompt, code, failedTestList);

  if (sessionId && sessionTelemetry[sessionId]) {
    sessionTelemetry[sessionId].push({
      id: uuidv4(),
      sessionId,
      timestamp: new Date().toISOString(),
      type: 'AI_PROMPT_SUBMITTED',
      metadata: { prompt }
    });
    sessionTelemetry[sessionId].push({
      id: uuidv4(),
      sessionId,
      timestamp: new Date().toISOString(),
      type: 'AI_GUIDANCE_SERVED',
      metadata: { guidance, provider: 'NVIDIA NIM' }
    });
  }

  res.json({ guidance });
});
// 4. Submit Assessment & Generate Evidence Reports
app.post('/api/sessions/:id/submit', (req, res) => {
  const { id } = req.params;
  const { code, taskId = "task-data-pipeline" } = req.body;
  const session = activeSessions[id];
  const task = TASK_LIBRARY[taskId] || TASK_LIBRARY["task-data-pipeline"];

  // Run final assertions
  const cleanCode = (code || '').replace(/export\s+/g, '');
  const testResults = task.tests.map(test => {
    const sandboxContext: Record<string, any> = { console: { log: () => {} }, Error, Number, Math, JSON };
    try {
      vm.createContext(sandboxContext);
      vm.runInContext(cleanCode, sandboxContext, { timeout: 1500 });
      vm.runInContext(test.assertionCode, sandboxContext, { timeout: 1500 });
      return { id: test.id, description: test.description, passed: true, actual: "Pass" };
    } catch (err: any) {
      return { id: test.id, description: test.description, passed: false, actual: err.message || "Runtime Error" };
    }
  });

  const events = sessionTelemetry[id] || [];
  const reports = compileEvidenceReport(id, session?.candidateName || "Candidate", task.title, events, testResults);
  sessionReports[id] = reports;

  res.json(reports);
});

// 5. Fetch Reports
app.get('/api/reports/:id', (req, res) => {
  const { id } = req.params;
  const report = sessionReports[id];
  if (!report) return res.status(404).json({ error: "Report not found" });
  res.json(report);
});

app.listen(PORT, () => {
  console.log(` vibeX-backend running on http://localhost:${PORT}`);
});
