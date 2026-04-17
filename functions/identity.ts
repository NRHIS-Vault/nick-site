import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export type IdentityServiceEnv = {
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
};

type IdentityIcon = "fingerprint" | "eye" | "radio" | "shield";

type RhnisProfileRow = {
  id: string;
  profile_id?: string | null;
  beacon_signature?: string | null;
  legacy_stats?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
};

type RhnisIdentityFeatureRow = {
  icon?: string | null;
  title?: string | null;
  status?: string | null;
  description?: string | null;
  created_at?: string | null;
};

type RhnisBeaconDatumRow = {
  beacon_type?: string | null;
  count?: number | null;
  status?: string | null;
  created_at?: string | null;
};

type LegacyStatsRecord = {
  voiceRecordingsMb: number;
  interactionLogsMb: number;
  digitalSignaturesMb: number;
  totalStorageMb: number;
};

type LegacyDetail = {
  id: string;
  label: string;
  sizeMb: number;
  status: string;
  description: string;
};

export class IdentityServiceError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "IdentityServiceError";
    this.status = status;
    this.code = code;
  }
}

const BEARER_TOKEN_PATTERN = /^Bearer\s+(.+)$/i;
const OPERATIONAL_STATUS_PATTERN =
  /(active|armed|available|broadcasting|propagating|ready|spreading|synced|tracking)/i;
const identityIcons = new Set<IdentityIcon>(["fingerprint", "eye", "radio", "shield"]);

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

const trimToNull = (value: string | undefined | null) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const readTrimmedString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readFiniteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const createSupabaseServerClient = (env: IdentityServiceEnv): SupabaseClient => {
  const supabaseUrl = trimToNull(env.SUPABASE_URL);
  const supabaseKey = trimToNull(env.SUPABASE_KEY);

  if (!supabaseUrl || !supabaseKey) {
    throw new IdentityServiceError(
      500,
      "IDENTITY_SERVICE_MISCONFIGURED",
      "Server misconfigured: missing Supabase secrets for identity service."
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

const requireAuthenticatedUser = async (
  request: Request,
  supabase: SupabaseClient
): Promise<User> => {
  const token = getBearerToken(request);
  if (!token) {
    throw new IdentityServiceError(
      401,
      "IDENTITY_AUTH_REQUIRED",
      "Missing Authorization bearer token."
    );
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new IdentityServiceError(
      401,
      "IDENTITY_AUTH_INVALID",
      "Invalid or expired Supabase access token."
    );
  }

  return data.user;
};

const readLegacyNumber = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = readFiniteNumber(record[key]);
    if (value !== null) {
      return value;
    }
  }

  return 0;
};

const parseLegacyStats = (value: unknown) => {
  const record = isRecord(value) ? value : {};

  const voiceRecordingsMb = readLegacyNumber(record, [
    "voiceRecordingsMb",
    "voice_recordings_mb",
    "voiceRecordings",
    "voice_recordings",
  ]);
  const interactionLogsMb = readLegacyNumber(record, [
    "interactionLogsMb",
    "interaction_logs_mb",
    "interactionLogs",
    "interaction_logs",
  ]);
  const digitalSignaturesMb = readLegacyNumber(record, [
    "digitalSignaturesMb",
    "digital_signatures_mb",
    "digitalSignatures",
    "digital_signatures",
  ]);

  return {
    stats: {
      voiceRecordingsMb,
      interactionLogsMb,
      digitalSignaturesMb,
      totalStorageMb: voiceRecordingsMb + interactionLogsMb + digitalSignaturesMb,
    } satisfies LegacyStatsRecord,
    notes: Array.isArray(record.notes)
      ? record.notes.map(readTrimmedString).filter((note): note is string => Boolean(note))
      : [],
  };
};

const buildLegacyDetails = (legacyStats: LegacyStatsRecord): LegacyDetail[] => [
  {
    id: "voice-recordings",
    label: "Voice Recordings",
    sizeMb: legacyStats.voiceRecordingsMb,
    status: legacyStats.voiceRecordingsMb > 0 ? "Available" : "Pending",
    description: "Stored audio archives and voiceprint capture used by the identity system.",
  },
  {
    id: "interaction-logs",
    label: "Interaction Logs",
    sizeMb: legacyStats.interactionLogsMb,
    status: legacyStats.interactionLogsMb > 0 ? "Available" : "Pending",
    description: "Conversation and interaction history retained for longitudinal identity review.",
  },
  {
    id: "digital-signatures",
    label: "Digital Signatures",
    sizeMb: legacyStats.digitalSignaturesMb,
    status: legacyStats.digitalSignaturesMb > 0 ? "Available" : "Pending",
    description: "Cryptographic or derived signature artifacts attached to the RHNIS profile.",
  },
];

const isOperationalStatus = (status: string | null) =>
  typeof status === "string" && OPERATIONAL_STATUS_PATTERN.test(status);

const parseIdentityIcon = (value: unknown): IdentityIcon | null => {
  const icon = readTrimmedString(value);
  return icon && identityIcons.has(icon as IdentityIcon) ? (icon as IdentityIcon) : null;
};

const getProfileRow = async (supabase: SupabaseClient, userId: string) => {
  const { data, error } = await supabase
    .from("rhnis_profiles")
    .select("id, profile_id, beacon_signature, legacy_stats, created_at, updated_at")
    .eq("profile_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new IdentityServiceError(
      500,
      "IDENTITY_PROFILE_LOOKUP_FAILED",
      "Unable to load the RHNIS identity profile."
    );
  }

  return ((data as RhnisProfileRow[] | null) ?? [])[0] ?? null;
};

const getIdentityFeatureRows = async (supabase: SupabaseClient, profileId: string) => {
  const { data, error } = await supabase
    .from("rhnis_identity_features")
    .select("icon, title, status, description, created_at")
    .eq("rhnis_profile_id", profileId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new IdentityServiceError(
      500,
      "IDENTITY_FEATURE_LOOKUP_FAILED",
      "Unable to load identity feature data."
    );
  }

  return (data as RhnisIdentityFeatureRow[] | null) ?? [];
};

const getBeaconRows = async (supabase: SupabaseClient, profileId: string) => {
  const { data, error } = await supabase
    .from("rhnis_beacon_data")
    .select("beacon_type, count, status, created_at")
    .eq("rhnis_profile_id", profileId)
    .order("count", { ascending: false });

  if (error) {
    throw new IdentityServiceError(
      500,
      "IDENTITY_BEACON_LOOKUP_FAILED",
      "Unable to load beacon propagation data."
    );
  }

  return (data as RhnisBeaconDatumRow[] | null) ?? [];
};

const buildEmptyPayload = (userId: string) => ({
  source: "supabase" as const,
  computedAt: new Date().toISOString(),
  userId,
  profileId: null,
  hasProfile: false,
  identity: {
    summary: {
      totalFeatures: 0,
      activeFeatures: 0,
      lastUpdatedAt: null,
    },
    features: [],
  },
  beacon: {
    summary: {
      signature: null,
      totalSignals: 0,
      activeStreams: 0,
      recordTypes: 0,
      lastUpdatedAt: null,
    },
    data: [],
  },
  legacy: {
    stats: {
      voiceRecordingsMb: 0,
      interactionLogsMb: 0,
      digitalSignaturesMb: 0,
      totalStorageMb: 0,
    },
    details: buildLegacyDetails({
      voiceRecordingsMb: 0,
      interactionLogsMb: 0,
      digitalSignaturesMb: 0,
      totalStorageMb: 0,
    }),
    notes: [],
    profileCreatedAt: null,
    lastUpdatedAt: null,
  },
});

const buildPayload = ({
  userId,
  profile,
  featureRows,
  beaconRows,
}: {
  userId: string;
  profile: RhnisProfileRow;
  featureRows: RhnisIdentityFeatureRow[];
  beaconRows: RhnisBeaconDatumRow[];
}) => {
  const legacy = parseLegacyStats(profile.legacy_stats);
  const identityFeatures = featureRows
    .map((feature) => {
      const icon = parseIdentityIcon(feature.icon);
      const title = readTrimmedString(feature.title);
      const status = readTrimmedString(feature.status);
      const description = readTrimmedString(feature.description);

      if (!icon || !title || !status || !description) {
        return null;
      }

      return {
        icon,
        title,
        status,
        description,
        createdAt: readTrimmedString(feature.created_at),
      };
    })
    .filter((feature): feature is NonNullable<typeof feature> => Boolean(feature));

  const beaconData = beaconRows
    .map((row) => {
      const type = readTrimmedString(row.beacon_type);
      const status = readTrimmedString(row.status);

      if (!type || !status) {
        return null;
      }

      return {
        type,
        count: readFiniteNumber(row.count) ?? 0,
        status,
        createdAt: readTrimmedString(row.created_at),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  return {
    source: "supabase" as const,
    computedAt: new Date().toISOString(),
    userId,
    profileId: profile.id,
    hasProfile: true,
    identity: {
      summary: {
        totalFeatures: identityFeatures.length,
        activeFeatures: identityFeatures.filter((feature) =>
          isOperationalStatus(feature.status)
        ).length,
        lastUpdatedAt: readTrimmedString(profile.updated_at),
      },
      features: identityFeatures,
    },
    beacon: {
      summary: {
        signature: readTrimmedString(profile.beacon_signature),
        totalSignals: beaconData.reduce((total, row) => total + row.count, 0),
        activeStreams: beaconData.filter((row) => isOperationalStatus(row.status)).length,
        recordTypes: beaconData.length,
        lastUpdatedAt: readTrimmedString(profile.updated_at),
      },
      data: beaconData,
    },
    legacy: {
      stats: legacy.stats,
      details: buildLegacyDetails(legacy.stats),
      notes: legacy.notes,
      profileCreatedAt: readTrimmedString(profile.created_at),
      lastUpdatedAt: readTrimmedString(profile.updated_at),
    },
  };
};

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
  env: IdentityServiceEnv;
}) => {
  try {
    // The RHNIS payload is user-scoped, so the worker resolves the current user from the
    // Supabase access token before it touches any identity tables.
    const supabase = createSupabaseServerClient(env);
    const user = await requireAuthenticatedUser(request, supabase);
    const profile = await getProfileRow(supabase, user.id);

    if (!profile) {
      return jsonResponse(buildEmptyPayload(user.id));
    }

    const [featureRows, beaconRows] = await Promise.all([
      getIdentityFeatureRows(supabase, profile.id),
      getBeaconRows(supabase, profile.id),
    ]);

    return jsonResponse(
      buildPayload({
        userId: user.id,
        profile,
        featureRows,
        beaconRows,
      })
    );
  } catch (error) {
    if (error instanceof IdentityServiceError) {
      return jsonResponse(
        {
          ok: false,
          code: error.code,
          error: error.message,
        },
        error.status
      );
    }

    console.error("Failed to load identity data", error);
    return jsonResponse(
      {
        ok: false,
        error: "Unable to load identity data right now.",
      },
      500
    );
  }
};
