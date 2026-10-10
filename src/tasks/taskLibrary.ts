import { AssessmentTask } from '../types/assessment';

export const TASK_LIBRARY: Record<string, AssessmentTask> = {
  "task-data-pipeline": {
    id: "task-data-pipeline",
    title: "Real-Time Telemetry Stream Processor",
    roleLevel: "Mid-Senior Fullstack / Backend Engineer",
    description: `
### Challenge Overview
Design a high-throughput event processing engine that cleanses raw IoT telemetry packets, calculates aggregate rolling statistics, and detects anomalies.

### Requirements:
1. \`parseEvent(rawJson)\`: Safely parse JSON strings. Reject corrupted payloads or packets missing \`sensorId\` or \`reading\` (must throw an Error).
2. \`computeWindowAverages(readings)\`: Compute the moving arithmetic average. Handle fractional precision up to 2 decimal places.
3. \`flagAnomalies(readings, baseline, maxDeviation)\`: Return readings where \`Math.abs(reading - baseline) > maxDeviation\`.
    `,
    starterCode: `// vibeX Telemetry Processor
// Implement the required assessment methods below:

export function parseEvent(rawJson) {
  // TODO: Validate required fields and parse
  return JSON.parse(rawJson);
}

export function computeWindowAverages(readings) {
  // TODO: Compute arithmetic average with 2-decimal precision
  return 0;
}

export function flagAnomalies(readings, baseline, maxDeviation) {
  // TODO: Detect anomalies deviating from baseline
  return [];
}
`,
    tests: [
      {
        id: "T1",
        description: "parseEvent handles valid IoT packet structures",
        isEdgeCase: false,
        assertionCode: `
          const packet = '{"sensorId":"temp-01","reading":24.5,"ts":"2026-10-10"}';
          const parsed = parseEvent(packet);
          if (!parsed || parsed.sensorId !== 'temp-01' || parsed.reading !== 24.5) {
            throw new Error('Failed to correctly parse attributes');
          }
        `
      },
      {
        id: "T2",
        description: "parseEvent rejects corrupt packets and missing attributes",
        isEdgeCase: true,
        assertionCode: `
          let threw = false;
          try {
            parseEvent('{"badPacket":true}');
          } catch(e) { threw = true; }
          if (!threw) throw new Error('Expected validation error on incomplete packet');
        `
      },
      {
        id: "T3",
        description: "computeWindowAverages computes precise 2-decimal floating averages",
        isEdgeCase: true,
        assertionCode: `
          const data = [10.25, 20.45, 30.10];
          const avg = computeWindowAverages(data);
          if (Number(avg) !== 20.27) {
            throw new Error('Expected average 20.27, got ' + avg);
          }
        `
      },
      {
        id: "T4",
        description: "flagAnomalies identifies positive and negative threshold breaches",
        isEdgeCase: false,
        assertionCode: `
          const data = [50, 52, 75, 48, 20];
          const res = flagAnomalies(data, 50, 10);
          if (res.length !== 2 || !res.includes(75) || !res.includes(20)) {
            throw new Error('Failed to isolate anomalies');
          }
        `
      }
    ]
  }
};
