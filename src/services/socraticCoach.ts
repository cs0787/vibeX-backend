const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct";
const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

const SOCRATIC_SYSTEM_PROMPT = `You are the vibeX Socratic AI Coach for an iMocha coding assessment (IM-01).

RULES:
1. NEVER output direct copy-paste code snippets or entire solutions.
2. Act as a senior tech lead: give conceptual advice, point out edge cases, schema validations, and floating-point constraints.
3. Keep answers under 100 words. Focus on prompting the candidate to reason through the fix.`;

export async function getCoachGuidance(
  prompt: string, 
  code: string, 
  failedTestList: string[] = []
): Promise<string> {
  if (!NVIDIA_API_KEY) {
    return getLocalGuidance(prompt, failedTestList);
  }

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
          { 
            role: "user", 
            content: `Code:\n${code.slice(0, 1000)}\n\nFailing Tests: ${failedTestList.join(', ') || 'None'}\n\nCandidate Question: "${prompt}"` 
          }
        ],
        temperature: 0.2,
        max_tokens: 250
      })
    });

    if (!response.ok) {
      console.warn("NVIDIA NIM returned status:", response.status);
      return getLocalGuidance(prompt, failedTestList);
    }

    const data: any = await response.json();
    return data.choices?.[0]?.message?.content || getLocalGuidance(prompt, failedTestList);
  } catch (err) {
    console.error("NVIDIA NIM Error:", err);
    return getLocalGuidance(prompt, failedTestList);
  }
}

function getLocalGuidance(prompt: string, failedTestList: string[]): string {
  const q = prompt.toLowerCase();
  if (q.includes("parse") || q.includes("corrupt") || q.includes("error")) {
    return "💡 **Socratic Guidance**: Consider verifying if `sensorId` or `reading` are undefined. How can you throw a structured `Error` before returning the parsed object?";
  }
  if (q.includes("float") || q.includes("round") || q.includes("average")) {
    return "💡 **Socratic Guidance**: JavaScript uses IEEE-754 arithmetic. Consider using `Number(val.toFixed(2))` to enforce exact 2-decimal precision.";
  }
  if (failedTestList.length > 0) {
    return `💡 **Coach Insight**: You have failing assertion(s): [${failedTestList.join(', ')}]. Read the assertion expectation carefully.`;
  }
  return "💡 **Coach Insight**: Look closely at your input edge cases (empty lists, missing properties).";
}
