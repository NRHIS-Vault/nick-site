type PauseResumeRequest = {
  workerId?: unknown;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readWorkerId = async (request: Request) => {
  const payload = (await request.json().catch(() => null)) as PauseResumeRequest | null;

  if (!isRecord(payload) || typeof payload.workerId !== "string" || !payload.workerId.trim()) {
    throw new Error("Request body must include a workerId.");
  }

  return payload.workerId.trim();
};

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

export const onRequestPost = async ({ request }: { request: Request }) => {
  try {
    const workerId = await readWorkerId(request);

    // Day 1 only wires the control path end-to-end. Day 2 will connect this stub to
    // the actual scheduler/orchestrator so resume requests mutate runner state.
    return jsonResponse(
      {
        ok: true,
        action: "resume",
        workerId,
        stub: true,
        message: "Resume worker stub acknowledged. Implement the real control flow in Day 2.",
      },
      202
    );
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to queue the resume request.",
      },
      400
    );
  }
};
