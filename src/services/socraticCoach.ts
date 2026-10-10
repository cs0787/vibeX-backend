const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct";
const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

const SOCRATIC_SYSTEM_PROMPT = `You are the vibeX Socratic AI Coach for a technical engineering assessment (iMocha Track IM-01).

MISSION & STRICT BEHAVIOR RULES:
1. NEVER output complete solutions, full function bodies, or direct copy-paste code snippets.
2. Act as a senior tech lead / Socratic tutor: guide the candidate by asking probing questions, highlighting architectural concepts, pointing out JavaScript nuances (like IEEE-754 precision, exception bubbling, and schema guards), and recommending test strategies.
3. Keep answers concise (under 120 words), constructive, and focused on helping the candidate discover the solution themselves.
4. If the candidate asks you to "write the code" or "give the answer", politely decline and redirect them with a hint about the next logical step.`;

export async function getCoachGuidance(
  prompt: string, 
  code: string, 
  failedTestList: string[] = []
): Promise<string> {
  // Graceful fallback if NVIDIA_API_KEY is not configured
  if (!NVIDIA_API_KEY) {
    return getLocalFallbackGuidance(prompt, failedTestList);
  }

  const userContextMessage = `
Candidate Code Context:
\`\`\`javascript
${code.slice(0, 1500)}
\`\`\`

Failing Test Assertions:
${failedTestList.length > 0 ? failedTestList.join(', ') : 'None currently failing.'}

Candidate's Question to Coach:
"${prompt}"
`;

  try {
    const response = await fetch(NVIDIA_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NVIDIA_API_KEY}`
      },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages: [
          { role: "system", content: SOCRATIC_SYSTEM_PROMPT },
          { role: "user", content: userContextMessage }
        ],
        temperature: 0.3,
        top_p: 0.9,
        max_tokens: 300
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("NVIDIA NIM API Error:", response.status, errText);
      return getLocalFallbackGuidance(prompt, failedTestList);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || getLocalFallbackGuidance(prompt, failedTestList);
  } catch (err) {
    console.error("Failed to query NVIDIA NIM:", err);
    return getLocalFallbackGuidance(prompt, failedTestList);
  }
}

// Resilient fallback logic if network / quota drops during a live demo
function getLocalFallbackGuidance(prompt: string, failedTestList: string[]): string {
  const query = prompt.toLowerCase();
  if (query.includes("parse") || query.includes("corrupt") || query.includes("error")) {
    return "💡 **Coach Hint**: JSON parsing alone doesn't guarantee field validity. Check if `sensorId` or `reading` are undefined and throw a `new Error()` before returning.";
  }
  if (query.includes("float") || query.includes("average") || query.includes("round")) {
    return "💡 **Coach Hint**: JavaScript numbers follow IEEE-754 binary floating-point math. Look into using `Number(val.toFixed(2))` to control decimal precision.";
  }
  if (failedTestList.length > 0) {
    return `💡 **Coach Hint**: You have failing tests: [${failedTestList.join(", ")}]. Check your boundary guards and edge-case assumptions.`;
  }
  return "💡 **Coach Hint**: Before submitting, verify boundary constraints like empty payloads or out-of-range thresholds.";
}
