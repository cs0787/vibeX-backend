const rawKey = process.env.NVIDIA_API_KEY || '';
const NVIDIA_API_KEY = rawKey.replace(/^["']|["']$/g, '').trim();
const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

let cachedWorkingModel: string | null = null;

const SYSTEM_PROMPT = `You are the vibeX AI Pair Programmer and Socratic Coach for an iMocha coding assessment (IM-01).
Strict Rules:
1. Provide concise, direct, and constructive engineering guidance (under 120 words).
2. Answer questions about code logic, language syntax, edge cases, and bugs accurately.
3. If the candidate asks you to scaffold or fix code, provide clean, idiomatic JavaScript snippets and explain how the logic works.
4. Respond constructively to developer greetings and inquiries.`;

// Query NVIDIA catalog to discover all models available to your API key
export async function getAvailableNvidiaModels(): Promise<string[]> {
  if (!NVIDIA_API_KEY) return [];
  try {
    const res = await fetch(`${NVIDIA_BASE}/models`, {
      headers: { "Authorization": `Bearer ${NVIDIA_API_KEY}` }
    });
    if (!res.ok) {
      console.error(`Failed to list NVIDIA models: HTTP ${res.status}`);
      return [];
    }
    const data: any = await res.json();
    return (data.data || []).map((m: any) => m.id);
  } catch (err) {
    console.error("Error fetching NVIDIA models:", err);
    return [];
  }
}

// Automatically resolve an active, working instruct model
async function resolveModel(): Promise<string> {
  if (cachedWorkingModel) return cachedWorkingModel;

  const models = await getAvailableNvidiaModels();
  if (models.length > 0) {
    // 1. If custom NVIDIA_MODEL is provided and exists, use it
    const envModel = process.env.NVIDIA_MODEL?.trim();
    if (envModel && models.includes(envModel)) {
      cachedWorkingModel = envModel;
      return envModel;
    }

    // 2. Otherwise pick an active instruct model from the actual list
    const candidate = models.find(m => m.includes("llama") && m.includes("instruct"))
      || models.find(m => m.includes("instruct"))
      || models.find(m => m.includes("chat"))
      || models[0];

    if (candidate) {
      cachedWorkingModel = candidate;
      return candidate;
    }
  }

  return process.env.NVIDIA_MODEL?.trim() || "meta/llama-3.1-8b-instruct";
}

export async function getCoachGuidance(
  prompt: string,
  code: string,
  failedTestList: string[] = []
): Promise<string> {
  if (!NVIDIA_API_KEY) {
    return `⚠️ [NVIDIA NIM Notice]: NVIDIA_API_KEY is missing from environment variables. (${getSmartFallback(prompt)})`;
  }

  const modelToUse = await resolveModel();

  const payloadMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Candidate Question: "${prompt}"\n\nCurrent Code in Editor:\n\`\`\`javascript\n${code.slice(0, 1500)}\n\`\`\`\n\nFailing Tests: ${failedTestList.length > 0 ? failedTestList.join(', ') : 'All currently passing'}`
    }
  ];

  try {
    const response = await fetch(`${NVIDIA_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NVIDIA_API_KEY}`
      },
      body: JSON.stringify({
        model: modelToUse,
        messages: payloadMessages,
        temperature: 0.3,
        max_tokens: 350
      })
    });

    if (response.ok) {
      const data: any = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (content) return content;
    }

    // If the model was not found, invalidate cache so next call re-checks
    if (response.status === 404 || response.status === 410) {
      cachedWorkingModel = null;
    }

    const errText = await response.text();
    console.error(`NVIDIA NIM returned HTTP ${response.status} on ${modelToUse}:`, errText);
    return `⚠️ [NVIDIA NIM Error ${response.status} on ${modelToUse}]: ${errText}. (${getSmartFallback(prompt)})`;
  } catch (err: any) {
    console.error("NVIDIA NIM fetch exception:", err);
    return `⚠️ [Connection Error]: ${err.message}. (${getSmartFallback(prompt)})`;
  }
}

function getSmartFallback(prompt: string): string {
  const p = prompt.trim();
  const q = p.toLowerCase();

  if (/\b(which language|what language|language)\b/i.test(p)) {
    return "This workspace uses modern **JavaScript (ES6+ / Node.js)**. You write standard functions and classes, which run inside an isolated deterministic Node.js VM sandbox.";
  }
  if (/\b(give a hint|hint|help|clue)\b/i.test(p)) {
    return "💡 **Task Hint**: Start with `parseEvent`. Check `if (!data.sensorId || data.reading === undefined)` and throw a `new Error(...)`. Next, in `computeWindowAverages`, ensure you wrap the result in `Number(avg.toFixed(2))` to avoid IEEE-754 precision issues.";
  }
  if (/\b(hi|hello|hey|greetings)\b/i.test(p)) {
    return "Hello! I am your AI Pair Programmer. Ask me to explain the code, scaffold validation guards, or fix edge cases.";
  }
  if (q.includes("parse") || q.includes("guard") || q.includes("validation")) {
    return "When parsing JSON telemetry, verify that required fields like `sensorId` and `reading` exist. If missing, throw an explicit `new Error('Invalid schema')`.";
  }
  if (q.includes("float") || q.includes("average") || q.includes("round") || q.includes("decimal")) {
    return "JavaScript arithmetic uses binary 64-bit floats. Use `Number((sum / count).toFixed(2))` to guarantee exact 2-decimal assertions.";
  }
  if (q.includes("what is this code") || q.includes("explain")) {
    return "This code implements an event processor for IoT telemetry. It parses incoming packets, aggregates values with 2-decimal precision, and isolates deviations exceeding a baseline threshold.";
  }

  return "I'm your AI Pair Programmer. Tell me what function to scaffold, test case to fix, or architectural pattern to explain.";
}
