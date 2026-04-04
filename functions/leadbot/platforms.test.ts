import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchInstagramLeadBotData } from "./instagram";
import { fetchMetaLeadBotData } from "./meta";
import { fetchTikTokLeadBotData } from "./tiktok";
import type { LeadBotEnv } from "./types";

const createJsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });

const createTextResponse = (body: string, init: ResponseInit = {}) =>
  new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
    ...init,
  });

describe("LeadBot platform workers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("normalizes Meta campaign and lead payloads from mocked Graph API responses", async () => {
    const env: LeadBotEnv = {
      META_ACCESS_TOKEN: "meta-access-token",
      META_APP_SECRET: "meta-app-secret",
      META_AD_ACCOUNT_ID: "123456",
      META_PAGE_ID: "meta-page-1",
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));

      // Each mocked branch mirrors one provider endpoint the worker hits while building
      // the normalized dashboard payload.
      if (url.pathname.endsWith("/act_123456/campaigns")) {
        expect(url.searchParams.get("access_token")).toBe("meta-access-token");
        expect(url.searchParams.get("appsecret_proof")).toBeTruthy();

        return createJsonResponse({
          data: [
            {
              id: "meta-campaign-1",
              name: "Fence Quote Campaign",
              status: "ACTIVE",
              created_time: "2026-04-02T10:00:00Z",
              start_time: "2026-04-02T09:00:00Z",
              insights: {
                data: [
                  {
                    reach: "1200",
                    impressions: "1500",
                    clicks: "75",
                    actions: [
                      {
                        action_type: "lead",
                        value: "9",
                      },
                    ],
                  },
                ],
              },
            },
          ],
        });
      }

      if (url.pathname.endsWith("/meta-page-1/leadgen_forms")) {
        return createJsonResponse({
          data: [
            {
              id: "meta-form-1",
              name: "Fence Form",
            },
          ],
        });
      }

      if (url.pathname.endsWith("/meta-form-1/leads")) {
        return createJsonResponse({
          data: [
            {
              id: "meta-lead-1",
              created_time: "2026-04-02T11:30:00Z",
              field_data: [
                {
                  name: "full_name",
                  values: ["Jane Doe"],
                },
                {
                  name: "phone_number",
                  values: ["555-0101"],
                },
                {
                  name: "service",
                  values: ["Wood Fence"],
                },
              ],
            },
          ],
        });
      }

      throw new Error(`Unexpected Meta fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMetaLeadBotData(env);

    expect(result.platform).toEqual({
      name: "Meta",
      status: "connected",
      posts: 1,
      leads: 1,
    });
    expect(result.campaigns).toEqual([
      {
        id: "meta-campaign-1",
        platform: "Meta",
        content: "Fence Quote Campaign",
        timestamp: "2026-04-02T10:00:00.000Z",
        reach: 1200,
        impressions: 1500,
        clicks: 75,
        conversions: 9,
        leads: 9,
        engagement: 5,
        status: "ACTIVE",
        scheduledTime: "2026-04-02T09:00:00Z",
      },
    ]);
    expect(result.leads).toEqual([
      {
        id: "meta-lead-1",
        name: "Jane Doe",
        phone: "555-0101",
        service: "Wood Fence",
        source: "Meta",
        timestamp: "2026-04-02T11:30:00.000Z",
        status: "NEW",
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("normalizes Instagram media metrics and lead form payloads", async () => {
    const env: LeadBotEnv = {
      INSTAGRAM_ACCESS_TOKEN: "instagram-access-token",
      INSTAGRAM_APP_SECRET: "instagram-app-secret",
      INSTAGRAM_BUSINESS_ACCOUNT_ID: "ig-business-1",
      INSTAGRAM_PAGE_ID: "ig-page-1",
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/ig-business-1/media")) {
        expect(url.searchParams.get("access_token")).toBe("instagram-access-token");
        expect(url.searchParams.get("appsecret_proof")).toBeTruthy();

        return createJsonResponse({
          data: [
            {
              id: "ig-media-1",
              caption: "Fence makeover reel",
              timestamp: "2026-04-01T09:00:00Z",
              like_count: 24,
              comments_count: 6,
              insights: {
                data: [
                  {
                    name: "reach",
                    values: [{ value: 800 }],
                  },
                  {
                    name: "impressions",
                    values: [{ value: 1000 }],
                  },
                  {
                    name: "saved",
                    values: [{ value: 10 }],
                  },
                ],
              },
            },
          ],
        });
      }

      if (url.pathname.endsWith("/ig-page-1/leadgen_forms")) {
        return createJsonResponse({
          data: [
            {
              id: "ig-form-1",
              name: "Instagram Quote Form",
            },
          ],
        });
      }

      if (url.pathname.endsWith("/ig-form-1/leads")) {
        return createJsonResponse({
          data: [
            {
              id: "ig-lead-1",
              created_time: "2026-04-02T07:15:00Z",
              field_data: [
                {
                  name: "full_name",
                  values: ["Alex Rivera"],
                },
                {
                  name: "phone_number",
                  values: ["555-0102"],
                },
              ],
            },
          ],
        });
      }

      throw new Error(`Unexpected Instagram fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchInstagramLeadBotData(env);

    expect(result.platform).toEqual({
      name: "Instagram",
      status: "connected",
      posts: 1,
      leads: 1,
    });
    expect(result.campaigns).toEqual([
      {
        id: "ig-media-1",
        platform: "Instagram",
        content: "Fence makeover reel",
        timestamp: "2026-04-01T09:00:00.000Z",
        reach: 800,
        impressions: 1000,
        clicks: 40,
        conversions: 0,
        leads: 0,
        engagement: 4,
        status: "ACTIVE",
        scheduledTime: "2026-04-01T09:00:00Z",
      },
    ]);
    expect(result.leads).toEqual([
      {
        id: "ig-lead-1",
        name: "Alex Rivera",
        phone: "555-0102",
        service: "Instagram Quote Form",
        source: "Instagram",
        timestamp: "2026-04-02T07:15:00.000Z",
        status: "NEW",
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("normalizes TikTok campaign metrics and downloaded lead CSV rows", async () => {
    const env: LeadBotEnv = {
      TIKTOK_ACCESS_TOKEN: "tiktok-access-token",
      TIKTOK_APP_SECRET: "tiktok-app-secret",
      TIKTOK_ADVERTISER_ID: "advertiser-1",
      TIKTOK_PAGE_ID: "page-99",
      TIKTOK_LEAD_LOOKBACK_DAYS: "14",
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));

      if (url.pathname.endsWith("/campaign/get/")) {
        expect(init?.headers).toMatchObject({
          Accept: "application/json",
          "Access-Token": "tiktok-access-token",
        });

        return createJsonResponse({
          code: 0,
          data: {
            list: [
              {
                campaign_id: "tt-campaign-1",
                campaign_name: "Fence Leads TikTok",
                status: "STATUS_ENABLE",
                create_time: "2026-04-01T08:00:00Z",
              },
            ],
            page_info: {
              page: 1,
              total_page: 1,
            },
          },
        });
      }

      if (url.pathname.endsWith("/reports/integrated/get/")) {
        return createJsonResponse({
          code: 0,
          data: {
            list: [
              {
                campaign_id: "tt-campaign-1",
                impressions: "5000",
                clicks: "250",
                reach: "4200",
              },
            ],
            page_info: {
              page: 1,
              total_page: 1,
            },
          },
        });
      }

      if (url.pathname.endsWith("/page/lead/task/")) {
        const parsedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        if (parsedBody.page_id) {
          expect(parsedBody).toMatchObject({
            page_id: "page-99",
            start_date: "2026-03-20",
            end_date: "2026-04-03",
          });

          return createJsonResponse({
            code: 0,
            data: {
              task_id: "lead-task-1",
            },
          });
        }

        return createJsonResponse({
          code: 0,
          data: {
            task_status: "SUCCESS",
          },
        });
      }

      if (url.pathname.endsWith("/page/lead/task/download/")) {
        return createTextResponse(
          [
            "Lead ID,Full Name,Phone Number,Service,Create Time,Campaign ID",
            "tt-lead-1,Jordan Lee,555-0103,Gate Repair,2026-04-02T10:15:00Z,tt-campaign-1",
          ].join("\n"),
          {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
            },
          }
        );
      }

      throw new Error(`Unexpected TikTok fetch: ${url.toString()}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTikTokLeadBotData(env);

    expect(result.platform).toEqual({
      name: "TikTok",
      status: "connected",
      posts: 1,
      leads: 1,
    });
    expect(result.campaigns).toEqual([
      {
        id: "tt-campaign-1",
        platform: "TikTok",
        content: "Fence Leads TikTok",
        timestamp: "2026-04-01T08:00:00.000Z",
        reach: 4200,
        impressions: 5000,
        clicks: 250,
        conversions: 1,
        leads: 1,
        engagement: 5,
        status: "ACTIVE",
        scheduledTime: "2026-04-01T08:00:00Z",
      },
    ]);
    expect(result.leads).toEqual([
      {
        id: "tt-lead-1",
        name: "Jordan Lee",
        phone: "555-0103",
        service: "Gate Repair",
        source: "TikTok",
        timestamp: "2026-04-02T10:15:00.000Z",
        status: "NEW",
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
