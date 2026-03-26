export type JsonObject = Record<string, unknown>;

export type ChatToolContext = {
  request: Request;
  fetchJson: (endpoint: string) => Promise<JsonObject>;
};

export type ChatToolDefinition = {
  name: string;
  aliases?: string[];
  description: string;
  parameters: JsonObject;
  sourceEndpoint: string;
  execute: (args: JsonObject, context: ChatToolContext) => Promise<unknown>;
};

const isPlainObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asOptionalString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asOptionalLimit = (value: unknown, max = 25) => {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;

  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const normalized = Math.floor(numeric);
  if (normalized < 1) {
    return undefined;
  }

  return Math.min(normalized, max);
};

const includesKeyword = (value: unknown, keyword: string) =>
  typeof value === "string" ? value.toLowerCase().includes(keyword) : false;

export const searchLeads: ChatToolDefinition = {
  name: "searchLeads",
  aliases: ["get_leads"],
  description:
    "Search lead-management records from the internal dashboard API. Use this for current leads, statuses, services, lead values, and keyword searches.",
  sourceEndpoint: "/leadManagement",
  parameters: {
    type: "object",
    properties: {
      keyword: {
        type: "string",
        description:
          "Optional keyword matched against lead name, email, phone, service, location, and notes.",
      },
      status: {
        type: "string",
        enum: ["New", "Contacted", "Quoted", "Approved", "Completed"],
        description: "Optional lead status filter.",
      },
      service: {
        type: "string",
        description: "Optional service keyword filter, for example 'Privacy Fence'.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 25,
        description: "Maximum number of leads to return.",
      },
    },
    additionalProperties: false,
  },
  execute: async (args, context) => {
    const payload = await context.fetchJson(searchLeads.sourceEndpoint);
    const sourceLeads = Array.isArray(payload.leads) ? payload.leads : [];
    const keyword = asOptionalString(args.keyword)?.toLowerCase();
    const status = asOptionalString(args.status);
    const service = asOptionalString(args.service)?.toLowerCase();
    const limit = asOptionalLimit(args.limit);

    let leads = sourceLeads.filter((lead) => isPlainObject(lead));

    if (status) {
      leads = leads.filter((lead) => lead.status === status);
    }

    if (service) {
      leads = leads.filter((lead) =>
        typeof lead.service === "string"
          ? lead.service.toLowerCase().includes(service)
          : false
      );
    }

    if (keyword) {
      leads = leads.filter((lead) =>
        [
          lead.name,
          lead.email,
          lead.phone,
          lead.service,
          lead.location,
          lead.notes,
        ].some((value) => includesKeyword(value, keyword))
      );
    }

    if (limit) {
      leads = leads.slice(0, limit);
    }

    return {
      filters: {
        ...(keyword ? { keyword } : {}),
        ...(status ? { status } : {}),
        ...(service ? { service } : {}),
        ...(limit ? { limit } : {}),
      },
      count: leads.length,
      leads,
    };
  },
};

export const fetchTrades: ChatToolDefinition = {
  name: "fetchTrades",
  aliases: ["get_trades"],
  description:
    "Fetch the trading dashboard snapshot. Use this for open trades, trade status, balances, platforms, signals, and market pair filters.",
  sourceEndpoint: "/tradingBot",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["OPEN", "CLOSED", "PENDING"],
        description: "Optional trade status filter.",
      },
      pair: {
        type: "string",
        description: "Optional market pair filter, for example 'BTC/USDT'.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 25,
        description: "Maximum number of trades to return.",
      },
    },
    additionalProperties: false,
  },
  execute: async (args, context) => {
    const payload = await context.fetchJson(fetchTrades.sourceEndpoint);
    const sourceTrades = Array.isArray(payload.trades) ? payload.trades : [];
    const status = asOptionalString(args.status);
    const pair = asOptionalString(args.pair)?.toLowerCase();
    const limit = asOptionalLimit(args.limit);

    let trades = sourceTrades.filter((trade) => isPlainObject(trade));

    if (status) {
      trades = trades.filter((trade) => trade.status === status);
    }

    if (pair) {
      trades = trades.filter((trade) =>
        typeof trade.pair === "string"
          ? trade.pair.toLowerCase().includes(pair)
          : false
      );
    }

    if (limit) {
      trades = trades.slice(0, limit);
    }

    return {
      filters: {
        ...(status ? { status } : {}),
        ...(pair ? { pair } : {}),
        ...(limit ? { limit } : {}),
      },
      botStatus: payload.botStatus,
      balances: payload.balances,
      signals: payload.signals,
      platforms: payload.platforms,
      count: trades.length,
      trades,
    };
  },
};

// The registry is the only source of truth for chat tools:
// - provider metadata comes from each definition's `description` + `parameters`
// - execution routes through each definition's `execute` implementation
// - alias lookup keeps old client names working without allowing arbitrary function calls
// Looking up tools through this map is what prevents the model from invoking unauthorized code.
export const chatToolDefinitions = [searchLeads, fetchTrades];

const chatToolRegistry = new Map<string, ChatToolDefinition>(
  chatToolDefinitions.flatMap((tool) =>
    [tool.name, ...(tool.aliases ?? [])].map((name) => [name, tool] as const)
  )
);

export const resolveChatTool = (name: string) => chatToolRegistry.get(name);

export const getAllowedToolNames = () => chatToolDefinitions.map((tool) => tool.name);
