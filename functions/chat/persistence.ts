import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

// Shared chat persistence helpers live here so both `/chat` and `/chat-history`
// reuse the same Supabase auth and query logic. The worker authenticates the
// caller with their bearer token first, then uses the server-side Supabase key
// to perform inserts/selects scoped to that validated user id.

export type ChatPersistenceEnv = {
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
};

export type ConversationRecord = {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatMessageRecord = {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type ConversationWithMessages = ConversationRecord & {
  messages: ChatMessageRecord[];
};

export class ChatPersistenceError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ChatPersistenceError";
    this.status = status;
  }
}

const BEARER_TOKEN_PATTERN = /^Bearer\s+(.+)$/i;

const trimToNull = (value: string | undefined) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const createSupabaseServerClient = (env: ChatPersistenceEnv): SupabaseClient => {
  const supabaseUrl = trimToNull(env.SUPABASE_URL);
  const supabaseKey = trimToNull(env.SUPABASE_KEY);

  if (!supabaseUrl || !supabaseKey) {
    throw new ChatPersistenceError(
      500,
      "Server misconfigured: missing Supabase secrets for chat persistence."
    );
  }

  return createClient(supabaseUrl, supabaseKey, {
    global: {
      fetch: (input, init) => fetch(input, init),
    },
  });
};

const getBearerToken = (request: Request) => {
  const authorizationHeader =
    request.headers.get("Authorization") || request.headers.get("authorization");

  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(BEARER_TOKEN_PATTERN);
  return match?.[1]?.trim() || null;
};

const normalizeConversationTitle = (content: string) => {
  const trimmed = content.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 80) : null;
};

const toPersistenceError = (error: unknown, fallbackMessage: string) =>
  error instanceof ChatPersistenceError
    ? error
    : new ChatPersistenceError(
        500,
        error instanceof Error && error.message ? error.message : fallbackMessage
      );

export const getOptionalAuthenticatedChatUser = async (
  request: Request,
  env: ChatPersistenceEnv
) => {
  // `/chat` allows anonymous streaming, so auth is optional there. If no bearer
  // token is present we simply skip persistence instead of rejecting the request.
  const token = getBearerToken(request);
  if (!token) {
    return null;
  }

  const supabase = createSupabaseServerClient(env);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new ChatPersistenceError(401, "Invalid or expired Supabase access token.");
  }

  return {
    supabase,
    user: data.user,
  };
};

export const requireAuthenticatedChatUser = async (
  request: Request,
  env: ChatPersistenceEnv
) => {
  const token = getBearerToken(request);
  if (!token) {
    throw new ChatPersistenceError(401, "Missing Authorization bearer token.");
  }

  const authenticatedUser = await getOptionalAuthenticatedChatUser(request, env);
  if (!authenticatedUser) {
    throw new ChatPersistenceError(401, "Missing Authorization bearer token.");
  }

  return authenticatedUser;
};

export const ensureConversation = async ({
  supabase,
  conversationId,
  userId,
  title,
}: {
  supabase: SupabaseClient;
  conversationId: string;
  userId: string;
  title: string | null;
}) => {
  try {
    // Reuse the supplied conversation id when it already exists for this user.
    // This lets the frontend keep appending to the same chat session across requests.
    const { data: existingConversation, error: existingConversationError } =
      await supabase
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .maybeSingle();

    if (existingConversationError) {
      throw existingConversationError;
    }

    if (existingConversation) {
      if (existingConversation.user_id !== userId) {
        throw new ChatPersistenceError(
          403,
          "Conversation does not belong to the current user."
        );
      }

      return {
        conversation: existingConversation as ConversationRecord,
        wasCreated: false,
      };
    }

    const { data: createdConversation, error: createConversationError } = await supabase
      .from("conversations")
      .insert({
        id: conversationId,
        user_id: userId,
        title,
      })
      .select("*")
      .single();

    if (createConversationError) {
      throw createConversationError;
    }

    return {
      conversation: createdConversation as ConversationRecord,
      wasCreated: true,
    };
  } catch (error) {
    throw toPersistenceError(error, "Unable to create or load the conversation.");
  }
};

export const persistChatMessage = async ({
  supabase,
  conversationId,
  userId,
  role,
  content,
}: {
  supabase: SupabaseClient;
  conversationId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
}) => {
  try {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      return null;
    }

    // Each completed user/assistant turn is stored as its own row so chat history
    // can be replayed later without reconstructing content from a single blob.
    const { data: createdMessage, error: createMessageError } = await supabase
      .from("chat_messages")
      .insert({
        conversation_id: conversationId,
        user_id: userId,
        role,
        content: trimmedContent,
      })
      .select("*")
      .single();

    if (createMessageError) {
      throw createMessageError;
    }

    const { error: updateConversationError } = await supabase
      .from("conversations")
      .update({
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .eq("user_id", userId);

    if (updateConversationError) {
      throw updateConversationError;
    }

    return createdMessage as ChatMessageRecord;
  } catch (error) {
    throw toPersistenceError(error, "Unable to persist the chat message.");
  }
};

export const listConversationsWithMessages = async ({
  supabase,
  user,
}: {
  supabase: SupabaseClient;
  user: User;
}) => {
  try {
    // Load the conversation shells first so we can preserve conversation ordering
    // by `updated_at`, then hydrate each shell with its ordered message rows.
    const { data: conversations, error: conversationsError } = await supabase
      .from("conversations")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (conversationsError) {
      throw conversationsError;
    }

    const normalizedConversations = (conversations ?? []) as ConversationRecord[];
    if (!normalizedConversations.length) {
      return [];
    }

    const conversationIds = normalizedConversations.map(
      (conversation) => conversation.id
    );

    const { data: messages, error: messagesError } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("user_id", user.id)
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: true });

    if (messagesError) {
      throw messagesError;
    }

    const messagesByConversation = new Map<string, ChatMessageRecord[]>();
    for (const message of (messages ?? []) as ChatMessageRecord[]) {
      const conversationMessages =
        messagesByConversation.get(message.conversation_id) ?? [];
      conversationMessages.push(message);
      messagesByConversation.set(message.conversation_id, conversationMessages);
    }

    return normalizedConversations.map((conversation) => ({
      ...conversation,
      messages: messagesByConversation.get(conversation.id) ?? [],
    })) as ConversationWithMessages[];
  } catch (error) {
    throw toPersistenceError(error, "Unable to load chat history.");
  }
};

export const getConversationTitleFromUserMessage = (content: string) =>
  normalizeConversationTitle(content);
