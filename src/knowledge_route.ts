import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { answerFromContext, InfraiError, retrieveContext } from "./infrai_client.ts";
import { decidePatientSafety } from "./patient_safety.ts";

const requestSchema = z.object({
  workflow: z.enum(["booking", "reschedule", "cancellation"]),
  question: z.string().trim().min(8).max(800),
  audience: z.enum(["care_coordinator", "support_agent"]),
}).strict();

const collection = process.env.INFRAI_COLLECTION ?? "appointment-workflows";

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_000) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function answerRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const parsed = requestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      send(response, 400, { error: "invalid_request", issues: parsed.error.issues });
      return;
    }

    const safety = decidePatientSafety(parsed.data.question);
    if (safety.action === "clinical_escalation") {
      send(response, 200, {
        action: safety.action,
        notification: safety.notice,
        answer: null,
        sources: [],
      });
      return;
    }

    const context = await retrieveContext(collection, parsed.data.workflow, parsed.data.question);
    const answer = await answerFromContext(parsed.data.question, context, safety.notice);
    send(response, 200, {
      action: "answer",
      notification: `For ${parsed.data.audience}: verify patient identity before changing an appointment.`,
      answer,
      sources: context.map((item) => item.title),
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      send(response, 400, { error: "invalid_json" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.code, message: error.message });
      return;
    }
    console.error(error);
    send(response, 500, { error: "request_failed" });
  }
}

const server = createServer((request, response) => {
  if (request.method === "POST" && request.url === "/answer") {
    void answerRequest(request, response);
    return;
  }
  send(response, 404, { error: "not_found" });
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Knowledge desk listening on http://localhost:${port}`));
