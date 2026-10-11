import { Pool } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL || '';

export const pool = new Pool({
  connectionString: connectionString.trim()
});

export async function initDb() {
  if (!connectionString) {
    console.warn("⚠️ DATABASE_URL is not configured. Database persistence disabled.");
    return;
  }

  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL CHECK (role IN ('candidate', 'recruiter')),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS assessments (
          id VARCHAR(100) PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          category VARCHAR(100) NOT NULL,
          level VARCHAR(50) NOT NULL,
          duration_minutes INTEGER NOT NULL,
          description TEXT NOT NULL,
          starter_code TEXT NOT NULL,
          tests JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS assessment_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          candidate_id UUID REFERENCES users(id),
          candidate_name VARCHAR(255) NOT NULL,
          assessment_id VARCHAR(100) REFERENCES assessments(id),
          status VARCHAR(50) DEFAULT 'in_progress',
          current_code TEXT NOT NULL,
          started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          submitted_at TIMESTAMP WITH TIME ZONE
        );

        CREATE TABLE IF NOT EXISTS test_runs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id UUID REFERENCES assessment_sessions(id),
          passed_count INTEGER NOT NULL,
          total_count INTEGER NOT NULL,
          results JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ai_interactions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id UUID REFERENCES assessment_sessions(id),
          prompt TEXT NOT NULL,
          response TEXT NOT NULL,
          suggested_diff JSONB,
          was_applied BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS assessment_reports (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id UUID UNIQUE REFERENCES assessment_sessions(id),
          candidate_id UUID REFERENCES users(id),
          candidate_name VARCHAR(255) NOT NULL,
          task_title VARCHAR(255) NOT NULL,
          tests_passed INTEGER NOT NULL,
          total_tests INTEGER NOT NULL,
          scrutiny_score INTEGER NOT NULL,
          verdict VARCHAR(100) NOT NULL,
          observed_facts JSONB NOT NULL,
          interpretations JSONB NOT NULL,
          rubric_evaluation TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Seed default assessment task
      await client.query(`
        INSERT INTO assessments (id, title, category, level, duration_minutes, description, starter_code, tests)
        VALUES (
          'task-iot-stream',
          'Real-Time Telemetry Stream Processor',
          'JavaScript Problem Solving',
          'Mid-Senior Level',
          30,
          'Safely parse incoming IoT JSON payloads, reject corrupted telemetry structures missing sensorId or reading, calculate rolling averages constrained to 2 decimal places, and flag anomalies beyond maxDeviation.',
          E'// vibeX Telemetry Processor\\n// Implement the required methods:\\n\\nexport function parseEvent(rawJson) {\\n  // TODO: Validate required fields (sensorId, reading)\\n  const data = JSON.parse(rawJson);\\n  if (!data.sensorId || data.reading === undefined) {\\n    throw new Error("Invalid telemetry schema: missing sensorId or reading");\\n  }\\n  return data;\\n}\\n\\nexport function computeWindowAverages(readings) {\\n  // TODO: Compute arithmetic average with 2-decimal precision\\n  if (!readings || readings.length === 0) return 0;\\n  const sum = readings.reduce((acc, curr) => acc + curr, 0);\\n  return Number((sum / readings.length).toFixed(2));\\n}\\n\\nexport function flagAnomalies(readings, baseline, maxDeviation) {\\n  // TODO: Detect deviations greater than maxDeviation\\n  if (!readings) return [];\\n  return readings.filter(val => Math.abs(val - baseline) > maxDeviation);\\n}\\n',
          '[
            {"id": "T1", "description": "parseEvent parses valid IoT payloads", "assertionCode": "const p = parseEvent(JSON.stringify({sensorId: \\"s1\\", reading: 42})); if (!p || p.sensorId !== \\"s1\\") throw new Error(\\"Invalid parse\\");"},
            {"id": "T2", "description": "parseEvent rejects corrupt payload & missing fields", "assertionCode": "let caught = false; try { parseEvent(JSON.stringify({foo: 1})); } catch(e) { caught = true; } if (!caught) throw new Error(\\"Did not throw error on missing keys\\");"},
            {"id": "T3", "description": "computeWindowAverages handles 2-decimal precision", "assertionCode": "const avg = computeWindowAverages([10.123, 20.456, 30.789]); if (avg !== 20.46) throw new Error(\\"Expected 20.46, received \\" + avg);"},
            {"id": "T4", "description": "flagAnomalies isolates positive and negative deviations", "assertionCode": "const anom = flagAnomalies([10, 50, 12, 100], 10, 15); if (anom.length !== 2 || !anom.includes(50) || !anom.includes(100)) throw new Error(\\"Failed to isolate anomalies\\");"}
          ]'::jsonb
        )
        ON CONFLICT (id) DO NOTHING;
      `);

      console.log("✅ Neon PostgreSQL schema verified.");
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Database connection check:", err);
  }
}
