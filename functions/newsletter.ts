// Cloudflare Pages Function: handle newsletter sign-ups.
// Accepts POST requests with a JSON body containing an email address.
// Logs submissions for now and returns a JSON acknowledgement.

type NewsletterPayload = {
  email: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

export const onRequestOptions = () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

export const onRequestPost = async ({ request }: { request: Request }) => {
  let payload: Partial<NewsletterPayload>;

  try {
    payload = await request.json();
  } catch (_error) {
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { email } = payload;

  if (!email) {
    return jsonResponse({ ok: false, error: "Email is required" }, 400);
  }

  // Log for now; swap this out with your ESP/CRM (e.g., Mailchimp, Postmark).
  console.log("Newsletter sign-up received", { email });

  return jsonResponse({
    ok: true,
    message: "Thanks for subscribing. You're on the list!",
  });
};
