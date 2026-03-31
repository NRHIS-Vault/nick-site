export type CampaignStatus = "ACTIVE" | "SCHEDULED" | "COMPLETED";
export type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "CONVERTED";
export type PlatformConnectionStatus = "connected" | "pending";

export type LeadBotEnv = {
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_ACCESS_TOKEN?: string;
  META_AD_ACCOUNT_ID?: string;
  META_PAGE_ID?: string;
  INSTAGRAM_APP_ID?: string;
  INSTAGRAM_APP_SECRET?: string;
  INSTAGRAM_ACCESS_TOKEN?: string;
  INSTAGRAM_BUSINESS_ACCOUNT_ID?: string;
  INSTAGRAM_PAGE_ID?: string;
  TIKTOK_APP_ID?: string;
  TIKTOK_APP_SECRET?: string;
  TIKTOK_ACCESS_TOKEN?: string;
  TIKTOK_ADVERTISER_ID?: string;
  TIKTOK_PAGE_ID?: string;
  TIKTOK_LEAD_LOOKBACK_DAYS?: string;
};

export type Campaign = {
  id: string;
  platform: string;
  content: string;
  reach: number;
  leads: number;
  engagement: number;
  status: CampaignStatus;
  scheduledTime?: string;
};

export type Lead = {
  id: string;
  name: string;
  phone: string;
  service: string;
  source: string;
  timestamp: string;
  status: LeadStatus;
};

export type Platform = {
  name: string;
  status: PlatformConnectionStatus;
  posts: number;
  leads: number;
};

export type PlatformFetchResult = {
  platform: Platform;
  campaigns: Campaign[];
  leads: Lead[];
  errors: string[];
};

export type LeadBotResponse = {
  overview: {
    totalLeads: number;
    monthlyLeads: number;
    conversionRate: number;
    activeCampaigns: number;
  };
  campaigns: Campaign[];
  platforms: Platform[];
  recentLeads: Lead[];
  errors?: string[];
};
