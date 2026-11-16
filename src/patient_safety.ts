export type SafetyDecision =
  | { action: "answer"; notice: string }
  | { action: "clinical_escalation"; notice: string };

const urgentSignals = [
  /chest pain/i,
  /trouble breathing/i,
  /severe bleeding/i,
  /passed out/i,
  /suicid(?:e|al)/i,
];

export function decidePatientSafety(question: string): SafetyDecision {
  if (urgentSignals.some((signal) => signal.test(question))) {
    return {
      action: "clinical_escalation",
      notice:
        "Do not continue the scheduling workflow. Ask the patient to contact local emergency services and alert the clinical escalation channel.",
    };
  }

  return {
    action: "answer",
    notice: "Operational guidance only. Do not add diagnosis, treatment, or patient-specific medical advice.",
  };
}
