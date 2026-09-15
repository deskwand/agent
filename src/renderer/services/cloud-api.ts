import { DESKWAND_API_URL } from "../../shared/oauth-config";

const SERVER_URL = DESKWAND_API_URL;

export interface TopUpOrderListItem {
  id: string;
  chain: "bsc" | "arb" | "base";
  amount_cents: number;
  credited_micro_usd: number;
  tx_hash: string;
  status: "pending" | "confirmed" | "expired";
  created_at: string;
  confirmed_at: string | null;
  expires_at: string;
}

export interface PricingRates {
  input_hit: number;
  input_miss: number;
  output: number;
}

export interface PricingModel {
  model_id: string;
  official: { off_peak: PricingRates; peak: PricingRates | null };
  charged: { off_peak: PricingRates; peak: PricingRates | null };
}

export interface PricingResponse {
  platform_fee_rate: number;
  peak: {
    windows: Array<[string, string]> | null;
    tz: string | null;
    days: number[] | null;
    is_peak_now: boolean;
  };
  models: PricingModel[];
}

export class CloudApiClient {
  private token: string;

  constructor(token?: string) {
    this.token = token || "";
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  /** Shared error handling for both JSON and blob responses. */
  private async fetchCore(
    path: string,
    options: RequestInit,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    // For FormData, let browser set multipart boundary; otherwise use JSON
    const isFormData = options.body instanceof FormData;
    const headers: Record<string, string> = {
      ...this.headers(),
      ...(extraHeaders || {}),
      ...((options.headers as Record<string, string>) || {}),
    };
    if (isFormData) {
      delete headers["Content-Type"];
    }
    const res = await fetch(`${SERVER_URL}${path}`, {
      ...options,
      headers,
    });
    if (!res.ok) {
      let code = "INTERNAL_ERROR";
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        code = body.error?.code || code;
        message = body.error?.message || message;
      } catch {
        /* use defaults */
      }
      throw Object.assign(new Error(message), { code, status: res.status });
    }
    return res;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const res = await this.fetchCore(path, options);
    return res.json();
  }

  async sendCode(email: string): Promise<void> {
    await this.request("/api/auth/send-code", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  async login(
    email: string,
    code: string,
  ): Promise<{
    token: string;
    user: { email: string; level: string; balance_micro_usd: number };
  }> {
    return this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    });
  }

  async getMe(): Promise<{
    email: string;
    level: string;
    balance_micro_usd: number;
  }> {
    return this.request("/api/auth/me");
  }

  /** 官方价 / 实收价 / 峰谷窗口由服务端下发；客户端只用 models[].model_id 发现模型，不做任何费率运算 */
  async getPricing(): Promise<PricingResponse> {
    return this.request<PricingResponse>("/api/models/pricing");
  }

  async logout(): Promise<void> {
    await this.request("/api/auth/logout", { method: "POST" });
  }

  async googleLogin(
    code: string,
    redirectUri: string,
  ): Promise<{
    token: string;
    user: { email: string; level: string; balance_micro_usd: number };
  }> {
    return this.request("/api/auth/google-code", {
      method: "POST",
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
    });
  }

  // ── Teams ──

  async getTeams(): Promise<
    Array<{
      id: string;
      name: string;
      invite_code: string;
      skills_stay_on_leave: number;
      created_by: string;
      created_at: string;
      member_count: number;
    }>
  > {
    const res = await this.request<{
      teams: Array<{
        id: string;
        name: string;
        invite_code: string;
        skills_stay_on_leave: number;
        created_by: string;
        created_at: string;
        member_count: number;
      }>;
    }>("/api/teams");
    return res.teams;
  }

  // ── My Skills ──

  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  async getMySkills(): Promise<import("../types").CloudSkill[]> {
    const res = await this.request<{
      // eslint-disable-next-line @typescript-eslint/consistent-type-imports
      skills: import("../types").CloudSkill[];
    }>("/api/skills/mine");
    return res.skills;
  }

  async createSkill(formData: FormData): Promise<{
    skill: { id: string; name: string; current_version: number };
  }> {
    const res = await this.fetchCore("/api/skills", {
      method: "POST",
      body: formData,
    });
    return res.json();
  }

  async deleteSkill(skillId: string): Promise<void> {
    await this.request(`/api/skills/${skillId}`, { method: "DELETE" });
  }

  // ── Team Skills ──

  async getTeamSkills(
    teamId: string,
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ): Promise<import("../types").CloudSkill[]> {
    const res = await this.request<{
      // eslint-disable-next-line @typescript-eslint/consistent-type-imports
      skills: import("../types").CloudSkill[];
    }>(`/api/teams/${teamId}/skills`);
    return res.skills;
  }

  async shareSkill(teamId: string, skillId: string): Promise<void> {
    await this.request(`/api/teams/${teamId}/skills/${skillId}/share`, {
      method: "POST",
    });
  }

  async unshareSkill(teamId: string, skillId: string): Promise<void> {
    await this.request(`/api/teams/${teamId}/skills/${skillId}/share`, {
      method: "DELETE",
    });
  }

  // ── Download ──

  async downloadSkill(url: string): Promise<{ blob: Blob; filename: string }> {
    const res = await this.fetchCore(url, {}, { "Content-Type": "" });
    const blob = await res.blob();
    // Extract filename from Content-Disposition header
    const disposition = res.headers.get("Content-Disposition");
    const match = disposition?.match(/filename[^=]*=("([^"]*)"|([^;]*))/i);
    const filename =
      (match?.[2] || match?.[3])?.trim() || url.split("/").pop() || "skill.zip";
    return { blob, filename };
  }

  // ── Marketplace ──

  async getMarketplaceCategories(): Promise<
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    import("../types").MarketplaceCategory[]
  > {
    const res = await this.request<{
      // eslint-disable-next-line @typescript-eslint/consistent-type-imports
      categories: import("../types").MarketplaceCategory[];
    }>("/api/marketplace/categories");
    return res.categories;
  }

  async getMarketplace(params: {
    q?: string;
    category?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    skills: import("../types").MarketplaceSkill[];
    total: number;
    page: number;
    limit: number;
  }> {
    const sp = new URLSearchParams();
    if (params.q) sp.set("q", params.q);
    if (params.category) sp.set("category", params.category);
    sp.set("page", String(params.page ?? 1));
    sp.set("limit", String(params.limit ?? 20));
    return this.request(`/api/marketplace?${sp.toString()}`);
  }

  async getMarketplaceSkillDetail(
    slug: string,
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ): Promise<import("../types").MarketplaceSkill> {
    return this.request(`/api/marketplace/${slug}`);
  }

  async installMarketplaceSkill(slug: string): Promise<{
    skill: { id: string; name: string; current_version: number };
  }> {
    return this.request(`/api/marketplace/${slug}/install`, {
      method: "POST",
    });
  }

  getSkillDownloadUrl(skillId: string, version: number): string {
    return `/api/skills/${skillId}/versions/${version}/download`;
  }

  // ── Top-Up ──

  async createTopUpOrder(
    amountCents: number,
    chain: "bsc" | "arb" | "base",
  ): Promise<{
    id: string;
    chain: string;
    amount_cents: number;
    deposit_address: string;
    expires_at: string;
  }> {
    const res = await this.request<{
      order: {
        id: string;
        chain: string;
        amount_cents: number;
        deposit_address: string;
        expires_at: string;
      };
    }>("/api/payments/orders", {
      method: "POST",
      body: JSON.stringify({ amount_cents: amountCents, chain }),
    });
    return res.order;
  }

  async getTopUpOrder(id: string): Promise<{
    id: string;
    status: "pending" | "confirmed" | "expired";
    credited_micro_usd: number;
    tx_hash: string;
    confirmed_at: string | null;
    expires_at: string;
  }> {
    const res = await this.request<{
      order: {
        id: string;
        status: "pending" | "confirmed" | "expired";
        credited_micro_usd: number;
        tx_hash: string;
        confirmed_at: string | null;
        expires_at: string;
      };
    }>(`/api/payments/orders/${id}`);
    return res.order;
  }

  async getTopUpOrders(params: { limit?: number; offset?: number }): Promise<{
    orders: TopUpOrderListItem[];
    has_more: boolean;
  }> {
    const qs = new URLSearchParams();
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.offset) qs.set("offset", String(params.offset));
    const q = qs.toString();
    return this.request(`/api/payments/orders${q ? `?${q}` : ""}`);
  }

  // ── Vault ──

  async vaultPut(id: string, payload: ArrayBuffer): Promise<void> {
    const res = await this.fetchCore(`/api/vault/objects/${id}`, {
      method: "PUT",
      body: payload,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async vaultList(): Promise<string[]> {
    const res = await this.request<{ object_ids: string[] }>(
      "/api/vault/objects",
    );
    return res.object_ids;
  }

  async vaultGet(id: string): Promise<ArrayBuffer> {
    const res = await this.fetchCore(`/api/vault/objects/${id}`, {});
    return res.arrayBuffer();
  }

  async vaultDelete(id: string): Promise<void> {
    await this.request(`/api/vault/objects/${id}`, { method: "DELETE" });
  }
}
