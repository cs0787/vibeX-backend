import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import cors from "cors";
import crypto from "node:crypto";
import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import { neon } from "@neondatabase/serverless";

dotenv.config();

const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`${key} must be set in server/.env`); return value; };
const databaseUrl = required("DATABASE_URL");
const jwtSecret = required("JWT_SECRET");
if (jwtSecret.length < 32) throw new Error("JWT_SECRET must be at least 32 characters long.");
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const sql = neon(databaseUrl);
const nimBaseUrl = (process.env.NVIDIA_NIM_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
const nimApiKey = process.env.NVIDIA_NIM_API_KEY;
const nimModel = process.env.NVIDIA_NIM_MODEL || "meta/llama-3.3-70b-instruct";
const secureCookie = process.env.NODE_ENV === "production";

type Role = "candidate" | "recruiter";
type Json = Record<string, unknown>;
type AuthContext = { userId: string; sessionId: string; role: Role; name: string; email: string; csrf: string };
type AuthRequest = Request & { auth?: AuthContext };
type EventRecord = { id: string; sessionId: string; type: string; timestamp: string; payload: Json };
type TestResult = { name: string; passed: boolean; expected: string; actual: string };
type Report = { generatedAt: string; status: "submitted"; technicalCorrectness: number | null; checksPassed: number; checksTotal: number; dimensions: { name: string; status: string; evidence: string | null }[]; limitations: string[]; nextSteps: string[]; candidateFeedback: string };
type JobRecord = { id: string; createdAt: string; title: string; company: string; description: string; skills: string[]; recruiterId: string; recruiterName: string; status: "open" | "closed" };
type SessionRecord = { id: string; createdAt: string; candidateName: string; candidateUserId: string; taskId: string; code: string; submitted: boolean; events: EventRecord[]; latestReport?: Report; jobId: string; jobTitle?: string; recruiterId?: string };

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: clientOrigin, credentials: true, methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "X-CSRF-Token"] }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many attempts. Please try again in 15 minutes." } });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 250, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many requests. Please slow down." } });

function cookieOptions() { return { httpOnly: true, secure: secureCookie, sameSite: "lax" as const, maxAge: 8 * 60 * 60 * 1000, path: "/" }; }
function safeEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function publicUser(user: AuthContext) { return { id: user.userId, name: user.name, email: user.email, role: user.role, csrfToken: user.csrf }; }

async function initialiseDatabase() {
  await sql`CREATE TABLE IF NOT EXISTS app_users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('candidate', 'recruiter')), created_at TIMESTAMPTZ NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE, csrf_token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS hiring_jobs (
    id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL, title TEXT NOT NULL, company TEXT NOT NULL,
    description TEXT NOT NULL, skills JSONB NOT NULL DEFAULT '[]'::jsonb, recruiter_name TEXT NOT NULL,
    recruiter_id TEXT REFERENCES app_users(id) ON DELETE SET NULL, status TEXT NOT NULL DEFAULT 'open'
  )`;
  await sql`ALTER TABLE hiring_jobs ADD COLUMN IF NOT EXISTS recruiter_id TEXT REFERENCES app_users(id) ON DELETE SET NULL`;
  await sql`CREATE TABLE IF NOT EXISTS assessment_sessions (
    id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL, candidate_name TEXT NOT NULL, task_id TEXT NOT NULL,
    code TEXT NOT NULL, submitted BOOLEAN NOT NULL DEFAULT FALSE, latest_report JSONB, job_id TEXT REFERENCES hiring_jobs(id) ON DELETE SET NULL,
    candidate_user_id TEXT REFERENCES app_users(id) ON DELETE CASCADE
  )`;
  await sql`ALTER TABLE assessment_sessions ADD COLUMN IF NOT EXISTS candidate_user_id TEXT REFERENCES app_users(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE assessment_sessions ADD COLUMN IF NOT EXISTS job_id TEXT REFERENCES hiring_jobs(id) ON DELETE SET NULL`;
  await sql`CREATE TABLE IF NOT EXISTS assessment_events (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES assessment_sessions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb
  )`;
  await sql`CREATE INDEX IF NOT EXISTS assessment_events_session_idx ON assessment_events(session_id, recorded_at)`;
  await sql`CREATE INDEX IF NOT EXISTS auth_sessions_lookup_idx ON auth_sessions(id, user_id, expires_at)`;
}

function toJob(row: any): JobRecord { return { id: row.id, createdAt: new Date(row.created_at).toISOString(), title: row.title, company: row.company, description: row.description, skills: row.skills || [], recruiterId: row.recruiter_id, recruiterName: row.recruiter_name, status: row.status }; }
function toSession(row: any, eventRows: any[]): SessionRecord { return { id: row.id, createdAt: new Date(row.created_at).toISOString(), candidateName: row.candidate_name, candidateUserId: row.candidate_user_id, taskId: row.task_id, code: row.code, submitted: row.submitted, latestReport: row.latest_report || undefined, jobId: row.job_id, jobTitle: row.job_title || undefined, recruiterId: row.recruiter_id || undefined, events: eventRows.map(event => ({ id: event.id, sessionId: event.session_id, type: event.event_type, timestamp: new Date(event.recorded_at).toISOString(), payload: event.payload || {} })) }; }
async function getJob(jobId: string) { const rows = await sql`SELECT * FROM hiring_jobs WHERE id = ${jobId}`; return rows[0] ? toJob(rows[0]) : undefined; }
async function getSession(sessionId: string) { const rows = await sql`SELECT s.*, j.title AS job_title, j.recruiter_id FROM assessment_sessions s LEFT JOIN hiring_jobs j ON j.id = s.job_id WHERE s.id = ${sessionId}`; if (!rows[0]) return undefined; const events = await sql`SELECT * FROM assessment_events WHERE session_id = ${sessionId} ORDER BY recorded_at ASC`; return toSession(rows[0], events); }
function ownsSession(session: SessionRecord, auth: AuthContext) { return auth.role === "candidate" ? session.candidateUserId === auth.userId : session.recruiterId === auth.userId; }
function requireRole(role: Role) { return (req: AuthRequest, res: Response, next: NextFunction) => req.auth?.role === role ? next() : res.status(403).json({ error: "You do not have permission for this action." }); }

async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.cookies.vp_session;
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });
  try {
    const payload = jwt.verify(token, jwtSecret, { issuer: "vibeproof-api", audience: "vibeproof-client" }) as jwt.JwtPayload;
    const userId = String(payload.sub || ""); const sessionId = String(payload.jti || ""); const csrf = String(payload.csrf || "");
    if (!userId || !sessionId || !csrf) throw new Error("Invalid session");
    const rows = await sql`SELECT u.id, u.email, u.display_name, u.role FROM auth_sessions s JOIN app_users u ON u.id = s.user_id WHERE s.id = ${sessionId} AND s.user_id = ${userId} AND s.revoked_at IS NULL AND s.expires_at > NOW()`;
    if (!rows[0] || (rows[0].role !== "candidate" && rows[0].role !== "recruiter")) throw new Error("Expired session");
    req.auth = { userId, sessionId, csrf, name: rows[0].display_name, email: rows[0].email, role: rows[0].role };
    next();
  } catch { res.clearCookie("vp_session", cookieOptions()); return res.status(401).json({ error: "Your session has expired. Please sign in again." }); }
}
function requireCsrf(req: AuthRequest, res: Response, next: NextFunction) { const token = String(req.header("X-CSRF-Token") || ""); return req.auth && safeEqual(token, req.auth.csrf) ? next() : res.status(403).json({ error: "Security check failed. Refresh and try again." }); }
async function recordEvent(sessionId: string, type: string, payload: Json, code?: string) { const event = { id: id(), sessionId, type, timestamp: now(), payload }; if (typeof code === "string") await sql`UPDATE assessment_sessions SET code = ${code} WHERE id = ${sessionId}`; await sql`INSERT INTO assessment_events (id, session_id, event_type, recorded_at, payload) VALUES (${event.id}, ${sessionId}, ${type}, ${event.timestamp}, ${JSON.stringify(payload)}::jsonb)`; return event; }
async function askNim(prompt: string, code: string) {
  if (!nimApiKey) return { mode: "demo" as const, answer: "Demo coach (NVIDIA NIM key not configured): clarify the input/output contract first. Add each expense to the grand total and add to an existing category total instead of replacing it. Run the provided tests after your change." };
  const response = await fetch(`${nimBaseUrl}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${nimApiKey}` }, body: JSON.stringify({ model: nimModel, temperature: 0.25, max_tokens: 380, stream: false, messages: [{ role: "system", content: "You are a supportive coding assessment coach. Give short hints and explanations, not a complete solution. Do not claim code passed tests. Encourage verification. Task: summarizeExpenses(expenses) returns { total, byCategory }, handles empty input and repeated categories." }, { role: "user", content: `Candidate question: ${prompt}\n\nCurrent JavaScript:\n${code.slice(0, 12000)}` }] }) });
  if (!response.ok) throw new Error(`NVIDIA NIM returned ${response.status}`);
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  return { mode: "live" as const, answer: data.choices?.[0]?.message?.content?.trim() || "NVIDIA NIM returned an empty response." };
}
function buildReport(session: SessionRecord): Report {
  const lastRun = [...session.events].reverse().find(event => event.type === "test_run"); const test = lastRun?.payload || {}; const passed = Number(test.passed || 0); const total = Number(test.total || 0); const plan = session.events.find(event => event.type === "plan_submitted"); const ai = session.events.find(event => event.type === "ai_interaction"); const runs = session.events.filter(event => event.type === "test_run").length;
  return { generatedAt: now(), status: "submitted", technicalCorrectness: total ? Math.round((passed / total) * 100) : null, checksPassed: passed, checksTotal: total, dimensions: [{ name: "Technical correctness", status: total ? `${passed}/${total} browser tests passed` : "Insufficient evidence — no test run recorded", evidence: lastRun?.id || null }, { name: "Problem solving", status: plan ? "A task plan was recorded" : "Insufficient evidence — no plan recorded", evidence: plan?.id || null }, { name: "AI collaboration", status: ai ? "AI interaction is available for human review" : "No AI interaction recorded", evidence: ai?.id || null }, { name: "Testing & debugging", status: runs >= 2 ? `${runs} test runs recorded; inspect the sequence` : runs === 1 ? "One test run recorded" : "Insufficient evidence — no test run recorded", evidence: lastRun?.id || null }], candidateFeedback: total && passed === total ? "Your implementation satisfied every visible test. Be ready to explain how the category accumulator avoids overwriting repeated categories." : "Focus on the first failing visible scenario, make one small change, then rerun the tests to verify the fix.", nextSteps: total && passed === total ? ["Explain the accumulator logic in your own words.", "Add one additional boundary test before submitting."] : ["Compare actual output with expected output for the first failing test.", "Check that repeated categories add to the existing total.", "Rerun tests after each focused change."], limitations: ["Tests execute in a browser worker for this prototype; production assessments need an isolated runner with resource limits.", "AI use is recorded as evidence for human review, not scored by prompt count.", "This report supports a reviewer; it must not be used as an automated hiring decision."] };
}
async function issueSession(res: Response, user: { id: string; email: string; displayName: string; role: Role }) { const sessionId = id(); const csrf = crypto.randomBytes(32).toString("base64url"); const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(); await sql`INSERT INTO auth_sessions (id, user_id, csrf_token, expires_at, created_at) VALUES (${sessionId}, ${user.id}, ${csrf}, ${expiresAt}, ${now()})`; const token = jwt.sign({ role: user.role, csrf }, jwtSecret, { subject: user.id, jwtid: sessionId, expiresIn: "8h", issuer: "vibeproof-api", audience: "vibeproof-client" }); res.cookie("vp_session", token, cookieOptions()); return { id: user.id, name: user.displayName, email: user.email, role: user.role, csrfToken: csrf }; }

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "vibe-coding-api", storage: "neon", ai: nimApiKey ? "nvidia-nim" : "demo" }));
app.post("/api/auth/register", authLimiter, async (req, res) => { const name = String(req.body?.name || "").trim().slice(0, 100); const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 254); const password = String(req.body?.password || ""); const role = req.body?.role; if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || (role !== "candidate" && role !== "recruiter")) return res.status(400).json({ error: "Use a name, valid email, password of at least 10 characters, and role." }); const existing = await sql`SELECT id FROM app_users WHERE email = ${email}`; if (existing[0]) return res.status(409).json({ error: "An account with that email already exists." }); const user = { id: id(), email, displayName: name, role: role as Role }; await sql`INSERT INTO app_users (id, email, display_name, password_hash, role, created_at) VALUES (${user.id}, ${email}, ${name}, ${await bcrypt.hash(password, 12)}, ${role}, ${now()})`; res.status(201).json({ user: await issueSession(res, user) }); });
app.post("/api/auth/login", authLimiter, async (req, res) => { const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 254); const password = String(req.body?.password || ""); const rows = await sql`SELECT * FROM app_users WHERE email = ${email}`; const user = rows[0]; if (!user || !await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: "Email or password is incorrect." }); res.json({ user: await issueSession(res, { id: user.id, email: user.email, displayName: user.display_name, role: user.role }) }); });
app.get("/api/auth/me", requireAuth, (req: AuthRequest, res) => res.json({ user: publicUser(req.auth!) }));
app.post("/api/auth/logout", requireAuth, requireCsrf, async (req: AuthRequest, res) => { await sql`UPDATE auth_sessions SET revoked_at = ${now()} WHERE id = ${req.auth!.sessionId}`; res.clearCookie("vp_session", cookieOptions()).status(204).send(); });

app.use("/api", apiLimiter);
app.get("/api/jobs", requireAuth, async (_req, res) => { const rows = await sql`SELECT * FROM hiring_jobs WHERE status = 'open' ORDER BY created_at DESC`; res.json(rows.map(toJob)); });
app.post("/api/jobs", requireAuth, requireCsrf, requireRole("recruiter"), async (req: AuthRequest, res) => { const title = String(req.body?.title || "").trim().slice(0, 120); const company = String(req.body?.company || "").trim().slice(0, 120); const description = String(req.body?.description || "").trim().slice(0, 3000); const skills = Array.isArray(req.body?.skills) ? req.body.skills.map((skill: unknown) => String(skill).trim().slice(0, 40)).filter(Boolean).slice(0, 12) : []; if (!title || !company || !description) return res.status(400).json({ error: "Title, company and role description are required." }); const job = { id: id(), createdAt: now(), title, company, description, skills, recruiterId: req.auth!.userId, recruiterName: req.auth!.name, status: "open" as const }; await sql`INSERT INTO hiring_jobs (id, created_at, title, company, description, skills, recruiter_name, recruiter_id, status) VALUES (${job.id}, ${job.createdAt}, ${job.title}, ${job.company}, ${job.description}, ${JSON.stringify(job.skills)}::jsonb, ${job.recruiterName}, ${job.recruiterId}, 'open')`; res.status(201).json(job); });
app.get("/api/jobs/:id/applications", requireAuth, requireRole("recruiter"), async (req: AuthRequest, res) => { const job = await getJob(String(req.params.id)); if (!job) return res.status(404).json({ error: "Role not found." }); if (job.recruiterId !== req.auth!.userId) return res.status(403).json({ error: "You can only view applications for your own roles." }); const rows = await sql`SELECT s.id, s.created_at, s.candidate_name, s.submitted, s.latest_report, s.job_id, (SELECT COUNT(*) FROM assessment_events e WHERE e.session_id = s.id) AS event_count FROM assessment_sessions s WHERE s.job_id = ${job.id} AND s.submitted = true ORDER BY s.created_at DESC`; res.json({ job, applications: rows.map(row => ({ id: row.id, createdAt: new Date(row.created_at).toISOString(), candidateName: row.candidate_name, submitted: row.submitted, eventCount: Number(row.event_count), latestReport: row.latest_report || undefined })) }); });
app.post("/api/sessions", requireAuth, requireCsrf, requireRole("candidate"), async (req: AuthRequest, res) => { const job = await getJob(String(req.body?.jobId || "")); if (!job || job.status !== "open") return res.status(404).json({ error: "Selected role is not accepting assessments." }); const session: SessionRecord = { id: id(), createdAt: now(), candidateName: req.auth!.name, candidateUserId: req.auth!.userId, taskId: "expense-insights", code: String(req.body?.code || "").slice(0, 50000), submitted: false, events: [], jobId: job.id, jobTitle: job.title, recruiterId: job.recruiterId }; await sql`INSERT INTO assessment_sessions (id, created_at, candidate_name, candidate_user_id, task_id, code, submitted, job_id) VALUES (${session.id}, ${session.createdAt}, ${session.candidateName}, ${session.candidateUserId}, ${session.taskId}, ${session.code}, false, ${session.jobId})`; res.status(201).json(session); });
app.get("/api/sessions/:id", requireAuth, async (req: AuthRequest, res) => { const session = await getSession(String(req.params.id)); if (!session) return res.status(404).json({ error: "Session not found." }); if (!ownsSession(session, req.auth!)) return res.status(403).json({ error: "You do not have access to this assessment." }); res.json(session); });
app.post("/api/sessions/:id/events", requireAuth, requireCsrf, requireRole("candidate"), async (req: AuthRequest, res) => { const session = await getSession(String(req.params.id)); if (!session) return res.status(404).json({ error: "Session not found." }); if (!ownsSession(session, req.auth!)) return res.status(403).json({ error: "You do not have access to this assessment." }); const event = await recordEvent(session.id, String(req.body?.type || "note").slice(0, 80), (req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {}) as Json, typeof req.body?.code === "string" ? req.body.code.slice(0, 50000) : undefined); res.status(201).json(event); });
app.post("/api/sessions/:id/coach", requireAuth, requireCsrf, requireRole("candidate"), async (req: AuthRequest, res) => { const session = await getSession(String(req.params.id)); if (!session) return res.status(404).json({ error: "Session not found." }); if (!ownsSession(session, req.auth!)) return res.status(403).json({ error: "You do not have access to this assessment." }); const prompt = String(req.body?.prompt || "").slice(0, 4000); const code = String(req.body?.code || session.code).slice(0, 12000); try { const result = await askNim(prompt, code); const event = await recordEvent(session.id, "ai_interaction", { prompt, answer: result.answer, mode: result.mode, provider: result.mode === "live" ? "NVIDIA NIM" : "demo" }); res.json({ ...result, evidenceId: event.id }); } catch { res.status(502).json({ error: "NVIDIA NIM could not be reached. Check server configuration." }); } });
app.post("/api/sessions/:id/test-runs", requireAuth, requireCsrf, requireRole("candidate"), async (req: AuthRequest, res) => { const session = await getSession(String(req.params.id)); if (!session) return res.status(404).json({ error: "Session not found." }); if (!ownsSession(session, req.auth!)) return res.status(403).json({ error: "You do not have access to this assessment." }); const results: TestResult[] = Array.isArray(req.body?.results) ? req.body.results.slice(0, 20).map((item: any): TestResult => ({ name: String(item?.name || "Test").slice(0, 160), passed: Boolean(item?.passed), expected: String(item?.expected || "").slice(0, 800), actual: String(item?.actual || "").slice(0, 800) })) : []; const passed = results.filter(result => result.passed).length; const event = await recordEvent(session.id, "test_run", { runner: "browser-worker", passed, total: results.length, results, note: "Executed locally in a browser worker; not a production sandbox." }, String(req.body?.code || "").slice(0, 50000)); res.status(201).json({ id: event.id, timestamp: event.timestamp, passed, total: results.length, results }); });
app.post("/api/sessions/:id/submit", requireAuth, requireCsrf, requireRole("candidate"), async (req: AuthRequest, res) => { const session = await getSession(String(req.params.id)); if (!session) return res.status(404).json({ error: "Session not found." }); if (!ownsSession(session, req.auth!)) return res.status(403).json({ error: "You do not have access to this assessment." }); session.code = String(req.body?.code || session.code).slice(0, 50000); const report = buildReport(session); await sql`UPDATE assessment_sessions SET code = ${session.code}, submitted = true, latest_report = ${JSON.stringify(report)}::jsonb WHERE id = ${session.id}`; const event = await recordEvent(session.id, "submission", { report }); res.json({ submitted: true, report, sessionId: session.id, evidenceId: event.id }); });
app.get("/api/sessions/:id/report-download", requireAuth, async (req: AuthRequest, res) => { const session = await getSession(String(req.params.id)); if (!session?.latestReport) return res.status(404).json({ error: "No submitted report is available." }); if (!ownsSession(session, req.auth!)) return res.status(403).json({ error: "You do not have access to this report." }); const safeName = session.candidateName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "candidate"; res.attachment(`vibeproof-report-${safeName}.json`).type("application/json").send(JSON.stringify({ candidate: session.candidateName, role: session.jobTitle, report: session.latestReport, evidence: session.events }, null, 2)); });

await initialiseDatabase();
const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`Vibe Coding API running on http://localhost:${port} · Neon + secure cookie auth enabled`));
