// Centralized, typed access to Vite environment variables for the client bundle.
export type AppEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  stripePublishableKey: string;
  apiBase: string;
};

const env = import.meta.env as Record<string, string | undefined>;

export const config: AppEnv = {
  // Supabase project URL; empty means auth/data features should stay inactive.
  supabaseUrl: env.VITE_SUPABASE_URL ?? "",
  // Supabase anon/public key used by the browser client.
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY ?? "",
  // Stripe publishable key for client-side Checkout/Elements.
  stripePublishableKey: env.VITE_STRIPE_PK ?? "",
  // Base URL for backend/worker API used by this app.
  apiBase: env.VITE_API_BASE ?? "",
};

// Helper to check if Supabase is configured without throwing.
export const hasSupabaseConfig = () =>
  Boolean(config.supabaseUrl && config.supabaseAnonKey);
