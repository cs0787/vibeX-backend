const rawKey = process.env.NVIDIA_API_KEY || '';
const NVIDIA_API_KEY = rawKey.replace(/^["']|["']$/g, '').trim();
const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

// Active NVIDIA NIM models (avoiding deprecated preview slugs)
const ACTIVE_MODELS = [
  process.env.NVIDIA_MODEL?.trim(),
  "meta/llama-3.1-70b-instruct",
  "meta/llama-3.1-8b-instruct",
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "mistralai/mistral-large-2-instruct"
].filter(Boolean) as string[];

const SYSTEM_PROMPT = `You are the vibeX AI Pair Programmer and Socratic Coach for an iMocha coding assessment (IM-01).
Strict Rules:
1. Provide concise, direct, and constructive engineering guidance (under 120 words).
2. Answer questions about code logic, language syntax, edge cases, and bugs accurately.
3. If the candidate asks you to scaffold or fix code, provide clean, idiomatic JavaScript snippets and explain how the logic works.`;

export async function getCoachGuidance(
  prompt: string,
  code: string,
  failedTestList: string[] = []
): Promise<string> {
  if (!NVIDIA_API_KEY) {
    return `⚠️ [NVIDIA NIM Notice]: NVIDIA_API_KEY is missing from environment variables. (${getSmartFallback(prompt)})`;
  }

  const payloadMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Candidate Question: "${prompt}"\n\nCurrent Code in Editor:\n\`\`\`javascript\n${code.slice(0, 1500)}\n\`\`\`\n\nFailing Tests: ${failedTestList.length > 0 ? failedTestList.join(', ') : 'All currently passing'}`
    }
  ];

  let lastError = "";

  // Attempt active models sequentially
  for (const model of ACTIVE_MODELS) {
    try {
      const response = await fetch(NVIDIA_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${NVIDIA_API_KEY}`
        },
        body: JSON.stringify({
          model,
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

      const errText = await response.text();
      lastError = `Model ${model} returned HTTP ${response.status}: ${errText}`;

      // Skip retired (410) or not found (404) models to try next active candidate
      if (response.status === 410 || response.status === 404) {
        console.warn(lastError);
        continue;
      }

      if (response.status === 401) {
        return `⚠️ [NVIDIA NIM 401 Unauthorized]: Invalid or expired API Key in Vercel. (${getSmartFallback(prompt)})`;
      }
    } catch (err: any) {
      lastError = `Fetch exception on ${model}: ${err.message}`;
    }
  }

  // Fallback with fixed word boundary pattern matching
  return getSmartFallback(prompt, lastError);
}

function getSmartFallback(prompt: string, apiError?: string): string {
  const p = prompt.trim();
  const q = p.toLowerCase();

  // Strict regex word boundary checks (prevents 'which' or 'hint' matching 'hi')
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

  return apiError 
    ? `⚠️ [NVIDIA NIM Notice: ${apiError.slice(0, 80)}...] I'm your AI Pair Programmer: what specific function or test would you like to debug?`
    : "I'm your AI Pair Programmer. Tell me what function to scaffold, test case to fix, or architectural pattern to explain.";
}
