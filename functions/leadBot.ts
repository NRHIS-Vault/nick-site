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
      reach: 12500,
      leads: 28,
      engagement: 8.5,
      status: "ACTIVE",
    },
    {
      id: "cmp-2",
      platform: "Instagram",
      content:
        "Before & After: Amazing fence transformations in your area. See the difference quality makes!",
      reach: 8900,
      leads: 19,
      engagement: 12.3,
      status: "ACTIVE",
    },
    {
      id: "cmp-3",
      platform: "TikTok",
      content:
        "Quick fence repair tips & when to call the pros. Don't let damaged fences hurt your property value!",
      reach: 15600,
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

export const onRequestGet = async ({ env }: { env: LeadBotEnv }) => {
  try {
    const payload = await loadPlatformData(env);
    return jsonResponse(payload);
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
