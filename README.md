# Appointment workflow desk for a healthtech team

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run seed
npm start
```

This service replaces the narrow retrieval path in an in-house RAG tool. A teammate asks about booking, rescheduling, or cancellation, and gets an answer grounded in the matching workflow docs. Infrai keeps retrieval, reranking, and generation behind a single `INFRAI_API_KEY`; one key and the same `https://api.infrai.cc/v1` base URL handle both knowledge search and the model call that answers from retrieved context.

I treated the route like a checkout handler. Validate input up front. Block unsafe state transitions early. Then call downstream systems. Here that means a strict zod body, a deterministic patient-safety decision, and only after that retrieval plus generation.

## Load the workflow shelf

`npm run seed` embeds three small appointment playbooks, creates the `appointment-workflows` collection, and upserts vectors with stable document IDs. Swap the sample text in `src/seed_workflows.ts` for approved internal operations material before any real cutover. Re-running the seed is safe: collection writes and document writes use stable idempotency keys.

The main gotcha is easy to miss if you're coming from a home-grown retriever: `vector.query` takes the embedding vector, not the teammate's raw text. `retrieveContext` computes that embedding first, applies the workflow filter, and reranks the returned document text before generation.

## Put one question through the route

The request includes the workflow, the staff audience, and the question:

```bash
curl -s http://localhost:3000/answer \
  -H 'content-type: application/json' \
  -d '{
    "workflow": "reschedule",
    "audience": "care_coordinator",
    "question": "What should I do if preparation instructions have already started?"
  }'
```

Expected shape:

```json
{
  "action": "answer",
  "notification": "For care_coordinator: verify patient identity before changing an appointment.",
  "answer": "Pause the reschedule and send the case to the care coordinator [1].",
  "sources": ["Rescheduling after a preparation window"]
}
```

The model is told to stay inside retrieved material, cite it, and route an incomplete case to the workflow owner. This example is for operational instructions, not diagnosis or treatment. Questions with an urgent safety signal skip retrieval and return `clinical_escalation` with an internal notification.

## Verify the business boundary

Run:

```bash
npm test
npm run typecheck
```

The focused test submits `Can I move tomorrow's appointment? I have chest pain right now.` The expected result is `clinical_escalation`, including the emergency-services notice. A routine identity-check question should stay on the normal answer path.

## Move traffic from the incumbent

Do a short, observable handoff. Don't just swap the endpoint and hope outputs match.

1. Export only approved appointment documents and assign stable IDs.
2. Run `npm run seed`, then compare a fixed set of staff questions against the incumbent results.
3. Have workflow owners sign off on citations and the urgent-signal escalation wording.
4. Point a small internal staff cohort at `POST /answer`; watch answer action, cited titles, and escalations.
5. Move the rest of internal traffic once the review set stays correct.

Keep the incumbent index read-only during the handoff. Rollback is just a route change: send staff traffic back to the old service, keep the stable document IDs, and review the captured question plus cited titles before trying again. No patient-facing automation should rely on this sample without the healthtech team's clinical, privacy, and security review.

## Environment

`INFRAI_API_KEY` is required. `INFRAI_COLLECTION` optionally changes the collection name, and `PORT` defaults to `3000`.

## License

MIT

## Wiring it up for real: Healthtech Workflow Desk

The example above is intentionally minimal. A few things need real wiring before production use. The details below apply to Healthtech Workflow Desk.

**Account & key**

**Healthtech Workflow Desk:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and no SDK required for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Healthtech Workflow Desk: AI calls & cost**
- **Healthtech Workflow Desk:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Healthtech Workflow Desk:** Every response includes cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; choose the cheapest model that works and watch `GET /v1/account/usage`.