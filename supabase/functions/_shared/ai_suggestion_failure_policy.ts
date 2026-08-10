export type SuggestionFailureStage = "assessment" | "implementation";

export type SuggestionFailureDecision = {
  action: "record" | "ignore" | "reject";
  stage: SuggestionFailureStage | null;
  reason: string;
};

const MUTABLE_STATES: Record<SuggestionFailureStage, ReadonlySet<string>> = {
  assessment: new Set([
    "shadow_assessment_pending",
    "dispatch_pending",
    "dispatched",
    "assessing"
  ]),
  implementation: new Set([
    "coding",
    "testing"
  ])
};

export function classifySuggestionFailure(
  stageValue: unknown,
  runStateValue: unknown
): SuggestionFailureDecision {
  const stage = String(stageValue ?? "").trim() as SuggestionFailureStage;
  const runState = String(runStateValue ?? "").trim();
  if (stage !== "assessment" && stage !== "implementation") {
    return {
      action: "reject",
      stage: null,
      reason: "unknown_failure_stage"
    };
  }
  if (runState === "failed") {
    return {
      action: "ignore",
      stage,
      reason: "failure_already_recorded"
    };
  }
  if (!MUTABLE_STATES[stage].has(runState)) {
    return {
      action: "ignore",
      stage,
      reason: "stale_or_completed_callback"
    };
  }
  return {
    action: "record",
    stage,
    reason: "active_stage_failure"
  };
}
