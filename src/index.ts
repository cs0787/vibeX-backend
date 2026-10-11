import express from 'express';
import cors from 'cors';
import vm from 'vm';
import { v4 as uuidv4 } from 'uuid';
import { TASK_LIBRARY } from './tasks/taskLibrary';
import { getCoachGuidance, getAvailableNvidiaModels } from './services/socraticCoach';
import { compileEvidenceReport } from './services/evidenceEngine';
import { TelemetryEvent, RecruiterSkillReport, CandidateFeedbackReport } from './types/assessments';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const activeSessions: Record<string, any> = {};
const sessionTelemetry: Record<string, TelemetryEvent[]> = {};
const sessionReports: Record<string, { recruiterReport: RecruiterSkillReport; candidateFeedback: CandidateFeedbackReport }> = {};

// Root Health Route
app.get('/', (req, res) => {
  res.json({
    status: "online",
    service: "vibeX Assessment Engine",
    version: "1.0.0",
    nvidiaNimEnabled: Boolean(process.env.NVIDIA_API_KEY),
    timestamp: new Date().toISOString()
  });
});

// Diagnostic route: lists available models and runs an live completion
app.get('/api/test-ai', async (req, res) => {
  try {
    const models = await getAvailableNvidiaModels();
    const reply = await getCoachGuidance("Reply with exactly: 'NVIDIA NIM active and verified!'", "const x = 1;", []);
    res.json({
      nvidiaApiKeyConfigured: Boolean(process.env.NVIDIA_API_KEY),
      totalModelsAvailable: models.length,
      sampleModels: models.slice(0, 10),
      testCompletion: reply
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Candidate Catalog
app.get('/api/candidates', (req, res) => {
  res.json({
    candidates: [
      {
        id: "cand-01",
        name: "Chetan Shakhapure",
        role: "Fullstack / Systems Engineer",
        verdict: "Strong Hire",
        score: 96,
        aiFluency: "Balanced Partner",
        testsPassed: "4 / 4",
        duration: "18 mins",
        evidence: [
          { id: "EV-01", title: "Defensive Validation Architecture", desc: "Enforced schema guards throwing custom Error objects for corrupted telemetry packets.", eventLink: "EV_CODE_COMMIT_2" },
          { id: "EV-02", title: "Targeted Socratic Prompting", desc: "Consulted AI on IEEE-754 precision constraints; verified logic before accepting output.", eventLink: "EV_AI_PROMPT_1" }
        ]
      }
    ]
  });
});

// Start Candidate Session
app.post('/api/sessions/start', (req, res) => {
  const { candidateName = "Chetan Shakhapure", taskId = "task-iot-stream" } = req.body;
  const sessionId = uuidv4();
  const task = TASK_LIBRARY[taskId] || TASK_LIBRARY["task-iot-stream"];

  activeSessions[sessionId] = { id: sessionId, candidateName, taskId: task.id, startTime: new Date().toISOString() };
  sessionTelemetry[sessionId] = [
    { id: uuidv4(), sessionId, timestamp: new Date().toISOString(), type: 'SESSION_ONBOARDED', metadata: { candidateName, taskId: task.id } }
  ];

  res.json({ sessionId, candidateName, task });
});

// Execute Unit & Edge-Case Assertions
app.post('/api/execute/run-tests', (req, res) => {
  const { sessionId, taskId = "task-iot-stream", code = "" } = req.body;
  const task = TASK_LIBRARY[taskId] || TASK_LIBRARY["task-iot-stream"];
  const cleanCode = code.replace(/export\s+/g, '');

  const results = task.tests.map(test => {
    const sandboxContext: Record<string, any> = { console: { log: () => {} }, Error, Number, Math, JSON, Map, Set };
    try {
      vm.createContext(sandboxContext);
      vm.runInContext(cleanCode, sandboxContext, { timeout: 1500 });
      vm.runInContext(test.assertionCode, sandboxContext, { timeout: 1500 });
      return { id: test.id, description: test.description, passed: true, actual: "Pass" };
    } catch (err: any) {
      return { id: test.id, description: test.description, passed: false, actual: err.message || "Assertion Failed" };
    }
  });

  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  if (sessionId && sessionTelemetry[sessionId]) {
    sessionTelemetry[sessionId].push({
      id: uuidv4(), sessionId, timestamp: new Date().toISOString(), type: 'TESTS_EXECUTED',
      metadata: { passedCount, failedCount, total: results.length }
    });
  }

  res.json({ results });
});

// AI Coach & Pair Programmer Route
app.post('/api/ai/coach', async (req, res) => {
  const { sessionId, prompt, code = "", failedTestList = [] } = req.body;
  const guidance = await getCoachGuidance(prompt, code, failedTestList);

  if (sessionId && sessionTelemetry[sessionId]) {
    sessionTelemetry[sessionId].push({ id: uuidv4(), sessionId, timestamp: new Date().toISOString(), type: 'AI_PROMPT_SUBMITTED', metadata: { prompt } });
    sessionTelemetry[sessionId].push({ id: uuidv4(), sessionId, timestamp: new Date().toISOString(), type: 'AI_GUIDANCE_SERVED', metadata: { guidance } });
  }

  res.json({ guidance });
});

// Submit Assessment
app.post('/api/sessions/:id/submit', (req, res) => {
  const { id } = req.params;
  const { code = "", taskId = "task-iot-stream" } = req.body;
  const task = TASK_LIBRARY[taskId] || TASK_LIBRARY["task-iot-stream"];

  const cleanCode = code.replace(/export\s+/g, '');
  const testResults = task.tests.map(test => {
    const sandboxContext: Record<string, any> = { console: { log: () => {} }, Error, Number, Math, JSON, Map, Set };
    try {
      vm.createContext(sandboxContext);
      vm.runInContext(cleanCode, sandboxContext, { timeout: 1500 });
      vm.runInContext(test.assertionCode, sandboxContext, { timeout: 1500 });
      return { id: test.id, description: test.description, passed: true, actual: "Pass" };
    } catch (err: any) {
      return { id: test.id, description: test.description, passed: false, actual: err.message || "Failed" };
    }
  });

  const events = sessionTelemetry[id] || [];
  const reports = compileEvidenceReport(id, activeSessions[id]?.candidateName || "Candidate", task.title, events, testResults);
  sessionReports[id] = reports;

  res.json(reports);
});

// Fetch Saved Report
app.get('/api/reports/:id', (req, res) => {
  const report = sessionReports[req.params.id];
  if (!report) return res.status(404).json({ error: "Report not found" });
  res.json(report);
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`vibeX-backend running on port ${PORT}`));
}

export default app;
module.exports = app;
