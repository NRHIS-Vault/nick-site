// Centralized, typed access to Vite environment variables for the client bundle.
export type AppEnv = {
  apiBase: string;
  dashboardUrl: string;
  marketingSiteUrl: string;
  contactEmail: string;
};

const env = import.meta.env as Record<string, string | undefined>;

export const config: AppEnv = {
  // Base URL for backend/worker API used by this app.
  apiBase: env.VITE_API_BASE ?? "",
  // Canonical dashboard URL linked from the marketing site.
  dashboardUrl: env.VITE_DASHBOARD_URL ?? "https://dashboard.nick-ai.link",
  // Canonical marketing-site URL used in contact and support copy.
  marketingSiteUrl: env.VITE_MARKETING_SITE_URL ?? "https://nick-ai.link",
  // Public contact address shown on the landing page.
  contactEmail: env.VITE_CONTACT_EMAIL ?? "contact@nick-ai.link",
};
