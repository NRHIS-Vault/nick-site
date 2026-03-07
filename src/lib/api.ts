import { config } from "./config";

// Shared headers for all JSON requests.
const defaultHeaders = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

// Build a URL to the Cloudflare Pages Functions host.
// If VITE_API_BASE is empty, we fall back to same-origin relative paths.
const buildUrl = (path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = config.apiBase?.trim() ?? "";
  return `${base}${normalizedPath}`;
};

export type ApiError = Error & { status?: number };

const buildError = (status: number, fallback: string, message?: string) => {
  const error = new Error(message || fallback) as ApiError;
  error.status = status;
  return error;
};

async function postJson<TPayload, TResponse>(
  path: string,
  payload: TPayload
): Promise<TResponse> {
  const response = await fetch(buildUrl(path), {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify(payload),
  });

  const asJson = await response
    .json()
    .catch(() => ({} as Record<string, unknown>));

  if (!response.ok) {
    const errorMessage =
      (typeof asJson.error === "string" && asJson.error) ||
      (typeof (asJson as Record<string, unknown>).message === "string" &&
        (asJson as Record<string, string>).message) ||
      undefined;

    throw buildError(
      response.status,
      "Something went wrong. Please try again.",
      errorMessage
    );
  }

  return asJson as TResponse;
}

export type ContactRequest = {
  name: string;
  email: string;
  message: string;
};

export type ContactResponse = {
  ok: boolean;
  message?: string;
  error?: string;
};

// Send contact form details to the contact worker.
export const submitContactForm = (payload: ContactRequest) =>
  postJson<ContactRequest, ContactResponse>("/contact", payload);

export type NewsletterRequest = {
  email: string;
};

export type NewsletterResponse = {
  ok: boolean;
  message?: string;
  error?: string;
};

// Send newsletter opt-in to the newsletter worker.
export const subscribeNewsletter = (payload: NewsletterRequest) =>
  postJson<NewsletterRequest, NewsletterResponse>("/newsletter", payload);
