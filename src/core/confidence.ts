import type { ToolResult, AgentSynthesis } from "../types.js";

export interface ConfidenceCheck {
  name: string;
  passed: boolean;
  penalty: number;
  reason: string;
}

/**
 * Validates the LLM's self-reported confidence against objective evidence.
 * Returns an adjusted confidence score and the checks that were applied.
 *
 * This prevents the LLM from hallucinating confidence — if the tools
 * returned nothing useful, confidence gets capped regardless of what
 * the LLM claims.
 */
export function groundConfidence(
  synthesis: AgentSynthesis,
  findings: ToolResult[]
): { adjustedConfidence: number; checks: ConfidenceCheck[] } {
  const checks: ConfidenceCheck[] = [];
  let adjustedConfidence = synthesis.confidence;

  // 1. No tools were called → cap at 0.4
  if (findings.length === 0) {
    checks.push({
      name: "no_investigation",
      passed: false,
      penalty: 0,
      reason: "No tools were called during investigation",
    });
    adjustedConfidence = Math.min(adjustedConfidence, 0.4);
  }

  // 2. All tool calls errored → cap at 0.3
  const successfulCalls = findings.filter((f) => !f.error);
  if (findings.length > 0 && successfulCalls.length === 0) {
    checks.push({
      name: "all_tools_failed",
      passed: false,
      penalty: 0,
      reason: "Every tool call returned an error",
    });
    adjustedConfidence = Math.min(adjustedConfidence, 0.3);
  } else if (successfulCalls.length > 0) {
    checks.push({
      name: "tools_succeeded",
      passed: true,
      penalty: 0,
      reason: `${successfulCalls.length}/${findings.length} tool calls succeeded`,
    });
  }

  // 3. Tools returned empty/not-found results → reduce confidence
  const emptyResults = successfulCalls.filter((f) => isEmptyResult(f.result));
  if (successfulCalls.length > 0 && emptyResults.length === successfulCalls.length) {
    checks.push({
      name: "no_data_found",
      passed: false,
      penalty: 0,
      reason: "All tool calls returned empty or not-found results",
    });
    adjustedConfidence = Math.min(adjustedConfidence, 0.35);
  }

  // 4. LLM answer is empty despite claiming high confidence → cap at 0.3
  if (!synthesis.answer || synthesis.answer.trim().length < 10) {
    checks.push({
      name: "empty_answer",
      passed: false,
      penalty: 0,
      reason: "Synthesis answer is empty or too short",
    });
    adjustedConfidence = Math.min(adjustedConfidence, 0.3);
  } else {
    checks.push({
      name: "answer_present",
      passed: true,
      penalty: 0,
      reason: "Synthesis contains a substantive answer",
    });
  }

  // 5. Confidence seems unreasonably high for few tool calls → apply skepticism penalty
  if (synthesis.confidence > 0.9 && findings.length <= 1) {
    const penalty = 0.1;
    checks.push({
      name: "overconfidence_penalty",
      passed: false,
      penalty,
      reason: "Very high confidence with minimal investigation",
    });
    adjustedConfidence -= penalty;
  }

  return {
    adjustedConfidence: clamp(adjustedConfidence, 0, 1),
    checks,
  };
}

function isEmptyResult(result: unknown): boolean {
  if (result === null || result === undefined) return true;

  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;

    // Common "not found" patterns
    if (obj.found === false) return true;
    if (obj.rowCount === 0) return true;
    if (obj.count === 0) return true;

    // Empty arrays
    if (Array.isArray(obj.rows) && obj.rows.length === 0) return true;
    if (Array.isArray(obj.results) && obj.results.length === 0) return true;
    if (Array.isArray(obj.logs) && obj.logs.length === 0) return true;
    if (Array.isArray(obj.orders) && obj.orders.length === 0) return true;
  }

  return false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
