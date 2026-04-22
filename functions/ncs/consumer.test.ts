import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  fromMock: vi.fn(),
  updateMock: vi.fn(),
  eqMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMocks.createClientMock,
}));

import { consumeNcsControlBatch } from "./consumer";

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_KEY: "service-role-key",
  WORKER_ANALYTICS: {
    writeDataPoint: vi.fn(),
  },
};

const createMessage = (body: unknown) => ({
  id: "queue-message-1",
  body,
  attempts: 1,
  ack: vi.fn(),
  retry: vi.fn(),
});

describe("ncs control queue consumer", () => {
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    supabaseMocks.createClientMock.mockReset();
    supabaseMocks.fromMock.mockReset();
    supabaseMocks.updateMock.mockReset();
    supabaseMocks.eqMock.mockReset();
    env.WORKER_ANALYTICS.writeDataPoint.mockReset();

    consoleLogSpy.mockClear();
    consoleWarnSpy.mockClear();
    consoleErrorSpy.mockClear();

    supabaseMocks.fromMock.mockReturnValue({
      update: supabaseMocks.updateMock,
    });
    supabaseMocks.updateMock.mockReturnValue({
      eq: supabaseMocks.eqMock,
    });
    supabaseMocks.createClientMock.mockReturnValue({
      from: supabaseMocks.fromMock,
    });
  });

  afterEach(() => {
    consoleLogSpy.mockClear();
    consoleWarnSpy.mockClear();
    consoleErrorSpy.mockClear();
  });

  it("updates ncs_workers and acknowledges a valid pause message", async () => {
    supabaseMocks.eqMock.mockImplementation((column: string) => ({
      select: vi.fn().mockResolvedValue(
        column === "id"
          ? {
              data: [
                {
                  id: "worker-1",
                  worker_key: "leadbot-runner",
                  name: "LeadBot Runner",
                  status: "paused",
                  is_paused: true,
                },
              ],
              error: null,
            }
          : {
              data: [],
              error: null,
            }
      ),
    }));

    const message = createMessage({
      workerId: "worker-1",
      action: "pause",
      requestId: "request-1",
      requestedAt: "2026-04-14T12:00:00.000Z",
      source: "ncs/pause",
    });

    await consumeNcsControlBatch(
      {
        messages: [message],
      },
      env
    );

    expect(supabaseMocks.fromMock).toHaveBeenCalledWith("ncs_workers");
    expect(supabaseMocks.updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "paused",
        status_message: "Pause requested via NCS control queue.",
        is_paused: true,
      })
    );
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "[ncs-control-consumer] Processed NCS control queue message",
      expect.objectContaining({
        requestId: "request-1",
        workerId: "worker-1",
        action: "pause",
        latencyMs: expect.any(Number),
      })
    );
    expect(env.WORKER_ANALYTICS.writeDataPoint).toHaveBeenCalledWith({
      indexes: ["ncs-control-consumer:ncs-control-queue"],
      blobs: [
        "queue_message",
        "ncs-control-consumer",
        "ncs-control-queue",
        "pause",
        "success",
        "paused",
        "ncs-control-queue",
        "worker",
      ],
      doubles: [1, expect.any(Number), 0],
    });
  });

  it("acknowledges malformed control messages without opening Supabase", async () => {
    const message = createMessage({
      action: "pause",
    });

    await consumeNcsControlBatch(
      {
        messages: [message],
      },
      env
    );

    expect(supabaseMocks.createClientMock).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[ncs-control-consumer] Discarding malformed NCS control queue message",
      expect.objectContaining({
        queueMessageId: "queue-message-1",
      })
    );
  });

  it("retries messages when the Supabase update fails", async () => {
    supabaseMocks.eqMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: null,
        error: {
          message: "database unavailable",
        },
      }),
    });

    const message = createMessage({
      workerId: "worker-1",
      action: "resume",
      requestId: "request-2",
      requestedAt: "2026-04-14T12:00:00.000Z",
      source: "ncs/resume",
    });

    await consumeNcsControlBatch(
      {
        messages: [message],
      },
      env
    );

    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({
      delaySeconds: 30,
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[ncs-control-consumer] Failed to process NCS control queue message",
      expect.objectContaining({
        requestId: "request-2",
        workerId: "worker-1",
        action: "resume",
        error: expect.objectContaining({
          message: "Failed to update ncs_workers using id: database unavailable",
        }),
      })
    );
  });
});
