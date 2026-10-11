import express from 'express';
import cors from 'cors';
import vm from 'vm';
import { v4 as uuidv4 } from 'uuid';
import { TASK_LIBRARY } from './tasks/taskLibrary';
import { getCoachGuidance } from './services/socraticCoach';
import { compileEvidenceReport } from './services/evidenceEngine';
import { TelemetryEvent, RecruiterSkillReport, CandidateFeedbackReport } from './types/assessments';

const app = express();
const PORT = process.env.PORT || 8080;


// Enable CORS for all incoming clients
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

import { queryNeon } from './db/neon';

// Signup Endpoint
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Attempt Neon insert
  const result = await queryNeon(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
    [name, email.toLowerCase(), password, role]
  );

  if (result && result.length > 0) {
    return res.json({ user: result[0] });
  }

  // Resilient fallback for demo without DB
  res.json({
    user: { id: "user-" + Date.now(), name, email, role }
  });
});

// Login Endpoint
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  const result = await queryNeon(
    'SELECT id, name, email, role, password_hash FROM users WHERE email = $1 LIMIT 1',
    [email.toLowerCase()]
  );

  if (result && result.length > 0) {
    const user = result[0];
    if (user.password_hash === password) {
      return res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    }
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Fallback demo user
  const fallbackRole = email.includes('recruiter') ? 'recruiter' : 'candidate';
  res.json({
    user: { id: "user-demo", name: email.split('@')[0], email, role: fallbackRole }
  });
});

// In-Memory Storage
const activeSessions: Record<string, any> = {};
const sessionTelemetry: Record<string, TelemetryEvent[]> = {};
const sessionReports: Record<string, { recruiterReport: RecruiterSkillReport; candidateFeedback: CandidateFeedbackReport }> = {};

// Root Health Route (Resolves "Cannot GET /")
app.get('/', (req, res) => {
  res.json({
    status: "online",
    service: "vibeX Assessment Engine",
    version: "1.0.0",
    nvidiaNimEnabled: Boolean(process.env.NVIDIA_API_KEY),
    timestamp: new Date().toISOString()
  });
});

// Diagnostic route to test NVIDIA NIM directly in the browser
app.get('/api/test-ai', async (req, res) => {
  const rawKey = process.env.NVIDIA_API_KEY || '';
  const cleanKey = rawKey.replace(/^["']|["']$/g, '').trim();
  const model = process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct";

  if (!cleanKey) {
    return res.status(400).json({
      success: false,
      error: "NVIDIA_API_KEY is missing from environment variables."
    });
  }

  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cleanKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "user", content: "Reply with exactly: 'NVIDIA NIM connection verified!'" }
        ],
        max_tokens: 50,
        temperature: 0.2
      })
    });

    const status = response.status;
    const rawBody = await response.text();

    if (!response.ok) {
      return res.status(status).json({
        success: false,
        httpStatus: status,
        nvidiaResponse: rawBody,
        hint: status === 401 
          ? "Your NVIDIA key is unauthorized. Check that there are no quotes or spaces in Vercel settings."
          : "NVIDIA NIM rejected the request with the above error."
      });
    }

    const data = JSON.parse(rawBody);
    return res.json({
      success: true,
      modelUsed: model,
      reply: data.choices?.[0]?.message?.content
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      exception: err.message
    });
  }
});

// Recruiter Candidate Pipeline List
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
      },
      {
        id: "cand-02",
        name: "Aarav Sharma",
        role: "Backend Engineer",
        verdict: "Consider (Follow-up)",
        score: 75,
        aiFluency: "Autonomous",
        testsPassed: "3 / 4",
        duration: "24 mins",
        evidence: [
          { id: "EV-03", title: "Float Rounding Precision Gap", desc: "Missed 2-decimal constraint on arithmetic aggregation test assertion.", eventLink: "EV_TEST_FAIL_3" }
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

// Execute Tests in Sandboxed VM
app.post('/api/execute/run-tests', (req, res) => {
  const { sessionId, taskId = "task-iot-stream", code = "" } = req.body;
  const task = TASK_LIBRARY[taskId] || TASK_LIBRARY["task-iot-stream"];
  const cleanCode = code.replace(/export\s+/g, '');

  const results = task.tests.map(test => {
    const sandboxContext: Record<string, any> = { console: { log: () => {} }, Error, Number, Math, JSON };
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

// Socratic AI Coach with NVIDIA NIM
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
    const sandboxContext: Record<string, any> = { console: { log: () => {} }, Error, Number, Math, JSON };
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
  app.listen(PORT, () => console.log(`vibeX-backend listening on port ${PORT}`));
}

export default app;
module.exports = app;
