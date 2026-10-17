const rawKey = (process.env.NVIDIA_API_KEY || '').trim();
// Strip duplicate "Bearer " if user accidentally included it in Vercel
const cleanApiKey = rawKey.replace(/^Bearer\s+/i, '');
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

// Supported NVIDIA NIM chat models in order of priority
const CANDIDATE_MODELS = [
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.3-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  'nvidia/llama-3.1-nemotron-70b-instruct'
];

export async function getAvailableNvidiaModels(): Promise<string[]> {
  if (!cleanApiKey) return CANDIDATE_MODELS;
  try {
    const res = await fetch(`${NVIDIA_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${cleanApiKey}` }
    });
    if (!res.ok) return CANDIDATE_MODELS;
    const data: any = await res.json();
    return data?.data?.map((m: any) => m.id) || CANDIDATE_MODELS;
  } catch (err) {
    return CANDIDATE_MODELS;
  }
}

export async function getCoachGuidance(
  prompt: string,
  currentCode: string,
  failedTests: string[] = []
): Promise<string> {
  const systemPrompt = `You are the vibeX AI Pair Programmer, an expert systems architect.
You evaluate code for an engineering assessment.

CRITICAL INSTRUCTIONS:
1. NEVER output unformatted walls of text or conversational filler ("Hello!", "I'd like to point out...").
2. ALWAYS format your response into these exact Markdown sections:

### 🔍 Analysis
* Brief 1-2 bullet diagnosis of the candidate's query or code state.

### 💡 Recommendations
* Bullet 1: Concrete observation (edge case, schema validation, precision).
* Bullet 2: Specific action item.

### 🛠️ Proposed Implementation
* If suggesting code, provide ONLY the specific modified function inside a single \`\`\`javascript code block.
* Keep explanations under 120 words total. Be concise, direct, and senior-level.`;

  const userContent = `Candidate Query: "${prompt}"
Failing Unit Tests: ${failedTests.length > 0 ? failedTests.join(', ') : 'None (All tests currently passing)'}

Active Code Buffer:
\`\`\`javascript
${currentCode}
\`\`\``;

  // 1. Attempt live inference through NVIDIA NIM
  if (cleanApiKey) {
    for (const model of CANDIDATE_MODELS) {
      try {
        const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cleanApiKey}`
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent }
            ],
            temperature: 0.2,
            max_tokens: 500
          })
        });

        if (response.ok) {
          const data: any = await response.json();
          const content = data.choices?.[0]?.message?.content;
          if (content && content.trim().length > 0) {
            return content;
          }
        } else {
          const errText = await response.text();
          console.warn(`NVIDIA NIM Model [${model}] returned HTTP${response.status}:`, errText);
        }
      } catch (callErr) {
        console.error(`NVIDIA NIM call failed for model [${model}]:`, callErr);
      }
    }
  }

  // 2. High-Fidelity Presentation Fail-Safe Engine
  // (Ensures live demo NEVER breaks if NVIDIA credits expire or rate-limits hit)
  const lower = prompt.toLowerCase();

  if (lower.includes('precision') || lower.includes('float') || lower.includes('average') || lower.includes('decimal')) {
    return `### 🔍 Analysis
* \`computeWindowAverages\` must strictly round the arithmetic mean to 2 decimal places.
* JavaScript standard floating-point division returns unconstrained mantissas (e.g. \`20.2666666\`).

### 💡 Recommendations
* Coerce the rounded quotient back into a primitive \`Number\` to satisfy strict assertion comparisons.
* Safeguard against division by zero on empty arrays.

### 🛠️ Proposed Implementation
\`\`\`javascript
export function computeWindowAverages(readings) {
  if (!readings || readings.length === 0) return 0;
  const sum = readings.reduce((acc, curr) => acc + curr, 0);
  return Number((sum / readings.length).toFixed(2));
}
\`\`\``;
  }

  if (lower.includes('guard') || lower.includes('schema') || lower.includes('parse') || lower.includes('missing') || lower.includes('error')) {
    return `### 🔍 Analysis
* \`parseEvent\` must enforce strict contract validation on inbound JSON payloads.
* Corrupted frames lacking \`sensorId\` or carrying \`undefined\` readings must be rejected immediately.

### 💡 Recommendations
* Proactively throw a descriptive runtime \`Error\` before passing malformed data downstream.
* Validate JSON structure validity with defensive guards.

### 🛠️ Proposed Implementation
\`\`\`javascript
export function parseEvent(rawJson) {
  const data = JSON.parse(rawJson);
  if (!data.sensorId || data.reading === undefined) {
    throw new Error("Invalid telemetry schema: missing sensorId or reading");
  }
  return data;
}
\`\`\``;
  }

  if (lower.includes('anomal') || lower.includes('deviation') || lower.includes('filter')) {
    return `### 🔍 Analysis
* \`flagAnomalies\` isolates values deviating beyond \`maxDeviation\` from the designated baseline.
* Must account for both positive spikes and negative drops.

### 💡 Recommendations
* Utilize \`Math.abs(val - baseline)\` to evaluate symmetric threshold bounds.
* Return an empty array if the input array is unpopulated.

### 🛠️ Proposed Implementation
\`\`\`javascript
export function flagAnomalies(readings, baseline, maxDeviation) {
  if (!readings) return [];
  return readings.filter(val => Math.abs(val - baseline) > maxDeviation);
}
\`\`\``;
  }

  return `### 🔍 Analysis
* Candidate environment connected to telemetry processor benchmark.
* Currently passing: ${4 - failedTests.length} of 4 isolated unit test assertions.

### 💡 Recommendations
* Run the test suite using **Run Tests** to verify edge cases.
* Inquire about **schema contract guards**, **floating-point precision**, or **anomaly filters**.`;
}
