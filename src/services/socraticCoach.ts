const rawKey = process.env.NVIDIA_API_KEY || '';
const NVIDIA_API_KEY = rawKey.replace(/^["']|["']$/g, '').trim();
const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

// Active stable NVIDIA NIM models with automatic fallback
const MODEL_CANDIDATES = [
  process.env.NVIDIA_MODEL?.trim(),
  "meta/llama-3.1-70b-instruct",
  "meta/llama-3.1-8b-instruct",
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "mistralai/mistral-large-2-instruct"
].filter(Boolean) as string[];

const SYSTEM_PROMPT = `You are the vibeX AI Pair Programmer and Socratic Coach for an iMocha coding assessment (IM-01).
Strict Rules:
1. Provide concise, direct, and constructive engineering guidance (under 120 words).
2. Help candidates reason through edge cases, data structures, schema validation, and floating-point constraints.
3. If the candidate asks you to write code or scaffold a function, provide clean, idiomatic JavaScript snippets and explain how the logic works.
4. Respond constructively to developer greetings and inquiries.`;

export async function getCoachGuidance(
  prompt: string,
  code: string,
  failedTestList: string[] = []
): Promise<string> {
  if (!NVIDIA_API_KEY) {
    return `⚠️ [NVIDIA NIM Notice]: NVIDIA_API_KEY is not configured in backend environment variables. Add NVIDIA_API_KEY to Vercel Settings -> Environment Variables and redeploy. (Fallback active: ${getSmartFallback(prompt)})`;
  }

  const payloadMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Candidate Question: "${prompt}"\n\nCurrent Code in Editor:\n\`\`\`javascript\n${code.slice(0, 1500)}\n\`\`\`\n\nFailing Tests: ${failedTestList.length > 0 ? failedTestList.join(', ') : 'All currently passing'}`
    }
  ];

  // Attempt models sequentially until an active model responds
  for (const model of MODEL_CANDIDATES) {
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

      // If model is retired (410) or not found (404), fall through to next model
      if (response.status === 410 || response.status === 404) {
        console.warn(`Model ${model} returned ${response.status}. Trying next candidate...`);
        continue;
      }

      const errText = await response.text();
      console.error(`NVIDIA NIM returned HTTP ${response.status} on ${model}:`, errText);
      return `⚠️ [NVIDIA NIM API Error ${response.status}]: ${response.status === 401 ? 'Unauthorized token. Check API key in Vercel.' : errText}. (${getSmartFallback(prompt)})`;
    } catch (err: any) {
      console.error(`Fetch error on model ${model}:`, err);
    }
  }

  return getSmartFallback(prompt);
}

function getSmartFallback(prompt: string): string {
  const q = prompt.toLowerCase();
  if (q.includes("what is this code") || q.includes("explain")) {
    return "This code implements an IoT packet parser and stream aggregator. It validates packet payloads, calculates running averages with 2-decimal precision, and detects anomalous deviations.";
  }
  if (q.includes("hello") || q.includes("hi")) {
    return "Hello! I am your AI Pair Programmer. Ask me to explain the code, fix edge cases, or scaffold validation guards.";
  }
  if (q.includes("parse") || q.includes("guard") || q.includes("validation")) {
    return "In JSON stream processing, check if `sensorId` or `reading` are undefined and throw a `new Error()` before returning.";
  }
  if (q.includes("float") || q.includes("average") || q.includes("round")) {
    return "JavaScript arithmetic follows IEEE-754 binary floating-point representation. Use `Number(val.toFixed(2))` to constrain precision.";
  }
  return "What specific part of this code would you like to optimize, refactor, or test?";
}
