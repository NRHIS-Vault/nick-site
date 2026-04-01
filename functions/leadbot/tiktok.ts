import {
  appendQuery,
  asIsoString,
  asNumber,
  createConnectedPlatform,
  getIsoDateDaysAgo,
  PlatformApiError,
  readLookbackDays,
  safeJsonFetch,
  safeTextFetch,
  sortLeadsDescending,
  toCampaignStatus,
  trimToNull,
} from "./shared";
import type { Campaign, Lead, LeadBotEnv, PlatformFetchResult } from "./types";

type TikTokEnvelope<T> = {
  code?: number;
  message?: string;
  request_id?: string;
  data?: T;
};

type TikTokCampaignNode = {
  campaign_id?: string;
  id?: string;
  campaign_name?: string;
  name?: string;
  objective_type?: string;
  status?: string;
  operation_status?: string;
  secondary_status?: string;
  create_time?: string;
  modify_time?: string;
};

type TikTokCampaignListData = {
  list?: TikTokCampaignNode[];
  page_info?: {
    page?: number;
    total_page?: number;
  };
};

type TikTokReportRow = {
  campaign_id?: string;
  impressions?: string | number;
  reach?: string | number;
  clicks?: string | number;
};

type TikTokReportData = {
  list?: TikTokReportRow[];
  page_info?: {
    page?: number;
    total_page?: number;
  };
};

type TikTokLeadTaskData = {
  task_id?: string;
  status?: string;
  task_status?: string;
};

type CsvRow = Record<string, string>;

const PLATFORM_NAME = "TikTok";
const TIKTOK_BASE_URL = "https://business-api.tiktok.com/open_api/v1.3";
const TIKTOK_PAGE_LIMIT = 10;
const TIKTOK_TASK_POLL_ATTEMPTS = 5;
const TIKTOK_TASK_POLL_DELAY_MS = 750;

const readTikTokConfig = (env: LeadBotEnv) => ({
  accessToken: trimToNull(env.TIKTOK_ACCESS_TOKEN),
  advertiserId: trimToNull(env.TIKTOK_ADVERTISER_ID),
  pageId: trimToNull(env.TIKTOK_PAGE_ID),
});

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const safeTikTokFetch = async <T>(url: string, init: RequestInit) => {
  const response = await safeJsonFetch<TikTokEnvelope<T>>(
    url,
    init,
    PLATFORM_NAME
  );

  if ((response.code ?? 0) !== 0) {
    throw new PlatformApiError(
      PLATFORM_NAME,
      400,
      `TikTok API returned code ${response.code ?? "unknown"}: ${
        response.message || "Unknown TikTok error"
      }`
    );
  }

  return response.data as T;
};

const buildTikTokHeaders = (env: LeadBotEnv) => {
  const { accessToken } = readTikTokConfig(env);
  if (!accessToken) {
    throw new Error("Missing TIKTOK_ACCESS_TOKEN.");
  }

  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "Access-Token": accessToken,
  };
};

const parseCsvLine = (line: string) => {
  const values: string[] = [];
  let currentValue = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      const nextCharacter = line[index + 1];
      if (insideQuotes && nextCharacter === '"') {
        currentValue += '"';
        index += 1;
        continue;
      }

      insideQuotes = !insideQuotes;
      continue;
    }

    if (character === "," && !insideQuotes) {
      values.push(currentValue);
      currentValue = "";
      continue;
    }

    currentValue += character;
  }

  values.push(currentValue);
  return values.map((value) => value.trim());
};

const parseCsv = (rawCsv: string): CsvRow[] => {
  const lines = rawCsv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: CsvRow = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    return row;
  });
};

const getCsvValue = (row: CsvRow, candidates: string[]) => {
  for (const candidate of candidates) {
    const exact = row[candidate];
    if (typeof exact === "string" && exact.trim()) {
      return exact.trim();
    }

    const matchedKey = Object.keys(row).find(
      (key) => key.toLowerCase() === candidate.toLowerCase()
    );

    if (matchedKey && row[matchedKey].trim()) {
      return row[matchedKey].trim();
    }
  }

  return null;
};

const fetchRecentCampaigns = async (env: LeadBotEnv) => {
  const { advertiserId } = readTikTokConfig(env);
  if (!advertiserId) {
    throw new Error("Missing TIKTOK_ADVERTISER_ID.");
  }

  // TikTok campaign listing:
  // - Requires a Marketing API advertiser access token with read access to campaigns.
  // - We page through `/campaign/get/` instead of requesting huge page sizes because TikTok
  //   enforces per-endpoint rate limits and smaller pages make retries cheaper after 429s.
  const items: TikTokCampaignNode[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= TIKTOK_PAGE_LIMIT) {
    const url = appendQuery(`${TIKTOK_BASE_URL}/campaign/get/`, {
      advertiser_id: advertiserId,
      page,
      page_size: 25,
    });

    const data = await safeTikTokFetch<TikTokCampaignListData>(url, {
      method: "GET",
      headers: buildTikTokHeaders(env),
    });

    items.push(...(data.list ?? []));
    totalPages = asNumber(data.page_info?.total_page) || 1;
    page += 1;
  }

  return items;
};

const fetchCampaignMetrics = async (env: LeadBotEnv) => {
  const { advertiserId } = readTikTokConfig(env);
  if (!advertiserId) {
    return new Map<string, TikTokReportRow>();
  }

  const metricsByCampaign = new Map<string, TikTokReportRow>();
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= TIKTOK_PAGE_LIMIT) {
    // TikTok reporting:
    // - Reporting endpoints are separate from campaign metadata, so we keep them optional.
    // - If this call starts returning 429s in production, reduce `page_size`, poll less often,
    //   or cache the metrics snapshot because reporting windows are more expensive than listing.
    const url = appendQuery(`${TIKTOK_BASE_URL}/reports/integrated/get/`, {
      advertiser_id: advertiserId,
      report_type: "BASIC",
      data_level: "AUCTION_CAMPAIGN",
      dimensions: JSON.stringify(["campaign_id"]),
      metrics: JSON.stringify(["impressions", "clicks", "reach"]),
      start_date: getIsoDateDaysAgo(30),
      end_date: getIsoDateDaysAgo(0),
      page,
      page_size: 25,
    });

    const data = await safeTikTokFetch<TikTokReportData>(url, {
      method: "GET",
      headers: buildTikTokHeaders(env),
    });

    (data.list ?? []).forEach((row) => {
      const campaignId = row.campaign_id;
      if (campaignId) {
        metricsByCampaign.set(campaignId, row);
      }
    });

    totalPages = asNumber(data.page_info?.total_page) || 1;
    page += 1;
  }

  return metricsByCampaign;
};

const createLeadDownloadTask = async (env: LeadBotEnv) => {
  const { advertiserId, pageId } = readTikTokConfig(env);
  if (!advertiserId || !pageId) {
    return null;
  }

  const lookbackDays = readLookbackDays(env);
  const data = await safeTikTokFetch<TikTokLeadTaskData>(
    appendQuery(`${TIKTOK_BASE_URL}/page/lead/task/`, {
      advertiser_id: advertiserId,
    }),
    {
      method: "POST",
      headers: buildTikTokHeaders(env),
      body: JSON.stringify({
        page_id: pageId,
        start_date: getIsoDateDaysAgo(lookbackDays),
        end_date: getIsoDateDaysAgo(0),
      }),
    }
  );

  return data.task_id || null;
};

const waitForLeadTask = async (env: LeadBotEnv, taskId: string) => {
  const { advertiserId } = readTikTokConfig(env);
  if (!advertiserId) {
    throw new Error("Missing TIKTOK_ADVERTISER_ID.");
  }

  for (let attempt = 0; attempt < TIKTOK_TASK_POLL_ATTEMPTS; attempt += 1) {
    const task = await safeTikTokFetch<TikTokLeadTaskData>(
      appendQuery(`${TIKTOK_BASE_URL}/page/lead/task/`, {
        advertiser_id: advertiserId,
      }),
      {
        method: "POST",
        headers: buildTikTokHeaders(env),
        body: JSON.stringify({
          task_id: taskId,
        }),
      }
    );

    const status = (task.task_status || task.status || "").toUpperCase();
    if (status.includes("SUCCESS") || status.includes("FINISH")) {
      return;
    }

    if (status.includes("FAIL")) {
      throw new Error(`TikTok lead download task failed with status ${status}.`);
    }

    await sleep(TIKTOK_TASK_POLL_DELAY_MS);
  }

  throw new Error("Timed out waiting for the TikTok lead export task to finish.");
};

const downloadLeadCsv = async (env: LeadBotEnv, taskId: string) => {
  const { advertiserId } = readTikTokConfig(env);
  if (!advertiserId) {
    throw new Error("Missing TIKTOK_ADVERTISER_ID.");
  }

  // TikTok lead download:
  // - Official Lead Center exports are time-bound and retained for a limited window.
  // - TikTok can return CSV or a zipped export depending on size. This worker parses plain CSV
  //   directly and raises a clear error for compressed exports so you can narrow the date range
  //   or add unzip support if a larger export is required later.
  const { text, contentType } = await safeTextFetch(
    appendQuery(`${TIKTOK_BASE_URL}/page/lead/task/download/`, {
      advertiser_id: advertiserId,
      task_id: taskId,
    }),
    {
      method: "GET",
      headers: {
        ...buildTikTokHeaders(env),
        Accept: "text/csv,application/octet-stream",
      },
    },
    PLATFORM_NAME
  );

  if (contentType.toLowerCase().includes("zip")) {
    throw new Error(
      "TikTok returned a zipped lead export. Narrow the lookback window or add unzip support."
    );
  }

  return text;
};

const normalizeLead = (row: CsvRow): Lead => ({
  id: getCsvValue(row, ["lead_id", "Lead ID", "id"]) || crypto.randomUUID(),
  name:
    getCsvValue(row, ["full_name", "Full Name", "name"]) ||
    [
      getCsvValue(row, ["first_name", "First Name"]),
      getCsvValue(row, ["last_name", "Last Name"]),
    ]
      .filter(Boolean)
      .join(" ") ||
    "TikTok lead",
  phone:
    getCsvValue(row, ["phone_number", "Phone Number", "phone"]) || "Not provided",
  service:
    getCsvValue(row, ["service", "Service", "interest", "Interest", "project_type"]) ||
    "TikTok lead form",
  source: PLATFORM_NAME,
  timestamp: asIsoString(
    getCsvValue(row, ["created_time", "Create Time", "submit_time", "Submit Time"])
  ),
  status: "NEW",
});

const fetchRecentLeads = async (env: LeadBotEnv) => {
  const taskId = await createLeadDownloadTask(env);
  if (!taskId) {
    return [];
  }

  await waitForLeadTask(env, taskId);
  const csv = await downloadLeadCsv(env, taskId);
  return sortLeadsDescending(parseCsv(csv).map(normalizeLead));
};

const getLeadCampaignId = (row: CsvRow) =>
  getCsvValue(row, ["campaign_id", "Campaign ID", "campaignid"]);

export const isTikTokConfigured = (env: LeadBotEnv) => {
  const config = readTikTokConfig(env);
  return Boolean(config.accessToken && config.advertiserId);
};

export const fetchTikTokLeadBotData = async (
  env: LeadBotEnv
): Promise<PlatformFetchResult> => {
  const campaigns = await fetchRecentCampaigns(env);
  const errors: string[] = [];
  let metricsByCampaign = new Map<string, TikTokReportRow>();
  let leads: Lead[] = [];
  let leadRows: CsvRow[] = [];

  try {
    metricsByCampaign = await fetchCampaignMetrics(env);
  } catch (error) {
    errors.push(
      error instanceof Error
        ? `Campaign metrics: ${error.message}`
        : "Campaign metrics unavailable."
    );
  }

  try {
    const taskId = await createLeadDownloadTask(env);
    if (taskId) {
      await waitForLeadTask(env, taskId);
      const csv = await downloadLeadCsv(env, taskId);
      leadRows = parseCsv(csv);
      leads = sortLeadsDescending(leadRows.map(normalizeLead));
    }
  } catch (error) {
    errors.push(
      error instanceof Error ? `Leads: ${error.message}` : "TikTok leads unavailable."
    );
  }

  const leadCountsByCampaign = new Map<string, number>();
  leadRows.forEach((row) => {
    const campaignId = getLeadCampaignId(row);
    if (!campaignId) {
      return;
    }

    leadCountsByCampaign.set(
      campaignId,
      (leadCountsByCampaign.get(campaignId) || 0) + 1
    );
  });

  const normalizedCampaigns: Campaign[] = campaigns.map((campaign) => {
    const campaignId = campaign.campaign_id || campaign.id || "";
    const metrics = metricsByCampaign.get(campaignId);
    const impressions = asNumber(metrics?.impressions);
    const clicks = asNumber(metrics?.clicks);

    return {
      id: campaignId || crypto.randomUUID(),
      platform: PLATFORM_NAME,
      content:
        campaign.campaign_name || campaign.name || campaign.objective_type || "TikTok campaign",
      timestamp: asIsoString(campaign.create_time || campaign.modify_time),
      reach: asNumber(metrics?.reach) || impressions,
      impressions,
      clicks,
      conversions: leadCountsByCampaign.get(campaignId) || 0,
      leads: leadCountsByCampaign.get(campaignId) || 0,
      engagement: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
      status: toCampaignStatus(
        campaign.secondary_status || campaign.status || campaign.operation_status,
        campaign.create_time || null
      ),
      scheduledTime: campaign.create_time || campaign.modify_time,
    };
  });

  return {
    platform: createConnectedPlatform(PLATFORM_NAME, normalizedCampaigns, leads),
    campaigns: normalizedCampaigns,
    leads,
    errors,
  };
};
