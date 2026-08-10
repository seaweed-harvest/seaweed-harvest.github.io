import { assertEquals } from "jsr:@std/assert@1.0.14";
import { classifySuggestionFailure } from "../supabase/functions/_shared/ai_suggestion_failure_policy.ts";

Deno.test("assessment failures are recorded only while assessment is active", () => {
  for (const state of [
    "shadow_assessment_pending",
    "dispatch_pending",
    "dispatched",
    "assessing"
  ]) {
    assertEquals(classifySuggestionFailure("assessment", state), {
      action: "record",
      stage: "assessment",
      reason: "active_stage_failure"
    });
  }
});

Deno.test("implementation failures are recorded only while implementation is active", () => {
  for (const state of ["coding", "testing"]) {
    assertEquals(classifySuggestionFailure("implementation", state), {
      action: "record",
      stage: "implementation",
      reason: "active_stage_failure"
    });
  }
});

Deno.test("late callbacks cannot replace successful or approval states", () => {
  for (const state of [
    "assessment_complete",
    "approval_required",
    "held",
    "pull_request_open",
    "merged",
    "deploying",
    "deployed",
    "cancelled"
  ]) {
    assertEquals(classifySuggestionFailure("implementation", state), {
      action: "ignore",
      stage: "implementation",
      reason: "stale_or_completed_callback"
    });
  }
});

Deno.test("repeated failures are idempotent and unknown stages are rejected", () => {
  assertEquals(classifySuggestionFailure("assessment", "failed"), {
    action: "ignore",
    stage: "assessment",
    reason: "failure_already_recorded"
  });
  assertEquals(classifySuggestionFailure("other", "assessing"), {
    action: "reject",
    stage: null,
    reason: "unknown_failure_stage"
  });
  assertEquals(classifySuggestionFailure("toString", "assessing"), {
    action: "reject",
    stage: null,
    reason: "unknown_failure_stage"
  });
});
