export function getCoachGuidance(prompt: string, code: string, failedTestList: string[]): string {
  const query = prompt.toLowerCase();

  if (query.includes("parse") || query.includes("t2") || query.includes("error")) {
    return "💡 **Socratic Guidance**: Consider what happens when JSON parses successfully, but lacks required properties (`sensorId` or `reading`). How can you enforce an explicit schema guard before returning the object?";
  }

  if (query.includes("average") || query.includes("t3") || query.includes("decimal") || query.includes("float")) {
    return "💡 **Socratic Guidance**: JavaScript uses 64-bit binary floating-point arithmetic (IEEE 754), which causes rounding issues. After aggregating the sum, how can you constrain the result to exactly 2 decimal places using `toFixed(2)` and `Number()`?";
  }

  if (query.includes("anomaly") || query.includes("t4") || query.includes("deviation")) {
    return "💡 **Socratic Guidance**: Remember that deviation can happen in both directions (too high or too low). Are you checking `Math.abs(val - baseline) > maxDeviation`?";
  }

  if (failedTestList.length > 0) {
    return `💡 **Coach Insight**: You currently have ${failedTestList.length} failing assertion(s): [${failedTestList.join(', ')}]. Read the assertion messages in your test runner console. What boundary assumption is your current code missing?`;
  }

  return "💡 **Coach Insight**: Your architecture is progressing cleanly. Before submitting, review your defensive guards: what happens if an empty array or an undefined payload is supplied?";
}
