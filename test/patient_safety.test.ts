import assert from "node:assert/strict";
import test from "node:test";
import { decidePatientSafety } from "../src/patient_safety.ts";

test("an urgent symptom interrupts the appointment workflow", () => {
  const decision = decidePatientSafety(
    "Can I move tomorrow's appointment? I have chest pain right now.",
  );

  assert.equal(decision.action, "clinical_escalation");
  assert.match(decision.notice, /emergency services/i);
});

test("an ordinary scheduling question can use retrieved guidance", () => {
  const decision = decidePatientSafety(
    "Which identity fields do I confirm before offering an appointment?",
  );

  assert.equal(decision.action, "answer");
  assert.match(decision.notice, /operational guidance/i);
});
