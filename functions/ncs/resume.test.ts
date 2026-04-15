import { describe, expect, it, vi } from "vitest";
import { onRequestPost } from "./resume";

describe("ncs resume worker", () => {
  it("enqueues a resume control message", async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);

    const response = await onRequestPost({
      request: new Request("https://example.com/ncs/resume", {
        method: "POST",
        body: JSON.stringify({
          workerId: "worker-2",
        }),
      }),
      env: {
        NCS_CONTROL_QUEUE: {
          send: sendMock,
        },
      },
    });

    expect(response.status).toBe(202);

    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        ok: true,
        action: "resume",
        workerId: "worker-2",
        queued: true,
        stub: false,
        requestId: expect.any(String),
      })
    );

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: "worker-2",
        action: "resume",
        requestId: expect.any(String),
        requestedAt: expect.any(String),
        source: "ncs/resume",
      }),
      {
        contentType: "json",
      }
    );
  });
});
