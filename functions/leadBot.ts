import { fetchInstagramLeadBotData, isInstagramConfigured } from "./leadbot/instagram";
import { createFailureResult, createPendingPlatform, summarizeLeadBotResults } from "./leadbot/shared";
import { fetchMetaLeadBotData, isMetaConfigured } from "./leadbot/meta";
import { fetchTikTokLeadBotData, isTikTokConfigured } from "./leadbot/tiktok";
import type { LeadBotEnv, LeadBotResponse, PlatformFetchResult } from "./leadbot/types";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

const buildFallbackPayload = (): LeadBotResponse => ({
  overview: {
    totalLeads: 847,
    monthlyLeads: 156,
    conversionRate: 23.5,
    activeCampaigns: 2,
  },
  campaigns: [
    {
      id: "cmp-1",
      platform: "Meta",
      content:
        "Professional fence installation - Free estimates! Transform your property with quality fencing.",
      timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      reach: 12500,
      impressions: 18400,
      clicks: 932,
      conversions: 28,
      leads: 28,
      engagement: 8.5,
      status: "ACTIVE",
    },
    {
      id: "cmp-2",
      platform: "Instagram",
      content:
        "Before & After: Amazing fence transformations in your area. See the difference quality makes!",
      timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      reach: 8900,
      impressions: 12700,
      clicks: 644,
      conversions: 19,
      leads: 19,
      engagement: 12.3,
      status: "ACTIVE",
    },
    {
      id: "cmp-3",
      platform: "TikTok",
      content:
        "Quick fence repair tips & when to call the pros. Don't let damaged fences hurt your property value!",
      timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      reach: 15600,
      impressions: 22600,
      clicks: 1304,
      conversions: 34,
      leads: 34,
      engagement: 15.8,
      status: "SCHEDULED",
      scheduledTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    },
  ],
  platforms: [
    { name: "Meta", status: "pending", posts: 0, leads: 0 },
    { name: "Instagram", status: "pending", posts: 0, leads: 0 },
    { name: "TikTok", status: "pending", posts: 0, leads: 0 },
  ],
  recentLeads: [
    {
      id: "lb-1",
      name: "Maria Rodriguez",
      phone: "(555) 123-4567",
      service: "Chain Link Fence",
      source: "Meta",
      timestamp: new Date().toISOString(),
      status: "NEW",
    },
    {
      id: "lb-2",
      name: "John Smith",
      phone: "(555) 987-6543",
      service: "Privacy Fence",
      source: "Instagram",
      timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      status: "CONTACTED",
    },
    {
      id: "lb-3",
      name: "Lisa Johnson",
      phone: "(555) 456-7890",
      service: "Fence Repair",
      source: "TikTok",
      timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      status: "QUALIFIED",
    },
  ],
});

const platformLoaders = [
  {
    name: "Meta",
    isConfigured: isMetaConfigured,
    load: fetchMetaLeadBotData,
  },
  {
    name: "Instagram",
    isConfigured: isInstagramConfigured,
    load: fetchInstagramLeadBotData,
  },
  {
    name: "TikTok",
    isConfigured: isTikTokConfigured,
    load: fetchTikTokLeadBotData,
  },
] as const;

const isLeadWithinRange = (timestamp: string, dateRangeDays: number) =>
  Date.now() - Date.parse(timestamp) <= dateRangeDays * 24 * 60 * 60 * 1000;

const parseDateRangeDays = (value: string | null) => {
  if (!value) {
    return 30;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 30;
  }

  return Math.min(Math.floor(parsed), 365);
};

const normalizePlatformFilter = (value: string | null) => {
  if (!value) {
    return "all";
  }

  const normalized = value.trim().toLowerCase();
  return normalized || "all";
};

const normalizeSearchFilter = (value: string | null) =>
  value?.trim().toLowerCase() || "";

const campaignMatchesSearch = (
  campaign: LeadBotResponse["campaigns"][number],
  search: string
) =>
  !search ||
  [
    campaign.platform,
    campaign.content,
    campaign.status,
  ].some((value) => value.toLowerCase().includes(search));

const leadMatchesSearch = (
  lead: LeadBotResponse["recentLeads"][number],
  search: string
) =>
  !search ||
  [
    lead.name,
    lead.phone,
    lead.service,
    lead.source,
    lead.status,
  ].some((value) => value.toLowerCase().includes(search));

const filterLeadBotPayload = (
  payload: LeadBotResponse & { errors?: string[] },
  request: Request
) => {
  const url = new URL(request.url);
  const platformFilter = normalizePlatformFilter(url.searchParams.get("platform"));
  const dateRangeDays = parseDateRangeDays(url.searchParams.get("dateRange"));
  const searchFilter = normalizeSearchFilter(url.searchParams.get("search"));

  const platformMatches = (value: string) =>
    platformFilter === "all" || value.toLowerCase() === platformFilter;

  // The worker fetches provider data first, then applies the UI filters so the frontend can
  // treat `/leadBot` as a single queryable source while React Query keys control refetching.
  const campaigns = payload.campaigns.filter(
    (campaign) =>
      platformMatches(campaign.platform) &&
      isLeadWithinRange(campaign.timestamp, dateRangeDays) &&
      campaignMatchesSearch(campaign, searchFilter)
  );

  const recentLeads = payload.recentLeads.filter(
    (lead) =>
      platformMatches(lead.source) &&
      isLeadWithinRange(lead.timestamp, dateRangeDays) &&
      leadMatchesSearch(lead, searchFilter)
  );

  const platforms = payload.platforms
    .filter((platform) => platformFilter === "all" || platform.name.toLowerCase() === platformFilter)
    .map((platform) => {
      const platformCampaigns = campaigns.filter(
        (campaign) => campaign.platform.toLowerCase() === platform.name.toLowerCase()
      );
      const platformLeads = recentLeads.filter(
        (lead) => lead.source.toLowerCase() === platform.name.toLowerCase()
      );

      return {
        ...platform,
        posts: platformCampaigns.length,
        leads: platformLeads.length,
      };
    });

  const totalImpressions = campaigns.reduce(
    (sum, campaign) => sum + campaign.impressions,
    0
  );
  const totalConversions = campaigns.reduce(
    (sum, campaign) => sum + campaign.conversions,
    0
  );

  return {
    overview: {
      totalLeads: recentLeads.length,
      monthlyLeads: recentLeads.length,
      conversionRate:
        totalImpressions > 0
          ? Number(((totalConversions / totalImpressions) * 100).toFixed(2))
          : 0,
      activeCampaigns: campaigns.filter((campaign) => campaign.status === "ACTIVE").length,
    },
    campaigns,
    platforms,
    recentLeads,
    ...(payload.errors?.length ? { errors: payload.errors } : {}),
  };
};

const loadPlatformData = async (env: LeadBotEnv) => {
  const configuredPlatforms = platformLoaders.filter((loader) => loader.isConfigured(env));

  // Preserve a demo-friendly response when no social credentials are configured locally.
  if (!configuredPlatforms.length) {
    return buildFallbackPayload();
  }

  const results = await Promise.all(
    platformLoaders.map(async (loader): Promise<PlatformFetchResult> => {
      if (!loader.isConfigured(env)) {
        return {
          platform: createPendingPlatform(loader.name),
          campaigns: [],
          leads: [],
          errors: [],
        };
      }

      try {
        return await loader.load(env);
      } catch (error) {
        console.error(`LeadBot ${loader.name} sync failed`, error);
        return createFailureResult(loader.name, error);
      }
    })
  );

  const summary = summarizeLeadBotResults(results);

  return {
    overview: summary.overview,
    campaigns: summary.campaigns,
    platforms: summary.platforms,
    recentLeads: summary.recentLeads,
    ...(summary.errors.length ? { errors: summary.errors } : {}),
  } satisfies LeadBotResponse & { errors?: string[] };
};

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

export const onRequestGet = async ({
  request,
  env,
}: {
  request: Request;
  env: LeadBotEnv;
}) => {
  try {
    const payload = await loadPlatformData(env);
    return jsonResponse(filterLeadBotPayload(payload, request));
  } catch (error) {
    console.error("LeadBot request failed", error);
    return jsonResponse(
      {
        ok: false,
        error: "Unable to load LeadBot data right now.",
      },
      500
    );
  }
};
