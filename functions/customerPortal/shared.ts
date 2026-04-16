import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type CustomerPortalEnv = Record<string, string | undefined> & {
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  CUSTOMER_PORTAL_PLANS_TABLE?: string;
  CUSTOMER_PORTAL_SUBSCRIPTIONS_TABLE?: string;
};

export type PortalDataSource = "supabase" | "stripe" | "stub" | "mixed";
export type BillingInterval = "day" | "week" | "month" | "year";
export type PortalSubscriberStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "paused"
  | "cancelled"
  | "unpaid"
  | "incomplete";

export type PortalPlan = {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  billingInterval: BillingInterval;
  billingIntervalCount: number;
  billingPeriodLabel: string;
  monthlyPriceEquivalent: number;
  features: string[];
  popular: boolean;
  roi: string;
};

export type PortalSubscriptionItem = {
  planId: string | null;
  planName: string;
  quantity: number;
  amount: number;
  currency: string;
  billingInterval: BillingInterval;
  billingIntervalCount: number;
  monthlyRecurringRevenue: number;
};

export type PortalSubscriber = {
  id: string;
  name: string;
  email: string;
  planId: string | null;
  planName: string;
  joinDate: string;
  status: PortalSubscriberStatus;
  amount: number;
  currency: string;
  quantity: number;
  billingInterval: BillingInterval;
  billingIntervalCount: number;
  monthlyRecurringRevenue: number;
  items: PortalSubscriptionItem[];
};

export type CustomerPortalPlansPayload = {
  source: PortalDataSource;
  updatedAt: string;
  plans: PortalPlan[];
};

export type CustomerPortalAnalyticsPayload = {
  source: PortalDataSource;
  computedAt: string;
  overview: {
    activeSubscribers: number;
    totalSubscribers: number;
    mrr: number;
    arr: number;
    averageRevenuePerActiveSubscriber: number;
    trialSubscribers: number;
    atRiskSubscribers: number;
  };
  statusBreakdown: Array<{
    status: PortalSubscriberStatus;
    count: number;
  }>;
  planBreakdown: Array<{
    planId: string;
    planName: string;
    activeSubscribers: number;
    mrr: number;
    averageMrr: number;
  }>;
  monthlySeries: Array<{
    month: string;
    label: string;
    newSubscribers: number;
    newMrr: number;
  }>;
  subscribers: PortalSubscriber[];
  notes: string[];
};

const DEFAULT_PLANS_TABLE = "subscription_plans";
const DEFAULT_SUBSCRIPTIONS_TABLE = "subscriptions";
const ACTIVE_SUBSCRIBER_STATUSES = new Set<PortalSubscriberStatus>([
  "active",
  "trialing",
  "past_due",
]);
const AT_RISK_STATUSES = new Set<PortalSubscriberStatus>(["past_due", "unpaid"]);
const DEFAULT_CURRENCY = "usd";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept",
};

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });

export const optionsResponse = () =>
  new Response(null, {
    status: 204,
    headers: corsHeaders,
  });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const readBoolean = (value: unknown) => {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = readString(value)?.toLowerCase();
  if (!normalized) {
    return null;
  }

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return null;
};

const readPositiveInteger = (value: unknown) => {
  const parsed = readNumber(value);
  if (parsed === null) {
    return null;
  }

  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : null;
};

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

const formatMonthLabel = (date: Date) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(date);

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "subscription";

const trimToNull = (value: string | undefined | null) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const toIsoString = (value: unknown, fallback = new Date().toISOString()) => {
  const raw = readString(value);
  if (raw) {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return fallback;
};

const parseFeatureList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => readString(item))
      .filter((item): item is string => Boolean(item));
  }

  const raw = readString(value);
  if (!raw) {
    return [];
  }

  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => readString(item))
          .filter((item): item is string => Boolean(item));
      }
    } catch (_error) {
      // Fall back to delimiter parsing below when metadata is not valid JSON.
    }
  }

  return raw
    .split(/\r?\n|[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeCurrency = (value: unknown) =>
  readString(value)?.toLowerCase() || DEFAULT_CURRENCY;

const normalizeInterval = (value: unknown): BillingInterval => {
  const normalized = readString(value)?.toLowerCase();

  if (normalized === "day" || normalized === "week" || normalized === "month" || normalized === "year") {
    return normalized;
  }

  if (normalized === "monthly") {
    return "month";
  }

  if (normalized === "yearly" || normalized === "annual") {
    return "year";
  }

  return "month";
};

const buildBillingPeriodLabel = (
  billingInterval: BillingInterval,
  billingIntervalCount: number
) => {
  const intervalCount = Math.max(1, billingIntervalCount);
  if (intervalCount === 1) {
    return billingInterval;
  }

  return `${intervalCount} ${billingInterval}s`;
};

export const computeMonthlyRecurringRevenue = ({
  amount,
  billingInterval,
  billingIntervalCount = 1,
  quantity = 1,
}: {
  amount: number;
  billingInterval: BillingInterval;
  billingIntervalCount?: number;
  quantity?: number;
}) => {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const safeCount = Math.max(1, billingIntervalCount);
  const total = safeAmount * Math.max(1, quantity);

  switch (billingInterval) {
    case "day":
      return roundCurrency((total * 30.4375) / safeCount);
    case "week":
      return roundCurrency((total * 52) / 12 / safeCount);
    case "year":
      return roundCurrency(total / 12 / safeCount);
    case "month":
    default:
      return roundCurrency(total / safeCount);
  }
};

const normalizeSubscriberStatus = (value: unknown): PortalSubscriberStatus => {
  const normalized = readString(value)?.toLowerCase();

  switch (normalized) {
    case "trialing":
    case "past_due":
    case "paused":
    case "unpaid":
    case "incomplete":
      return normalized;
    case "canceled":
    case "cancelled":
    case "inactive":
      return "cancelled";
    case "active":
      return "active";
    default:
      return "active";
  }
};

export const isActiveSubscriberStatus = (status: PortalSubscriberStatus) =>
  ACTIVE_SUBSCRIBER_STATUSES.has(status);

const getPlanTableName = (env: CustomerPortalEnv) =>
  trimToNull(env.CUSTOMER_PORTAL_PLANS_TABLE) || DEFAULT_PLANS_TABLE;

const getSubscriptionsTableName = (env: CustomerPortalEnv) =>
  trimToNull(env.CUSTOMER_PORTAL_SUBSCRIPTIONS_TABLE) || DEFAULT_SUBSCRIPTIONS_TABLE;

const hasSupabaseConfig = (env: CustomerPortalEnv) =>
  Boolean(trimToNull(env.SUPABASE_URL) && trimToNull(env.SUPABASE_KEY));

const hasStripeConfig = (env: CustomerPortalEnv) => Boolean(trimToNull(env.STRIPE_SECRET_KEY));

const createSupabaseServerClient = (env: CustomerPortalEnv): SupabaseClient => {
  const supabaseUrl = trimToNull(env.SUPABASE_URL);
  const supabaseKey = trimToNull(env.SUPABASE_KEY);

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Server misconfigured: missing Supabase secrets for the customer portal.");
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: (input, init) => fetch(input, init),
    },
  });
};

const readNestedRecord = (parent: unknown, key: string) => {
  const record = asRecord(parent);
  return record ? asRecord(record[key]) : null;
};

const readMajorAmount = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = readNumber(row[key]);
    if (value !== null) {
      return roundCurrency(value);
    }
  }

  return null;
};

const readMinorAmount = (row: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = readNumber(row[key]);
    if (value !== null) {
      return roundCurrency(value / 100);
    }
  }

  return null;
};

const derivePlanPrice = (row: Record<string, unknown>) =>
  readMajorAmount(row, ["price", "price_amount", "amount", "monthly_price"]) ??
  readMinorAmount(row, ["price_cents", "price_amount_cents", "unit_amount", "amount_cents"]) ??
  0;

const deriveSubscriptionCycleAmount = (
  row: Record<string, unknown>,
  quantity: number
) => {
  const explicitTotal =
    readMajorAmount(row, ["total_amount", "amount", "price_amount", "recurring_amount"]) ??
    readMinorAmount(row, ["total_amount_cents", "amount_cents"]);

  if (explicitTotal !== null) {
    return explicitTotal;
  }

  const unitAmount =
    readMajorAmount(row, ["unit_price", "unit_amount_value"]) ??
    readMinorAmount(row, ["unit_amount", "unit_amount_cents"]);

  return roundCurrency((unitAmount ?? 0) * Math.max(1, quantity));
};

const mapSupabasePlan = (row: Record<string, unknown>): PortalPlan | null => {
  const name = readString(row.name) ?? readString(row.plan_name) ?? readString(row.title);
  if (!name) {
    return null;
  }

  const billingInterval = normalizeInterval(
    row.billing_interval ?? row.interval ?? row.period
  );
  const billingIntervalCount =
    readPositiveInteger(row.billing_interval_count ?? row.interval_count) ?? 1;
  const price = derivePlanPrice(row);

  return {
    id:
      readString(row.id) ??
      readString(row.plan_id) ??
      readString(row.stripe_product_id) ??
      slugify(name),
    name,
    description: readString(row.description) ?? "Subscription plan",
    price,
    currency: normalizeCurrency(row.currency),
    billingInterval,
    billingIntervalCount,
    billingPeriodLabel: buildBillingPeriodLabel(billingInterval, billingIntervalCount),
    monthlyPriceEquivalent: computeMonthlyRecurringRevenue({
      amount: price,
      billingInterval,
      billingIntervalCount,
    }),
    features: parseFeatureList(row.features ?? row.feature_list ?? row.metadata_features),
    popular: readBoolean(row.popular ?? row.is_popular) ?? false,
    roi: readString(row.roi) ?? readString(row.expected_roi) ?? "Usage based",
  };
};

const mapStripePlan = (product: Record<string, unknown>): PortalPlan | null => {
  const name = readString(product.name);
  if (!name) {
    return null;
  }

  const metadata = asRecord(product.metadata) ?? {};
  const defaultPrice = readNestedRecord(product, "default_price");
  const recurring = readNestedRecord(defaultPrice, "recurring");
  const billingInterval = normalizeInterval(recurring?.interval);
  const billingIntervalCount = readPositiveInteger(recurring?.interval_count) ?? 1;
  const price = roundCurrency((readNumber(defaultPrice?.unit_amount) ?? 0) / 100);

  return {
    id: readString(product.id) ?? slugify(name),
    name,
    description: readString(product.description) ?? "Stripe product",
    price,
    currency: normalizeCurrency(defaultPrice?.currency),
    billingInterval,
    billingIntervalCount,
    billingPeriodLabel: buildBillingPeriodLabel(billingInterval, billingIntervalCount),
    monthlyPriceEquivalent: computeMonthlyRecurringRevenue({
      amount: price,
      billingInterval,
      billingIntervalCount,
    }),
    features: parseFeatureList(metadata.features),
    popular: readBoolean(metadata.popular) ?? false,
    roi: readString(metadata.roi) ?? "Subscription value",
  };
};

const mapSupabaseSubscription = (row: Record<string, unknown>): PortalSubscriber | null => {
  const planName =
    readString(row.plan_name) ??
    readString(row.service_name) ??
    readString(row.product_name) ??
    "Subscription";
  const quantity = readPositiveInteger(row.quantity) ?? 1;
  const billingInterval = normalizeInterval(
    row.billing_interval ?? row.interval ?? row.period
  );
  const billingIntervalCount =
    readPositiveInteger(row.billing_interval_count ?? row.interval_count) ?? 1;
  const cycleAmount = deriveSubscriptionCycleAmount(row, quantity);
  const monthlyRecurringRevenue =
    readMajorAmount(row, ["monthly_recurring_revenue", "mrr"]) ??
    computeMonthlyRecurringRevenue({
      amount: cycleAmount,
      billingInterval,
      billingIntervalCount,
    });
  const normalizedJoinDate =
    row.join_date ??
    row.started_at ??
    row.created_at ??
    row.current_period_start;

  return {
    id:
      readString(row.id) ??
      readString(row.subscription_id) ??
      `${slugify(planName)}-${readString(row.customer_email) ?? crypto.randomUUID()}`,
    name:
      readString(row.customer_name) ??
      readString(row.name) ??
      readString(row.customer) ??
      "Subscriber",
    email:
      readString(row.customer_email) ??
      readString(row.email) ??
      "unknown@example.com",
    planId:
      readString(row.plan_id) ??
      readString(row.product_id) ??
      readString(row.price_id) ??
      slugify(planName),
    planName,
    joinDate: toIsoString(normalizedJoinDate),
    status: normalizeSubscriberStatus(row.status),
    amount: cycleAmount,
    currency: normalizeCurrency(row.currency),
    quantity,
    billingInterval,
    billingIntervalCount,
    monthlyRecurringRevenue: roundCurrency(monthlyRecurringRevenue),
    items: [
      {
        planId:
          readString(row.plan_id) ??
          readString(row.product_id) ??
          readString(row.price_id) ??
          slugify(planName),
        planName,
        quantity,
        amount: cycleAmount,
        currency: normalizeCurrency(row.currency),
        billingInterval,
        billingIntervalCount,
        monthlyRecurringRevenue: roundCurrency(monthlyRecurringRevenue),
      },
    ],
  };
};

const mapStripeSubscription = (
  subscription: Record<string, unknown>
): PortalSubscriber | null => {
  const itemsRecord = readNestedRecord(subscription, "items");
  const rawItems = Array.isArray(itemsRecord?.data) ? itemsRecord.data : [];

  const items = rawItems
    .map((entry) => {
      const item = asRecord(entry);
      if (!item) {
        return null;
      }

      const price = readNestedRecord(item, "price");
      const product = readNestedRecord(price, "product");
      const recurring = readNestedRecord(price, "recurring");
      const billingInterval = normalizeInterval(recurring?.interval);
      const billingIntervalCount = readPositiveInteger(recurring?.interval_count) ?? 1;
      const quantity = readPositiveInteger(item.quantity) ?? 1;
      const amount = roundCurrency((readNumber(price?.unit_amount) ?? 0) / 100);
      const monthlyRecurringRevenue = computeMonthlyRecurringRevenue({
        amount,
        billingInterval,
        billingIntervalCount,
        quantity,
      });

      return {
        planId: readString(product?.id) ?? readString(price?.id) ?? null,
        planName:
          readString(product?.name) ??
          readString(price?.nickname) ??
          "Subscription",
        quantity,
        amount: roundCurrency(amount * quantity),
        currency: normalizeCurrency(price?.currency),
        billingInterval,
        billingIntervalCount,
        monthlyRecurringRevenue,
      } satisfies PortalSubscriptionItem;
    })
    .filter((item): item is PortalSubscriptionItem => Boolean(item));

  if (!items.length) {
    return null;
  }

  const customer = readNestedRecord(subscription, "customer");
  const joinedPlanName = items.map((item) => item.planName).join(", ");
  const totalAmount = roundCurrency(items.reduce((sum, item) => sum + item.amount, 0));
  const totalMrr = roundCurrency(
    items.reduce((sum, item) => sum + item.monthlyRecurringRevenue, 0)
  );

  return {
    id: readString(subscription.id) ?? crypto.randomUUID(),
    name:
      readString(customer?.name) ??
      readString(subscription.description) ??
      "Stripe subscriber",
    email:
      readString(customer?.email) ??
      readString(subscription.customer_email) ??
      "unknown@example.com",
    planId: items[0]?.planId ?? null,
    planName: joinedPlanName,
    joinDate: new Date(
      ((readNumber(subscription.start_date) ??
        readNumber(subscription.created) ??
        Math.floor(Date.now() / 1000)) as number) * 1000
    ).toISOString(),
    status: normalizeSubscriberStatus(subscription.status),
    amount: totalAmount,
    currency: items[0]?.currency ?? DEFAULT_CURRENCY,
    quantity: items.reduce((sum, item) => sum + item.quantity, 0),
    billingInterval: items[0]?.billingInterval ?? "month",
    billingIntervalCount: items[0]?.billingIntervalCount ?? 1,
    monthlyRecurringRevenue: totalMrr,
    items,
  };
};

const fetchStripeCollection = async (
  env: CustomerPortalEnv,
  path: string,
  params: Record<string, string> = {},
  expand: string[] = []
) => {
  const stripeSecret = trimToNull(env.STRIPE_SECRET_KEY);
  if (!stripeSecret) {
    throw new Error("Stripe secret key is not configured.");
  }

  const items: Record<string, unknown>[] = [];
  let startingAfter: string | null = null;

  while (true) {
    const searchParams = new URLSearchParams({
      limit: "100",
      ...params,
    });

    if (startingAfter) {
      searchParams.set("starting_after", startingAfter);
    }

    for (const expandKey of expand) {
      searchParams.append("expand[]", expandKey);
    }

    const response = await fetch(`https://api.stripe.com/v1${path}?${searchParams.toString()}`, {
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
      },
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(
        `Stripe request failed (${response.status} ${response.statusText})${details ? `: ${details}` : ""}`
      );
    }

    const payload = (await response.json()) as {
      data?: unknown[];
      has_more?: boolean;
    };
    const data = Array.isArray(payload.data)
      ? payload.data
          .map((entry) => asRecord(entry))
          .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      : [];

    items.push(...data);

    if (!payload.has_more || !data.length) {
      break;
    }

    startingAfter = readString(data[data.length - 1]?.id);
    if (!startingAfter) {
      break;
    }
  }

  return items;
};

const sortPlans = (plans: PortalPlan[]) =>
  [...plans].sort((left, right) => {
    if (left.popular !== right.popular) {
      return left.popular ? -1 : 1;
    }

    return left.price - right.price;
  });

const sortSubscribers = (subscribers: PortalSubscriber[]) =>
  [...subscribers].sort(
    (left, right) => Date.parse(right.joinDate) - Date.parse(left.joinDate)
  );

const buildStubPlans = (): PortalPlan[] => {
  const plans: PortalPlan[] = [
    {
      id: "ai-trading-signals",
      name: "AI Trading Signals",
      description: "Recurring trading ideas with automated monitoring and mobile alerts.",
      price: 97,
      currency: "usd",
      billingInterval: "month",
      billingIntervalCount: 1,
      billingPeriodLabel: "month",
      monthlyPriceEquivalent: 97,
      features: [
        "Real-time signal stream",
        "24/7 market monitoring",
        "Risk-managed entry zones",
      ],
      popular: false,
      roi: "15-25% target monthly return",
    },
    {
      id: "lead-generation-pro",
      name: "Lead Generation Pro",
      description: "Automated social lead capture, enrichment, and follow-up workflows.",
      price: 197,
      currency: "usd",
      billingInterval: "month",
      billingIntervalCount: 1,
      billingPeriodLabel: "month",
      monthlyPriceEquivalent: 197,
      features: [
        "Cross-platform campaign sync",
        "Lead scoring and routing",
        "CRM and webhook exports",
      ],
      popular: true,
      roi: "300-500% campaign ROI",
    },
    {
      id: "rhnis-identity-suite",
      name: "RHNIS Identity Suite",
      description: "Digital identity tooling with voice, memory, and automation layers.",
      price: 297,
      currency: "usd",
      billingInterval: "month",
      billingIntervalCount: 1,
      billingPeriodLabel: "month",
      monthlyPriceEquivalent: 297,
      features: [
        "Voice profile capture",
        "Identity automation",
        "Beacon and archive tooling",
      ],
      popular: false,
      roi: "High-retention premium plan",
    },
  ];

  return sortPlans(plans);
};

const buildStubSubscribers = (): PortalSubscriber[] => {
  const subscribers: PortalSubscriber[] = [
    {
      id: "sub-1",
      name: "Sarah Johnson",
      email: "sarah@example.com",
      planId: "ai-trading-signals",
      planName: "AI Trading Signals",
      joinDate: "2026-01-15T00:00:00.000Z",
      status: "active",
      amount: 97,
      currency: "usd",
      quantity: 1,
      billingInterval: "month",
      billingIntervalCount: 1,
      monthlyRecurringRevenue: 97,
      items: [
        {
          planId: "ai-trading-signals",
          planName: "AI Trading Signals",
          quantity: 1,
          amount: 97,
          currency: "usd",
          billingInterval: "month",
          billingIntervalCount: 1,
          monthlyRecurringRevenue: 97,
        },
      ],
    },
    {
      id: "sub-2",
      name: "Mike Chen",
      email: "mike@example.com",
      planId: "lead-generation-pro",
      planName: "Lead Generation Pro",
      joinDate: "2026-02-04T00:00:00.000Z",
      status: "active",
      amount: 197,
      currency: "usd",
      quantity: 1,
      billingInterval: "month",
      billingIntervalCount: 1,
      monthlyRecurringRevenue: 197,
      items: [
        {
          planId: "lead-generation-pro",
          planName: "Lead Generation Pro",
          quantity: 1,
          amount: 197,
          currency: "usd",
          billingInterval: "month",
          billingIntervalCount: 1,
          monthlyRecurringRevenue: 197,
        },
      ],
    },
    {
      id: "sub-3",
      name: "Lisa Rodriguez",
      email: "lisa@example.com",
      planId: "lead-generation-pro",
      planName: "Lead Generation Pro",
      joinDate: "2026-02-27T00:00:00.000Z",
      status: "trialing",
      amount: 197,
      currency: "usd",
      quantity: 1,
      billingInterval: "month",
      billingIntervalCount: 1,
      monthlyRecurringRevenue: 197,
      items: [
        {
          planId: "lead-generation-pro",
          planName: "Lead Generation Pro",
          quantity: 1,
          amount: 197,
          currency: "usd",
          billingInterval: "month",
          billingIntervalCount: 1,
          monthlyRecurringRevenue: 197,
        },
      ],
    },
    {
      id: "sub-4",
      name: "David Wilson",
      email: "david@example.com",
      planId: "rhnis-identity-suite",
      planName: "RHNIS Identity Suite",
      joinDate: "2026-03-10T00:00:00.000Z",
      status: "past_due",
      amount: 297,
      currency: "usd",
      quantity: 1,
      billingInterval: "month",
      billingIntervalCount: 1,
      monthlyRecurringRevenue: 297,
      items: [
        {
          planId: "rhnis-identity-suite",
          planName: "RHNIS Identity Suite",
          quantity: 1,
          amount: 297,
          currency: "usd",
          billingInterval: "month",
          billingIntervalCount: 1,
          monthlyRecurringRevenue: 297,
        },
      ],
    },
    {
      id: "sub-5",
      name: "Keisha Pratt",
      email: "keisha@example.com",
      planId: "ai-trading-signals",
      planName: "AI Trading Signals",
      joinDate: "2026-03-26T00:00:00.000Z",
      status: "cancelled",
      amount: 97,
      currency: "usd",
      quantity: 1,
      billingInterval: "month",
      billingIntervalCount: 1,
      monthlyRecurringRevenue: 97,
      items: [
        {
          planId: "ai-trading-signals",
          planName: "AI Trading Signals",
          quantity: 1,
          amount: 97,
          currency: "usd",
          billingInterval: "month",
          billingIntervalCount: 1,
          monthlyRecurringRevenue: 97,
        },
      ],
    },
    {
      id: "sub-6",
      name: "Evan Clarke",
      email: "evan@example.com",
      planId: "rhnis-identity-suite",
      planName: "RHNIS Identity Suite",
      joinDate: "2026-04-08T00:00:00.000Z",
      status: "active",
      amount: 297,
      currency: "usd",
      quantity: 1,
      billingInterval: "month",
      billingIntervalCount: 1,
      monthlyRecurringRevenue: 297,
      items: [
        {
          planId: "rhnis-identity-suite",
          planName: "RHNIS Identity Suite",
          quantity: 1,
          amount: 297,
          currency: "usd",
          billingInterval: "month",
          billingIntervalCount: 1,
          monthlyRecurringRevenue: 297,
        },
      ],
    },
  ];

  return sortSubscribers(subscribers);
};

export const loadPlans = async (
  env: CustomerPortalEnv
): Promise<{
  source: Exclude<PortalDataSource, "mixed">;
  plans: PortalPlan[];
  notes: string[];
}> => {
  const notes: string[] = [];

  if (hasSupabaseConfig(env)) {
    try {
      const supabase = createSupabaseServerClient(env);
      const { data, error } = await supabase.from(getPlanTableName(env)).select("*");

      if (error) {
        notes.push(
          `Supabase plans lookup failed for table "${getPlanTableName(env)}"; falling back to Stripe or stub data.`
        );
      } else if (Array.isArray(data) && data.length) {
        const plans = data
          .map((entry) => asRecord(entry))
          .filter((entry): entry is Record<string, unknown> => Boolean(entry))
          .map((entry) => mapSupabasePlan(entry))
          .filter((entry): entry is PortalPlan => Boolean(entry));

        if (plans.length) {
          return {
            source: "supabase",
            plans: sortPlans(plans),
            notes,
          };
        }
      }
    } catch (_error) {
      notes.push("Supabase plans lookup threw an unexpected error; falling back to another source.");
    }
  }

  if (hasStripeConfig(env)) {
    try {
      const products = await fetchStripeCollection(
        env,
        "/products",
        {
          active: "true",
        },
        ["data.default_price"]
      );

      const plans = products
        .map((product) => mapStripePlan(product))
        .filter((product): product is PortalPlan => Boolean(product))
        .filter((product) => product.price > 0);

      if (plans.length) {
        return {
          source: "stripe",
          plans: sortPlans(plans),
          notes,
        };
      }
    } catch (_error) {
      notes.push("Stripe plans lookup failed; falling back to stub customer portal plans.");
    }
  }

  notes.push("Customer portal plans are currently using the built-in stub dataset.");
  return {
    source: "stub",
    plans: buildStubPlans(),
    notes,
  };
};

export const loadSubscribers = async (
  env: CustomerPortalEnv
): Promise<{
  source: Exclude<PortalDataSource, "mixed">;
  subscribers: PortalSubscriber[];
  notes: string[];
}> => {
  const notes: string[] = [];

  if (hasSupabaseConfig(env)) {
    try {
      const supabase = createSupabaseServerClient(env);
      const { data, error } = await supabase
        .from(getSubscriptionsTableName(env))
        .select("*");

      if (error) {
        notes.push(
          `Supabase subscriptions lookup failed for table "${getSubscriptionsTableName(env)}"; falling back to Stripe or stub data.`
        );
      } else if (Array.isArray(data) && data.length) {
        const subscribers = data
          .map((entry) => asRecord(entry))
          .filter((entry): entry is Record<string, unknown> => Boolean(entry))
          .map((entry) => mapSupabaseSubscription(entry))
          .filter((entry): entry is PortalSubscriber => Boolean(entry));

        if (subscribers.length) {
          return {
            source: "supabase",
            subscribers: sortSubscribers(subscribers),
            notes,
          };
        }
      }
    } catch (_error) {
      notes.push(
        "Supabase subscriptions lookup threw an unexpected error; falling back to another source."
      );
    }
  }

  if (hasStripeConfig(env)) {
    try {
      const subscriptions = await fetchStripeCollection(
        env,
        "/subscriptions",
        {
          status: "all",
        },
        ["data.customer", "data.items.data.price.product"]
      );

      const subscribers = subscriptions
        .map((subscription) => mapStripeSubscription(subscription))
        .filter((subscription): subscription is PortalSubscriber => Boolean(subscription));

      if (subscribers.length) {
        return {
          source: "stripe",
          subscribers: sortSubscribers(subscribers),
          notes,
        };
      }
    } catch (_error) {
      notes.push("Stripe subscriptions lookup failed; falling back to stub analytics data.");
    }
  }

  notes.push("Customer portal analytics are currently using the built-in stub dataset.");
  return {
    source: "stub",
    subscribers: buildStubSubscribers(),
    notes,
  };
};

export const resolveCombinedSource = (
  left: Exclude<PortalDataSource, "mixed">,
  right: Exclude<PortalDataSource, "mixed">
): PortalDataSource => (left === right ? left : "mixed");

export const buildCustomerPortalAnalytics = ({
  plans,
  planSource,
  subscribers,
  subscriberSource,
  notes = [],
}: {
  plans: PortalPlan[];
  planSource: Exclude<PortalDataSource, "mixed">;
  subscribers: PortalSubscriber[];
  subscriberSource: Exclude<PortalDataSource, "mixed">;
  notes?: string[];
}): CustomerPortalAnalyticsPayload => {
  const activeSubscribers = subscribers.filter((subscriber) =>
    isActiveSubscriberStatus(subscriber.status)
  );
  const statusCounts = new Map<PortalSubscriberStatus, number>();
  const planRollup = new Map<
    string,
    {
      planId: string;
      planName: string;
      activeSubscribers: number;
      mrr: number;
    }
  >();

  for (const subscriber of subscribers) {
    statusCounts.set(
      subscriber.status,
      (statusCounts.get(subscriber.status) ?? 0) + 1
    );

    if (!isActiveSubscriberStatus(subscriber.status)) {
      continue;
    }

    // Count active/trialing/past_due subscribers toward MRR and per-plan usage. This mirrors a
    // "current subscription snapshot" metric rather than recognized accounting revenue.
    for (const item of subscriber.items) {
      const planId = item.planId ?? slugify(item.planName);
      const existing =
        planRollup.get(planId) ??
        ({
          planId,
          planName: item.planName,
          activeSubscribers: 0,
          mrr: 0,
        } satisfies {
          planId: string;
          planName: string;
          activeSubscribers: number;
          mrr: number;
        });

      existing.activeSubscribers += 1;
      existing.mrr = roundCurrency(existing.mrr + item.monthlyRecurringRevenue);
      planRollup.set(planId, existing);
    }
  }

  const totalMrr = roundCurrency(
    activeSubscribers.reduce(
      (sum, subscriber) => sum + subscriber.monthlyRecurringRevenue,
      0
    )
  );

  const monthBuckets = Array.from({ length: 6 }, (_unused, index) => {
    const bucket = new Date();
    bucket.setUTCDate(1);
    bucket.setUTCHours(0, 0, 0, 0);
    bucket.setUTCMonth(bucket.getUTCMonth() - (5 - index));
    return bucket;
  });

  const monthlySeries = monthBuckets.map((bucket) => {
    const monthKey = `${bucket.getUTCFullYear()}-${String(bucket.getUTCMonth() + 1).padStart(2, "0")}`;
    const monthSubscribers = subscribers.filter((subscriber) => {
      const joinedAt = new Date(subscriber.joinDate);
      return (
        joinedAt.getUTCFullYear() === bucket.getUTCFullYear() &&
        joinedAt.getUTCMonth() === bucket.getUTCMonth()
      );
    });

    return {
      month: monthKey,
      label: formatMonthLabel(bucket),
      newSubscribers: monthSubscribers.length,
      // Trend charts intentionally use starting MRR from the subscription snapshot because the
      // Worker does not have invoice history. This keeps the series reproducible from plans +
      // subscriptions alone.
      newMrr: roundCurrency(
        monthSubscribers.reduce(
          (sum, subscriber) => sum + subscriber.monthlyRecurringRevenue,
          0
        )
      ),
    };
  });

  const planBreakdown = [
    ...new Map(
      plans.map((plan) => [
        plan.id,
        {
          planId: plan.id,
          planName: plan.name,
          activeSubscribers: 0,
          mrr: 0,
          averageMrr: 0,
        },
      ])
    ).values(),
  ]
    .map((entry) => {
      const aggregated = planRollup.get(entry.planId);
      const activeCount = aggregated?.activeSubscribers ?? 0;
      const mrr = aggregated?.mrr ?? 0;

      return {
        planId: entry.planId,
        planName: entry.planName,
        activeSubscribers: activeCount,
        mrr,
        averageMrr: activeCount ? roundCurrency(mrr / activeCount) : 0,
      };
    })
    .concat(
      [...planRollup.values()]
        .filter(
          (entry) => !plans.some((plan) => plan.id === entry.planId)
        )
        .map((entry) => ({
          planId: entry.planId,
          planName: entry.planName,
          activeSubscribers: entry.activeSubscribers,
          mrr: entry.mrr,
          averageMrr: entry.activeSubscribers
            ? roundCurrency(entry.mrr / entry.activeSubscribers)
            : 0,
        }))
    )
    .sort((left, right) => right.mrr - left.mrr || right.activeSubscribers - left.activeSubscribers);

  return {
    source: resolveCombinedSource(planSource, subscriberSource),
    computedAt: new Date().toISOString(),
    overview: {
      activeSubscribers: activeSubscribers.length,
      totalSubscribers: subscribers.length,
      mrr: totalMrr,
      arr: roundCurrency(totalMrr * 12),
      averageRevenuePerActiveSubscriber: activeSubscribers.length
        ? roundCurrency(totalMrr / activeSubscribers.length)
        : 0,
      trialSubscribers: statusCounts.get("trialing") ?? 0,
      atRiskSubscribers: [...AT_RISK_STATUSES].reduce(
        (sum, status) => sum + (statusCounts.get(status) ?? 0),
        0
      ),
    },
    statusBreakdown: [...statusCounts.entries()]
      .map(([status, count]) => ({
        status,
        count,
      }))
      .sort((left, right) => right.count - left.count),
    planBreakdown,
    monthlySeries,
    subscribers: sortSubscribers(subscribers),
    notes: [
      "MRR is the normalized monthly recurring revenue from subscriptions with status active, trialing, or past_due.",
      "ARR is computed as MRR multiplied by 12.",
      "Average revenue per active subscriber is MRR divided by the number of active subscribers.",
      "The monthly trend chart uses subscription start dates and current recurring value because invoice history is not queried here.",
      ...notes,
    ],
  };
};
