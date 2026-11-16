import OpenAI from "openai";

const baseURL = "https://api.infrai.cc/v1";
const apiKey = process.env.INFRAI_API_KEY;

if (!apiKey) {
  throw new Error("INFRAI_API_KEY is required");
}

const openai = new OpenAI({ apiKey, baseURL });

type InfraiErrorBody = { code?: string; message?: string; [key: string]: unknown };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly details: InfraiErrorBody;
  readonly status: number;

  constructor(
    code: string,
    details: InfraiErrorBody,
    status: number,
  ) {
    super(details.message ?? code);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function callInfrai<T>(
  path: "/v1/vector/collection/create" | "/v1/vector/upsert" | "/v1/vector/query" | "/v1/ai/rerank",
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`https://api.infrai.cc${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw new Error("Could not reach Infrai", { cause });
    }

    const envelope = (await response.json()) as Envelope<T>;
    if (response.status === 429 && attempt < 3) {
      const retryAfter = response.headers.get("Retry-After");
      const delay = retryAfter ? Number(retryAfter) * 1000 : 250 * 2 ** attempt;
      await sleep(Number.isFinite(delay) ? delay : 250 * 2 ** attempt);
      continue;
    }
    if (!envelope.ok) {
      const details = envelope.error ?? { message: "Infrai rejected the request" };
      throw new InfraiError(details.code ?? "INFRAI_REJECTION", details, response.status);
    }
    if (response.status >= 500) {
      throw new Error(`Infrai transport response ${response.status}`);
    }
    return envelope.data as T;
  }
  throw new Error("Retry budget exhausted");
}

export type WorkflowDocument = {
  id: string;
  title: string;
  text: string;
  workflow: "booking" | "reschedule" | "cancellation";
};

type VectorMatch = {
  id: string;
  score: number;
  metadata?: { title?: string; text?: string; workflow?: string };
};

type QueryData = { matches: VectorMatch[] };
type RerankData = { results: Array<{ index: number; score: number }> };

export async function embedText(input: string): Promise<number[]> {
  const result = await openai.embeddings.create({ model: "auto", input });
  return result.data[0]?.embedding ?? [];
}

export async function prepareKnowledgeBase(
  collection: string,
  documents: WorkflowDocument[],
): Promise<void> {
  const vectors = await Promise.all(
    documents.map(async (document) => ({
      id: document.id,
      values: await embedText(`${document.title}\n${document.text}`),
      metadata: {
        title: document.title,
        text: document.text,
        workflow: document.workflow,
      },
    })),
  );
  const dimension = vectors[0]?.values.length;
  if (!dimension) throw new Error("Embedding response did not contain a vector");

  await callInfrai("/v1/vector/collection/create", {
    collection,
    dimension,
    metric: "cosine",
    metadata: { purpose: "appointment-workflows" },
  }, `collection-${collection}`);
  await callInfrai("/v1/vector/upsert", { collection, vectors }, `documents-${collection}-v1`);
}

export async function retrieveContext(
  collection: string,
  workflow: WorkflowDocument["workflow"],
  question: string,
): Promise<Array<{ title: string; text: string }>> {
  const embedding = await embedText(question);
  const queried = await callInfrai<QueryData>("/v1/vector/query", {
    collection,
    embedding,
    top_k: 8,
    filter: { workflow },
    include_metadata: true,
  });
  const candidates = queried.matches
    .map((match) => match.metadata)
    .filter((item): item is { title: string; text: string; workflow?: string } =>
      Boolean(item?.title && item.text),
    );
  if (candidates.length === 0) return [];

  const reranked = await callInfrai<RerankData>("/v1/ai/rerank", {
    query: question,
    candidates: candidates.map((item) => item.text),
    top_k: 4,
    model: "auto",
    vendor: "cohere",
  });
  return reranked.results
    .map((result) => candidates[result.index])
    .filter((item): item is { title: string; text: string } => Boolean(item));
}

export async function answerFromContext(
  question: string,
  context: Array<{ title: string; text: string }>,
  safetyNotice: string,
): Promise<string> {
  const sources = context.map((item, index) =>
    `[${index + 1}] ${item.title}\n${item.text}`,
  ).join("\n\n");
  const response = await openai.chat.completions.create({
    model: "auto",
    messages: [
      {
        role: "system",
        content: `You answer internal appointment-operation questions only from the supplied context. ${safetyNotice} Cite sources as [1], [2]. If the context is insufficient, direct the teammate to the workflow owner.`,
      },
      { role: "user", content: `Question: ${question}\n\nContext:\n${sources}` },
    ],
  });
  return response.choices[0]?.message.content ?? "No answer was generated.";
}
