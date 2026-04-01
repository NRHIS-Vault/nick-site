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

type MetaPagingResponse<T> = {
  data?: T[];
  paging?: {
    next?: string;
  };
};

type MetaInsightAction = {
  action_type?: string;
  value?: string;
};

type MetaCampaignNode = {
  id: string;
  name?: string;
  status?: string;
  objective?: string;
  start_time?: string;
  stop_time?: string;
  created_time?: string;
  insights?: {
    data?: Array<{
      reach?: string;
      impressions?: string;
      clicks?: string;
      actions?: MetaInsightAction[];
    }>;
  };
};

type MetaLeadForm = {
  id: string;
  name?: string;
};

type MetaLeadNode = {
  id: string;
  created_time?: string;
  field_data?: Array<{
    name?: string;
    values?: string[];
  }>;
};

const PLATFORM_NAME = "Meta";
const META_GRAPH_BASE_URL = "https://graph.facebook.com/v22.0";
const META_PAGE_LIMIT = 10;

const readMetaConfig = (env: LeadBotEnv) => {
  const accessToken = trimToNull(env.META_ACCESS_TOKEN);
  const adAccountId = trimToNull(env.META_AD_ACCOUNT_ID);
  const pageId = trimToNull(env.META_PAGE_ID);

  return {
    accessToken,
    adAccountId,
    pageId,
    appSecret: trimToNull(env.META_APP_SECRET),
  };
};

const buildMetaUrl = async (
  path: string,
  env: LeadBotEnv,
  query: Record<string, string | number | undefined | null>
) => {
  const config = readMetaConfig(env);
  if (!config.accessToken) {
    throw new Error("Missing META_ACCESS_TOKEN.");
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

const collectMetaPages = async <T>(firstUrl: string) => {
  const items: T[] = [];
  let nextUrl: string | null = firstUrl;
  let pagesRead = 0;

  while (nextUrl && pagesRead < META_PAGE_LIMIT) {
    const page = await safeJsonFetch<MetaPagingResponse<T>>(
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
  fieldData: MetaLeadNode["field_data"],
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

const extractCampaignLeadCount = (campaign: MetaCampaignNode) => {
  const actions = campaign.insights?.data?.[0]?.actions ?? [];
  return actions.reduce((sum, action) => {
    if (!action.action_type?.toLowerCase().includes("lead")) {
      return sum;
    }

    return sum + asNumber(action.value);
  }, 0);
};

const normalizeCampaign = (campaign: MetaCampaignNode): Campaign => {
  const insight = campaign.insights?.data?.[0];
  const impressions = asNumber(insight?.impressions);
  const clicks = asNumber(insight?.clicks);
  const conversions = extractCampaignLeadCount(campaign);

  return {
    id: campaign.id,
    platform: PLATFORM_NAME,
    content: campaign.name || campaign.objective || "Meta lead campaign",
    timestamp: asIsoString(campaign.created_time || campaign.start_time),
    reach: asNumber(insight?.reach),
    impressions,
    clicks,
    conversions,
    leads: conversions,
    engagement: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
    status: toCampaignStatus(campaign.status, campaign.start_time || null),
    scheduledTime: campaign.start_time,
  };
};

const normalizeLead = (lead: MetaLeadNode, formName: string | undefined): Lead => ({
  id: lead.id,
  name:
    getLeadFieldValue(lead.field_data, ["full_name", "name", "first_name"]) ||
    "Meta lead",
  phone:
    getLeadFieldValue(lead.field_data, ["phone_number", "phone"]) || "Not provided",
  service:
    getLeadFieldValue(lead.field_data, ["service", "interest", "project_type"]) ||
    formName ||
    "Meta lead form",
  source: PLATFORM_NAME,
  timestamp: asIsoString(lead.created_time),
  status: "NEW",
});

const fetchRecentCampaigns = async (env: LeadBotEnv) => {
  const { adAccountId } = readMetaConfig(env);
  if (!adAccountId) {
    throw new Error("Missing META_AD_ACCOUNT_ID.");
  }

  // Meta Marketing API campaigns:
  // - `ads_read` is required to read campaign metadata and nested insights.
  // - We request campaign rows plus a small insight snapshot in one paginated call so the
  //   worker does not have to make a second request per campaign, which helps stay under
  //   Meta's Graph API usage windows and app/page call-count limits.
  const firstUrl = await buildMetaUrl(`act_${adAccountId}/campaigns`, env, {
    fields:
      "id,name,status,objective,created_time,start_time,stop_time,insights.limit(1){reach,impressions,clicks,actions}",
    limit: 25,
  });

  const campaigns = await collectMetaPages<MetaCampaignNode>(firstUrl);
  return campaigns.map(normalizeCampaign);
};

const fetchLeadForms = async (env: LeadBotEnv) => {
  const { pageId } = readMetaConfig(env);
  if (!pageId) {
    throw new Error("Missing META_PAGE_ID.");
  }

  const firstUrl = await buildMetaUrl(`${pageId}/leadgen_forms`, env, {
    fields: "id,name,status",
    limit: 25,
  });

  return collectMetaPages<MetaLeadForm>(firstUrl);
};

const fetchFormLeads = async (env: LeadBotEnv, form: MetaLeadForm) => {
  // Meta Lead Ads lead retrieval:
  // - `leads_retrieval` and page access scopes are required.
  // - We paginate each form's `/leads` edge because pages with active lead ads can exceed the
  //   default page size quickly, and Graph API returns opaque `paging.next` URLs to follow.
  const firstUrl = await buildMetaUrl(`${form.id}/leads`, env, {
    fields: "id,created_time,field_data",
    limit: 50,
  });

  const leads = await collectMetaPages<MetaLeadNode>(firstUrl);
  return leads.map((lead) => normalizeLead(lead, form.name));
};

export const isMetaConfigured = (env: LeadBotEnv) => {
  const config = readMetaConfig(env);
  return Boolean(config.accessToken && config.adAccountId && config.pageId);
};

export const fetchMetaLeadBotData = async (
  env: LeadBotEnv
): Promise<PlatformFetchResult> => {
  const campaigns = await fetchRecentCampaigns(env);
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
