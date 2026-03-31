import type {
  Campaign,
  CampaignStatus,
  Lead,
  LeadBotEnv,
  LeadStatus,
  Platform,
  PlatformFetchResult,
} from "./types";

export type JsonObject = Record<string, unknown>;

export class PlatformApiError extends Error {
  status: number;
  platform: string;

  constructor(platform: string, status: number, message: string) {
    super(message);
    this.name = "PlatformApiError";
    this.platform = platform;
    this.status = status;
  }
}

const encoder = new TextEncoder();

export const trimToNull = (value: string | undefined) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const asNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

export const asIsoString = (value: unknown, fallback = new Date().toISOString()) => {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }

  return fallback;
};

export const readLookbackDays = (env: LeadBotEnv, fallback = 30) => {
  const parsed = Number(trimToNull(env.TIKTOK_LEAD_LOOKBACK_DAYS) || fallback);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), 90);
};

export const getIsoDateDaysAgo = (daysAgo: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
};

export const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown error";

export const toCampaignStatus = (
  rawStatus: string | undefined,
  scheduledTime?: string | null
): CampaignStatus => {
  const normalized = (rawStatus || "").toUpperCase();

  if (normalized.includes("ACTIVE") || normalized.includes("ENABLE")) {
    return "ACTIVE";
  }

  if (
    normalized.includes("SCHEDULE") ||
    normalized.includes("PAUSE") ||
    (scheduledTime && Date.parse(scheduledTime) > Date.now())
  ) {
    return "SCHEDULED";
  }

  return "COMPLETED";
};

export const toLeadStatus = (rawStatus?: string): LeadStatus => {
  const normalized = (rawStatus || "").toUpperCase();

  if (normalized.includes("CONTACT")) {
    return "CONTACTED";
  }

  if (normalized.includes("QUAL")) {
    return "QUALIFIED";
  }

  if (normalized.includes("CONVERT")) {
    return "CONVERTED";
  }

  return "NEW";
};

export const createPendingPlatform = (name: string): Platform => ({
  name,
  status: "pending",
  posts: 0,
  leads: 0,
});

export const createFailureResult = (name: string, error: unknown): PlatformFetchResult => ({
  platform: createPendingPlatform(name),
  campaigns: [],
  leads: [],
  errors: [getErrorMessage(error)],
});

export const createConnectedPlatform = (
  name: string,
  campaigns: Campaign[],
  leads: Lead[]
): Platform => ({
  name,
  status: "connected",
  posts: campaigns.length,
  leads: leads.length,
});

export const safeJsonFetch = async <T>(
  url: string,
  init: RequestInit,
  platform: string
): Promise<T> => {
  const response = await fetch(url, init);

  if (response.status === 429) {
    throw new PlatformApiError(
      platform,
      429,
      `${platform} rate limit reached. Slow down polling and retry later.`
    );
  }

  if (!response.ok) {
    const body = await response.text();
    throw new PlatformApiError(
      platform,
      response.status,
      `${platform} API request failed (${response.status} ${response.statusText})${
        body ? `: ${body}` : ""
      }`
    );
  }

  return (await response.json()) as T;
};

export const safeTextFetch = async (
  url: string,
  init: RequestInit,
  platform: string
) => {
  const response = await fetch(url, init);

  if (response.status === 429) {
    throw new PlatformApiError(
      platform,
      429,
      `${platform} rate limit reached. Slow down polling and retry later.`
    );
  }

  if (!response.ok) {
    const body = await response.text();
    throw new PlatformApiError(
      platform,
      response.status,
      `${platform} download request failed (${response.status} ${response.statusText})${
        body ? `: ${body}` : ""
      }`
    );
  }

  return {
    text: await response.text(),
    contentType: response.headers.get("Content-Type") || "",
  };
};

export const appendQuery = (
  baseUrl: string,
  query: Record<string, string | number | undefined | null>
) => {
  const url = new URL(baseUrl);

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    url.searchParams.set(key, String(value));
  });

  return url.toString();
};

export const createAppSecretProof = async (
  accessToken: string,
  appSecret: string | null
) => {
  if (!appSecret) {
    return null;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(accessToken));

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const sortLeadsDescending = (leads: Lead[]) =>
  [...leads].sort(
    (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp)
  );

export const isWithinLast30Days = (timestamp: string) =>
  Date.now() - Date.parse(timestamp) <= 30 * 24 * 60 * 60 * 1000;

export const summarizeLeadBotResults = (
  results: PlatformFetchResult[]
): {
  overview: {
    totalLeads: number;
    monthlyLeads: number;
    conversionRate: number;
    activeCampaigns: number;
  };
  campaigns: Campaign[];
  platforms: Platform[];
  recentLeads: Lead[];
  errors: string[];
} => {
  const campaigns = results.flatMap((result) => result.campaigns);
  const allLeads = sortLeadsDescending(results.flatMap((result) => result.leads));
  const leads = allLeads.slice(0, 25);
  const totalReach = campaigns.reduce((sum, campaign) => sum + campaign.reach, 0);
  const totalCampaignLeads = campaigns.reduce((sum, campaign) => sum + campaign.leads, 0);

  return {
    overview: {
      totalLeads: allLeads.length,
      monthlyLeads: allLeads.filter((lead) => isWithinLast30Days(lead.timestamp)).length,
      conversionRate: totalReach > 0 ? Number(((totalCampaignLeads / totalReach) * 100).toFixed(2)) : 0,
      activeCampaigns: campaigns.filter((campaign) => campaign.status === "ACTIVE").length,
    },
    campaigns,
    platforms: results.map((result) => result.platform),
    recentLeads: leads,
    errors: results.flatMap((result) => result.errors),
  };
};
