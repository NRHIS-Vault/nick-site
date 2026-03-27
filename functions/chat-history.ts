import {
  ChatPersistenceError,
  listConversationsWithMessages,
  requireAuthenticatedChatUser,
  type ChatPersistenceEnv,
} from "./chat/persistence";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
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

export const onRequestGet = async ({
  request,
  env,
}: {
  request: Request;
  env: ChatPersistenceEnv;
}) => {
  try {
    // Chat history is user-specific, so this endpoint always requires a valid
    // Supabase bearer token before it returns any conversations. The response
    // groups message rows under each conversation so the frontend can hydrate
    // a previous session in one request.
    const { supabase, user } = await requireAuthenticatedChatUser(request, env);
    const conversations = await listConversationsWithMessages({
      supabase,
      user,
    });

    return jsonResponse({ conversations });
  } catch (error) {
    if (error instanceof ChatPersistenceError) {
      return jsonResponse({ ok: false, error: error.message }, error.status);
    }

    console.error("Failed to load chat history", error);
    return jsonResponse(
      { ok: false, error: "Unable to load chat history right now." },
      500
    );
  }
};
