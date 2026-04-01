import {
  appendQuery,
  asIsoString,
  asNumber,
  createAppSecretProof,
  createConnectedPlatform,
  safeJsonFetch,
  sortLeadsDescending,
  toCampaignStatus,
  trimToNull,
} from "./shared";
import type { Campaign, Lead, LeadBotEnv, PlatformFetchResult } from "./types";

type InstagramPagingResponse<T> = {
  data?: T[];
  paging?: {
    next?: string;
  };
};

type InstagramMediaNode = {
  id: string;
  caption?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  insights?: {
    data?: Array<{
      name?: string;
      values?: Array<{
        value?: number | string;
      }>;
    }>;
  };
};

type InstagramLeadForm = {
  id: string;
  name?: string;
};

type InstagramLeadNode = {
  id: string;
  created_time?: string;
  field_data?: Array<{
    name?: string;
    values?: string[];
  }>;
};

const PLATFORM_NAME = "Instagram";
const META_GRAPH_BASE_URL = "https://graph.facebook.com/v22.0";
const INSTAGRAM_PAGE_LIMIT = 10;

const readInstagramConfig = (env: LeadBotEnv) => {
  const accessToken = trimToNull(env.INSTAGRAM_ACCESS_TOKEN);
  const businessAccountId = trimToNull(env.INSTAGRAM_BUSINESS_ACCOUNT_ID);
  const pageId = trimToNull(env.INSTAGRAM_PAGE_ID);

  return {
    accessToken,
    businessAccountId,
    pageId,
    appSecret: trimToNull(env.INSTAGRAM_APP_SECRET),
  };
};

const buildInstagramUrl = async (
  path: string,
  env: LeadBotEnv,
  query: Record<string, string | number | undefined | null>
) => {
  const config = readInstagramConfig(env);
  if (!config.accessToken) {
    throw new Error("Missing INSTAGRAM_ACCESS_TOKEN.");
  }

  const url = appendQuery(
    `${META_GRAPH_BASE_URL}/${path.replace(/^\/+/, "")}`,
    {
      ...query,
      access_token: config.accessToken,
    }
  );

  const appSecretProof = await createAppSecretProof(
    config.accessToken,
    config.appSecret
  );

  if (!appSecretProof) {
    return url;
  }

  return appendQuery(url, {
    appsecret_proof: appSecretProof,
  });
};

const collectInstagramPages = async <T>(firstUrl: string) => {
  const items: T[] = [];
  let nextUrl: string | null = firstUrl;
  let pagesRead = 0;

  while (nextUrl && pagesRead < INSTAGRAM_PAGE_LIMIT) {
    const page = await safeJsonFetch<InstagramPagingResponse<T>>(
      nextUrl,
      {
        headers: {
          Accept: "application/json",
        },
      },
      PLATFORM_NAME
    );

    items.push(...(page.data ?? []));
    nextUrl = page.paging?.next || null;
    pagesRead += 1;
  }

  return items;
};

const getLeadFieldValue = (
  fieldData: InstagramLeadNode["field_data"],
  candidateNames: string[]
) => {
  const normalizedCandidates = candidateNames.map((name) => name.toLowerCase());

  for (const field of fieldData ?? []) {
    const normalizedName = field.name?.toLowerCase() || "";
    if (!normalizedCandidates.includes(normalizedName)) {
      continue;
    }

    const firstValue = Array.isArray(field.values) ? field.values[0] : "";
    if (typeof firstValue === "string" && firstValue.trim()) {
      return firstValue.trim();
    }
  }

  return null;
};

const getInsightMetricValue = (
  insights: InstagramMediaNode["insights"],
  metricName: string
) => {
  const insight = insights?.data?.find((entry) => entry.name === metricName);
  return asNumber(insight?.values?.[0]?.value);
};

const normalizeCampaign = (media: InstagramMediaNode): Campaign => {
  const reach = getInsightMetricValue(media.insights, "reach");
  const impressions = getInsightMetricValue(media.insights, "impressions");
  const interactions =
    asNumber(media.like_count) +
    asNumber(media.comments_count) +
    getInsightMetricValue(media.insights, "saved");

  return {
    id: media.id,
    platform: PLATFORM_NAME,
    content: media.caption || "Instagram campaign post",
    timestamp: asIsoString(media.timestamp),
    reach,
    impressions,
    clicks: interactions,
    conversions: 0,
    leads: 0,
    engagement: impressions > 0 ? Number(((interactions / impressions) * 100).toFixed(2)) : 0,
    status: toCampaignStatus("ACTIVE", media.timestamp || null),
    scheduledTime: media.timestamp,
  };
};

const normalizeLead = (lead: InstagramLeadNode, formName?: string): Lead => ({
  id: lead.id,
  name:
    getLeadFieldValue(lead.field_data, ["full_name", "name", "first_name"]) ||
    "Instagram lead",
  phone:
    getLeadFieldValue(lead.field_data, ["phone_number", "phone"]) || "Not provided",
  service:
    getLeadFieldValue(lead.field_data, ["service", "interest", "project_type"]) ||
    formName ||
    "Instagram lead form",
  source: PLATFORM_NAME,
  timestamp: asIsoString(lead.created_time),
  status: "NEW",
});

const fetchRecentMedia = async (env: LeadBotEnv) => {
  const { businessAccountId } = readInstagramConfig(env);
  if (!businessAccountId) {
    throw new Error("Missing INSTAGRAM_BUSINESS_ACCOUNT_ID.");
  }

  // Instagram Graph API media read:
  // - `instagram_basic`, `pages_show_list`, and `instagram_manage_insights` are required.
  // - We request recent media plus nested insights for reach/impressions/saves so each page
  //   of results comes back in one call. This keeps the adapter well below the per-user/app
  //   Graph API usage windows compared to one insight request per media object.
  const firstUrl = await buildInstagramUrl(`${businessAccountId}/media`, env, {
    fields:
      "id,caption,timestamp,like_count,comments_count,insights.metric(reach,impressions,saved)",
    limit: 25,
  });

  const media = await collectInstagramPages<InstagramMediaNode>(firstUrl);
  return media.map(normalizeCampaign);
};

const fetchLeadForms = async (env: LeadBotEnv) => {
  const { pageId } = readInstagramConfig(env);
  if (!pageId) {
    throw new Error("Missing INSTAGRAM_PAGE_ID.");
  }

  // Instagram lead forms are surfaced through the connected Facebook Page's leadgen forms.
  // The provided `INSTAGRAM_PAGE_ID` should be the Page connected to the Instagram Business
  // account whose lead ads/forms you want to retrieve.
  const firstUrl = await buildInstagramUrl(`${pageId}/leadgen_forms`, env, {
    fields: "id,name,status",
    limit: 25,
  });

  return collectInstagramPages<InstagramLeadForm>(firstUrl);
};

const fetchFormLeads = async (env: LeadBotEnv, form: InstagramLeadForm) => {
  const firstUrl = await buildInstagramUrl(`${form.id}/leads`, env, {
    fields: "id,created_time,field_data",
    limit: 50,
  });

  const leads = await collectInstagramPages<InstagramLeadNode>(firstUrl);
  return leads.map((lead) => normalizeLead(lead, form.name));
};

export const isInstagramConfigured = (env: LeadBotEnv) => {
  const config = readInstagramConfig(env);
  return Boolean(config.accessToken && config.businessAccountId && config.pageId);
};

export const fetchInstagramLeadBotData = async (
  env: LeadBotEnv
): Promise<PlatformFetchResult> => {
  const campaigns = await fetchRecentMedia(env);
  const forms = await fetchLeadForms(env);
  const leads = sortLeadsDescending(
    (
      await Promise.all(forms.slice(0, 10).map((form) => fetchFormLeads(env, form)))
    ).flat()
  );

  return {
    platform: createConnectedPlatform(PLATFORM_NAME, campaigns, leads),
    campaigns,
    leads,
    errors: [],
  };
};
