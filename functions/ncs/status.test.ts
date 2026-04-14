import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  fromMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMocks.createClientMock,
}));

import { onRequestGet } from "./status";

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_KEY: "service-role-key",
};

describe("ncs status worker", () => {
  beforeEach(() => {
    supabaseMocks.createClientMock.mockReset();
    supabaseMocks.fromMock.mockReset();
    supabaseMocks.selectMock.mockReset();

    supabaseMocks.selectMock.mockResolvedValue({
      data: [
        {
          id: "worker-busy",
          worker_key: "leadbot-runner",
          name: "LeadBot Runner",
          status: "running",
          current_job: {
            id: "job-1",
            name: "Lead intake sync",
            type: "sync",
            queue: "leadbot",
            progress_pct: 65,
            details: {
              summary: "Polling Meta and TikTok lead queues.",
            },
          },
          last_heartbeat_at: "2026-04-13T10:00:00.000Z",
          last_started_at: "2026-04-13T09:58:00.000Z",
          updated_at: "2026-04-13T10:00:00.000Z",
        },
        {
          id: "worker-error",
          worker_key: "invoice-runner",
          name: "Invoice Runner",
          status: "failed",
          error_message: "Exchange timeout",
          is_paused: true,
          paused_at: "2026-04-13T09:30:00.000Z",
          last_finished_at: "2026-04-13T09:29:00.000Z",
          updated_at: "2026-04-13T09:30:00.000Z",
        },
      ],
      error: null,
    });
    supabaseMocks.fromMock.mockReturnValue({
      select: supabaseMocks.selectMock,
    });
    supabaseMocks.createClientMock.mockReturnValue({
      from: supabaseMocks.fromMock,
    });
  });

  it("normalizes ncs_workers rows from Supabase into the shared worker status contract", async () => {
    const response = await onRequestGet({
      request: new Request("https://example.com/ncs/status"),
      env,
    });

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.source).toBe("supabase");
    expect(body.summary).toEqual({
      totalWorkers: 2,
      idleWorkers: 0,
      busyWorkers: 1,
      errorWorkers: 1,
      pausedWorkers: 1,
    });
    expect(supabaseMocks.fromMock).toHaveBeenCalledWith("ncs_workers");
    expect(supabaseMocks.selectMock).toHaveBeenCalledWith("*");

    expect(body.workers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "worker-busy",
          workerKey: "leadbot-runner",
          name: "LeadBot Runner",
          status: "busy",
          source: "supabase",
          isPaused: false,
          job: expect.objectContaining({
            id: "job-1",
            name: "Lead intake sync",
            queue: "leadbot",
            progressPct: 65,
          }),
        }),
        expect.objectContaining({
          id: "worker-error",
          workerKey: "invoice-runner",
          name: "Invoice Runner",
          status: "error",
          statusMessage: "Exchange timeout",
          isPaused: true,
          job: expect.objectContaining({
            error: "Exchange timeout",
          }),
        }),
      ])
    );
  });

  it("returns fallback stub data when no Supabase or external provider is configured", async () => {
    const response = await onRequestGet({
      request: new Request("https://example.com/ncs/status"),
      env: {},
    });

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.source).toBe("stub");
    expect(body.summary.totalWorkers).toBeGreaterThan(0);
    expect(body.workers[0]).toEqual(
      expect.objectContaining({
        source: "stub",
      })
    );
    expect(supabaseMocks.createClientMock).not.toHaveBeenCalled();
  });
});
