import { prepareKnowledgeBase, type WorkflowDocument } from "./infrai_client.ts";

const documents: WorkflowDocument[] = [
  {
    id: "booking-identity-v1",
    title: "Booking: identity and contact check",
    workflow: "booking",
    text: "Before offering slots, confirm the patient's full name, date of birth, and preferred callback number. Do not place clinical details in calendar notes.",
  },
  {
    id: "reschedule-handoff-v1",
    title: "Rescheduling after a preparation window",
    workflow: "reschedule",
    text: "If preparation instructions have already started, pause the reschedule and send the case to the care coordinator. Otherwise confirm the new time and repeat preparation instructions from the approved template.",
  },
  {
    id: "cancellation-followup-v1",
    title: "Cancellation follow-up",
    workflow: "cancellation",
    text: "Record the cancellation reason using the approved operations categories. Offer a callback from scheduling when the patient wants another date. Never infer a clinical reason.",
  },
];

const collection = process.env.INFRAI_COLLECTION ?? "appointment-workflows";
await prepareKnowledgeBase(collection, documents);
console.log(`Seeded ${documents.length} appointment workflow documents into ${collection}.`);
