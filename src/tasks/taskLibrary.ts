import { AssessmentTask } from '../types/assessments';

export const TASK_LIBRARY: Record<string, AssessmentTask> = {
  "task-iot-stream": {
    id: "task-iot-stream",
    title: "Real-Time Telemetry Stream Processor",
    roleLevel: "Senior / Mid-Level Software Engineer",
    description: `### Objective
Implement an event stream processor that ingests IoT packet payloads, enforces defensive validation, and computes rolling averages with floating-point precision.

### Requirements:
1. parseEvent(rawJson): Safely parse JSON strings. Reject corrupted payloads or packets missing sensorId or reading (must throw an Error).
2. computeWindowAverages(readings): Compute arithmetic average with 2-decimal precision.
3. flagAnomalies(readings, baseline, maxDeviation): Return readings where Math.abs(reading - baseline) > maxDeviation.`,
    starterCode: `// vibeX AI-Era Assessment Engine
// Implement the required methods below:

export function parseEvent(rawJson) {
  // TODO: Validate required fields (sensorId, reading)
  const data = JSON.parse(rawJson);
  if (!data.sensorId || data.reading === undefined) {
    throw new Error("Invalid telemetry schema: missing sensorId or reading");
  }
  return data;
}

export function computeWindowAverages(readings) {
  // TODO: Compute arithmetic average with 2-decimal precision
  if (!readings || readings.length === 0) return 0;
  const sum = readings.reduce((acc, curr) => acc + curr, 0);
  return Number((sum / readings.length).toFixed(2));
}

export function flagAnomalies(readings, baseline, maxDeviation) {
  // TODO: Detect deviations greater than maxDeviation
  if (!readings) return [];
  return readings.filter(val => Math.abs(val - baseline) > maxDeviation);
}
`,
    tests: [
      {
        id: "T1",
        description: "parseEvent handles valid IoT packet structures",
        isEdgeCase: false,
        assertionCode: `
          const res = parseEvent('{"sensorId":"sn-1","reading":24.5}');
          if (!res || res.sensorId !== 'sn-1' || res.reading !== 24.5) throw new Error('Failed to parse fields');
        `
      },
      {
        id: "T2",
        description: "parseEvent rejects corrupt packets & missing attributes",
        isEdgeCase: true,
        assertionCode: `
          let threw = false;
          try { parseEvent('{"corrupted":true}'); } catch(e) { threw = true; }
          if (!threw) throw new Error('Expected function to throw on missing sensorId');
        `
      },
      {
        id: "T3",
        description: "computeWindowAverages handles 2-decimal precision",
        isEdgeCase: true,
        assertionCode: `
          const avg = computeWindowAverages([10.25, 20.45, 30.10]);
          if (Number(avg) !== 20.27) throw new Error('Expected 20.27, got ' + avg);
        `
      },
      {
        id: "T4",
        description: "flagAnomalies isolates positive and negative deviations",
        isEdgeCase: false,
        assertionCode: `
          const res = flagAnomalies([50, 52, 75, 48, 20], 50, 10);
          if (res.length !== 2 || !res.includes(75) || !res.includes(20)) throw new Error('Failed to isolate anomalies');
        `
      }
    ]
  }
};
