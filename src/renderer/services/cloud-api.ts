import { DESKWAND_API_URL } from "../../shared/oauth-config";

const SERVER_URL = DESKWAND_API_URL;

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
    user: { email: string; level: string; credits_balance: number };
  }> {
    return this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    });
  }

  async getMe(): Promise<{
    email: string;
    level: string;
    credits_balance: number;
  }> {
    return this.request("/api/auth/me");
  }

  async getModes(): Promise<
    Array<{ id: string; name: string; model: string }>
  > {
    const res = await this.request<{
      modes: Array<{ id: string; name: string; model: string }>;
    }>("/api/models/modes");
    return res.modes;
  }

  async logout(): Promise<void> {
    await this.request("/api/auth/logout", { method: "POST" });
  }

  async googleLogin(
    code: string,
    redirectUri: string,
  ): Promise<{
    token: string;
    user: { email: string; level: string; credits_balance: number };
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

  async getMySkills(): Promise<import("../types").CloudSkill[]> {
    const res = await this.request<{
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
  ): Promise<import("../types").CloudSkill[]> {
    const res = await this.request<{
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
}
