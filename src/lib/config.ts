// Centralized, typed access to Vite environment variables for the client bundle.
export type AppEnv = {
  apiBase: string;
};

const env = import.meta.env as Record<string, string | undefined>;

export const config: AppEnv = {
  // Base URL for backend/worker API used by this app.
  apiBase: env.VITE_API_BASE ?? "",
};
