const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '';
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export async function getAvailableNvidiaModels(): Promise<string[]> {
  try {
    const res = await fetch(`${NVIDIA_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${NVIDIA_API_KEY}` }
    });
    const data: any = await res.json();
    return data.data.map((m: any) => m.id);
  } catch (err) {
    return ['meta/llama-3.1-70b-instruct'];
  }
}

export async function getCoachGuidance(
  prompt: string,
  currentCode: string,
  failedTests: string[] = []
): Promise<string> {
  if (!NVIDIA_API_KEY) {
    return "### 🔍 Observation\n* NVIDIA API key not configured.\n\n### 💡 Recommendation\n* Add your `NVIDIA_API_KEY` to Vercel environment variables.";
  }

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

  const userContent = `Candidate Prompt: "${prompt}"
Failing Tests: ${failedTests.length > 0 ? failedTests.join(', ') : 'None (all tests currently passing)'}

Current Code:
\`\`\`javascript
${currentCode}
\`\`\``;

  try {
    const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${NVIDIA_API_KEY}`
      },
      body: JSON.stringify({
        model: 'meta/llama-3.1-70b-instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        temperature: 0.2,
        max_tokens: 600
      })
    });

    const data: any = await response.json();
    return data.choices?.[0]?.message?.content || "No guidance generated.";
  } catch (err: any) {
    console.error("NVIDIA NIM Error:", err);
    return "### ⚠️ Service Notice\n* Inference gateway temporarily unavailable.\n* Please verify network connection or retest in sandbox.";
  }
}
