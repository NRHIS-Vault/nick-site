import { describe, expect, it, vi } from "vitest";
import { onRequestPost } from "./pause";

describe("ncs pause worker", () => {
  it("enqueues a pause control message", async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);

    const response = await onRequestPost({
      request: new Request("https://example.com/ncs/pause", {
        method: "POST",
        body: JSON.stringify({
          workerId: "worker-1",
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
        action: "pause",
        workerId: "worker-1",
        queued: true,
        stub: false,
        requestId: expect.any(String),
      })
    );

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workerId: "worker-1",
        action: "pause",
        requestId: expect.any(String),
        requestedAt: expect.any(String),
        source: "ncs/pause",
      }),
      {
        contentType: "json",
      }
    );
  });

  it("rejects requests without a workerId", async () => {
    const sendMock = vi.fn().mockResolvedValue(undefined);

    const response = await onRequestPost({
      request: new Request("https://example.com/ncs/pause", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      env: {
        NCS_CONTROL_QUEUE: {
          send: sendMock,
        },
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Request body must include a workerId.",
    });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
