const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct";
const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

const SYSTEM_PROMPT = `You are the vibeX AI Pair Programmer and Socratic Coach for an iMocha coding assessment.
You assist developers in real time.
RULES:
1. Be concise, direct, and helpful (under 120 words).
2. Answer questions about code logic, edge cases, bugs, and architecture accurately.
3. When asked to code or refactor, provide clear explanations and relevant code blocks.`;

export async function getCoachGuidance(
  prompt: string, 
  code: string, 
  failedTestList: string[] = []
): Promise<string> {
  // 1. Check if NVIDIA_API_KEY exists
  if (!NVIDIA_API_KEY) {
    console.warn("NVIDIA_API_KEY environment variable is not defined in backend.");
    return `⚠️ **[NVIDIA NIM Notice]**: \`NVIDIA_API_KEY\` is not set in Vercel backend environment variables. Please add it to Vercel Settings -> Environment Variables and redeploy. (Fallback active: ${getSmartFallback(prompt)})`;
  }

  try {
    const response = await fetch(NVIDIA_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NVIDIA_API_KEY.trim()}`
      },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { 
            role: "user", 
            content: `Developer Question: "${prompt}"\n\nCurrent Code in Editor:\n\`\`\`javascript\n${code.slice(0, 1500)}\n\`\`\`\n\nFailing Tests: ${failedTestList.length > 0 ? failedTestList.join(', ') : 'All passing'}`
          }
        ],
        temperature: 0.3,
        max_tokens: 400
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`NVIDIA NIM returned ${response.status}:`, errText);
      return `⚠️ **[NVIDIA NIM API Error ${response.status}]**: ${response.status === 401 ? 'Invalid or expired API Key' : 'Request error'}. (${getSmartFallback(prompt)})`;
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (content) {
      return content;
    }
    return getSmartFallback(prompt);
  } catch (err: any) {
    console.error("NVIDIA NIM fetch exception:", err);
    return `⚠️ **[Connection Error]**: Failed to reach NVIDIA NIM endpoint. (${getSmartFallback(prompt)})`;
  }
}

function getSmartFallback(prompt: string): string {
  const q = prompt.toLowerCase();
  if (q.includes("what is this code") || q.includes("explain")) {
    return "This code implements an in-memory LRU (Least Recently Used) cache with TTL expiration. It uses a JavaScript `Map` to track insertion and access order for O(1) operations.";
  }
  if (q.includes("hello") || q.includes("hi")) {
    return "Hello! I am your AI Pair Programmer. Ask me to explain the code, fix edge cases, or write new methods.";
  }
  if (q.includes("lru") || q.includes("evict") || q.includes("cache")) {
    return "In JavaScript Maps, `.keys().next().value` retrieves the oldest key. Re-inserting with `.delete(key)` and `.set(key, val)` updates it to the most recently used position.";
  }
  if (q.includes("test") || q.includes("fail")) {
    return "Check boundary conditions: handling undefined keys, eviction when size exceeds capacity, and expiration handling.";
  }
  return "What specific part of this code would you like to optimize, refactor, or test?";
}
