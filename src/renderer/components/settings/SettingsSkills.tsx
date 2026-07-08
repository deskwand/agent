import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Package,
  Trash2,
  Search,
  X,
  Cloud,
  LayoutGrid,
  List,
} from "lucide-react";
import type { Skill, CloudSkill } from "../../types";
import type { LocalizedBanner } from "./shared";
import { ConfirmDialog } from "../ConfirmDialog";
import { SkillMdModal } from "../SkillMdModal";
import { useAppStore } from "../../store";
import { CloudApiClient } from "../../services/cloud-api";
import { SkillCard, CloudOnlySkillCard } from "./SkillCard";
import type { DisplaySkill } from "./SkillCard";

const isElectron =
  typeof window !== "undefined" && window.electronAPI !== undefined;

function formatTimeAgo(
  ts: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return t("skills.justNow");
  if (seconds < 3600)
    return t("skills.minutesAgo", { n: Math.floor(seconds / 60) });
  if (seconds < 86400)
    return t("skills.hoursAgo", { n: Math.floor(seconds / 3600) });
  return t("skills.daysAgo", { n: Math.floor(seconds / 86400) });
}

/* ─── main component ─── */

export function SettingsSkills({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<LocalizedBanner | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{skillId: string; skillName: string} | null>(null);
  const cloudConfig = useAppStore((s) => s.cloudConfig);
  const skillRefreshKey = useAppStore((s) => s.skillRefreshKey);
  const incrementSkillRefreshKey = useAppStore((s) => s.incrementSkillRefreshKey);
  const activeTeamId = useAppStore((s) => s.activeTeamId);
  const activeTeamName = useAppStore((s) => s.activeTeamName);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishStatus, setPublishStatus] = useState<
    Map<string, "unpublished" | "published" | "outdated" | "has_update">
  >(new Map());
  const [mdModal, setMdModal] = useState<{ name: string; content: string | null } | null>(null);
  const [cloudSkills, setCloudSkills] = useState<CloudSkill[]>([]);
  const [teamCloudSkills, setTeamCloudSkills] = useState<CloudSkill[]>([]);
  const [unshareTarget, setUnshareTarget] = useState<CloudSkill | null>(null);
  const [deleteCloudTarget, setDeleteCloudTarget] = useState<CloudSkill | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"cards" | "list">(() => {
    try {
      const stored = localStorage.getItem("skillViewMode");
      return stored === "list" ? "list" : "cards";
    } catch {
      return "cards";
    }
  });

  function toggleViewMode(mode: "cards" | "list") {
    setViewMode(mode);
    try { localStorage.setItem("skillViewMode", mode); } catch { /* noop */ }
  }

  // ─── filter + search state ───
  type FilterKey = "all" | "ai" | "mycloud" | "team" | "builtin";
  const [filterKey, setFilterKey] = useState<FilterKey>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // ─── load local skills ───
  const loadSkills = useCallback(
    async (silent = false) => {
      try {
        const result = await window.electronAPI.skills.getAll();
        setSkills(result || []);
        if (!silent) setError(null);
      } catch (err) {
        console.error("Failed to load skills:", err);
        if (!silent) {
          setError({
            text:
              err instanceof Error && err.message
                ? `${t("skills.failedToLoad")}: ${err.message}`
                : t("skills.failedToLoad"),
          });
        }
      }
    },
    [t],
  );

  useEffect(() => {
    if (!isElectron || !isActive) return;
    void loadSkills();
  }, [isActive, loadSkills]);

  // ─── load my cloud skills ───
  useEffect(() => {
    if (!cloudConfig?.token || !isActive) return;
    const client = new CloudApiClient(cloudConfig.token);
    client.getMySkills()
      .then(setCloudSkills)
      .catch((err: unknown) => {
        const e = err as Error & { status?: number };
        if (e?.status === 401) useAppStore.getState().setCloudConfig(null);
      });
  }, [cloudConfig?.token, isActive, skillRefreshKey]);

  // ─── load team cloud skills ───
  useEffect(() => {
    if (!cloudConfig?.token || !activeTeamId || !isActive) return;
    const client = new CloudApiClient(cloudConfig.token);
    client.getTeamSkills(activeTeamId)
      .then(setTeamCloudSkills)
      .catch((err: unknown) => {
        const e = err as Error & { status?: number };
        if (e?.status === 401) useAppStore.getState().setCloudConfig(null);
      });
  }, [cloudConfig?.token, activeTeamId, isActive, skillRefreshKey]);

  // ─── detect publish status ───
  useEffect(() => {
    if (!isActive) return;
    const checkStatus = async () => {
      const newStatus = new Map<string, "unpublished" | "published" | "outdated" | "has_update">();
      const all = skills.filter((s) => s.type !== "builtin");
      for (const skill of all) {
        try {
          const localFp = await window.electronAPI.skills.computeContentFingerprint(skill.name);
          const storedFp = await window.electronAPI.skills.readFingerprint(skill.name);
          const installedMeta = await window.electronAPI.skills.readInstalledMeta(skill.name);
          const cloudSkill = cloudSkills.find(
            (cs) => cs.name.toLowerCase() === skill.name.toLowerCase()
          ) || teamCloudSkills.find(
            (cs) => cs.name.toLowerCase() === skill.name.toLowerCase()
          );
          if (!cloudSkill) {
            newStatus.set(skill.name, "unpublished");
          } else if (storedFp) {
            if (storedFp === localFp) {
              if (installedMeta && installedMeta.version < cloudSkill.current_version) {
                newStatus.set(skill.name, "has_update");
              } else {
                newStatus.set(skill.name, "published");
              }
            } else {
              newStatus.set(skill.name, "outdated");
            }
          } else if (installedMeta) {
            if (installedMeta.version < cloudSkill.current_version) {
              newStatus.set(skill.name, "has_update");
            } else {
              newStatus.set(skill.name, "published");
            }
          } else {
            newStatus.set(skill.name, "unpublished");
          }
        } catch {
          newStatus.set(skill.name, "unpublished");
        }
      }
      setPublishStatus(newStatus);
    };
    checkStatus();
  }, [skills, isActive, skillRefreshKey, cloudSkills, teamCloudSkills]);

  // ─── cloud skill name lookups (for OR-based filtering) ───
  const myCloudSkillNames = useMemo(
    () => new Set(cloudSkills.map((cs) => cs.name.toLowerCase())),
    [cloudSkills]
  );
  const teamCloudSkillNames = useMemo(
    () => new Set(teamCloudSkills.map((cs) => cs.name.toLowerCase())),
    [teamCloudSkills]
  );

  // ─── unified display list ───
  const localSkillNames = useMemo(() => new Set(skills.map((s) => s.name.toLowerCase())), [skills]);

  const displaySkills = useMemo((): DisplaySkill[] => {
    const result: DisplaySkill[] = [];

    // 1. Local skills
    for (const s of skills) {
      const isFromMyCloud = cloudSkills.some(
        (cs) => cs.name.toLowerCase() === s.name.toLowerCase()
      );
      const isFromTeam = teamCloudSkills.some(
        (cs) => cs.name.toLowerCase() === s.name.toLowerCase()
      );

      let source: DisplaySkill["source"];
      if (s.type === "builtin") source = "builtin";
      else if (s.type === "agent") source = "ai";
      else source = "custom";

      let cloudMembership: "mycloud" | "team" | undefined;
      let sourceTeam: string | undefined;
      if (isFromMyCloud) cloudMembership = "mycloud";
      else if (isFromTeam) {
        cloudMembership = "team";
        sourceTeam = activeTeamName;
      }

      const cloudData = isFromMyCloud
        ? cloudSkills.find((cs) => cs.name.toLowerCase() === s.name.toLowerCase())
        : isFromTeam
        ? teamCloudSkills.find((cs) => cs.name.toLowerCase() === s.name.toLowerCase())
        : undefined;

      result.push({
        id: s.id,
        name: s.name,
        description: s.description || "",
        enabled: s.enabled,
        type: s.type,
        source,
        sourceTeam,
        cloudMembership,
        isCloudOnly: false,
        cloudData,
        createdAt: s.createdAt,
      });
    }

    // 2. Cloud-only skills (deduplicate across mycloud + team)
    const addedCloudNames = new Set<string>();
    for (const cs of cloudSkills) {
      if (!localSkillNames.has(cs.name.toLowerCase()) && !addedCloudNames.has(cs.name.toLowerCase())) {
        addedCloudNames.add(cs.name.toLowerCase());
        result.push({
          id: `cloud-${cs.id}`,
          name: cs.name,
          description: cs.description || "",
          enabled: false,
          type: "custom",
          source: "mycloud",
          cloudMembership: "mycloud",
          isCloudOnly: true,
          cloudData: cs,
          createdAt: Date.now(),
        });
      }
    }

    for (const cs of teamCloudSkills) {
      if (!localSkillNames.has(cs.name.toLowerCase()) && !addedCloudNames.has(cs.name.toLowerCase())) {
        addedCloudNames.add(cs.name.toLowerCase());
        result.push({
          id: `team-${cs.id}`,
          name: cs.name,
          description: cs.description || "",
          enabled: false,
          type: "custom",
          source: "team",
          sourceTeam: activeTeamName,
          cloudMembership: "team",
          isCloudOnly: true,
          cloudData: cs,
          createdAt: Date.now(),
        });
      }
    }

    // Sort: builtin last, rest by name
    return result.sort((a, b) => {
      if (a.type === "builtin" && b.type !== "builtin") return 1;
      if (a.type !== "builtin" && b.type === "builtin") return -1;
      return a.name.localeCompare(b.name);
    });
  }, [skills, cloudSkills, teamCloudSkills, activeTeamName, localSkillNames]);

  // ─── filtered + searched list ───
  const filteredSkills = useMemo(() => {
    let list = displaySkills;
    if (filterKey === "ai") list = list.filter((s) => s.source === "ai");
    else if (filterKey === "mycloud") list = list.filter((s) => myCloudSkillNames.has(s.name.toLowerCase()));
    else if (filterKey === "team") list = list.filter((s) => teamCloudSkillNames.has(s.name.toLowerCase()));
    else if (filterKey === "builtin") list = list.filter((s) => s.source === "builtin");
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      );
    }
    return list;
  }, [displaySkills, filterKey, searchQuery, myCloudSkillNames, teamCloudSkillNames]);

  // ─── handlers ───

  async function doDelete(skillId: string) {
    setIsLoading(true);
    try {
      await window.electronAPI.skills.delete(skillId);
      await loadSkills();
    } catch (err) {
      setError({
        text: err instanceof Error ? err.message : t("skills.failedToDelete"),
      });
    } finally {
      setIsLoading(false);
    }
  }

  function handleDelete(skillId: string, skillName: string) {
    setPendingDelete({ skillId, skillName });
  }

  async function handleToggle(skill: Skill) {
    setIsLoading(true);
    try {
      await window.electronAPI.skills.setEnabled(skill.id, !skill.enabled);
      await loadSkills();
    } catch (err) {
      setError({
        text: err instanceof Error ? err.message : t("skills.failedToToggle"),
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function openSkillMd(skillName: string) {
    try {
      const content = await window.electronAPI.skills.readSkillMd(skillName);
      setMdModal({ name: skillName, content });
    } catch {
      setMdModal({ name: skillName, content: null });
    }
  }

  async function handlePublish(skillName: string) {
    if (!cloudConfig?.token) return;
    setPublishError(null);
    setPublishingId(skillName);
    let fingerprint = "";
    try {
      fingerprint = await window.electronAPI.skills.computeContentFingerprint(skillName);
      const zipBuffer = await window.electronAPI.skills.packageToZip(skillName);
      const blob = new Blob([zipBuffer], { type: "application/zip" });
      const formData = new FormData();
      formData.append("name", skillName);
      formData.append("fingerprint", fingerprint);
      const skillMd = await window.electronAPI.skills.readSkillMd(skillName);
      if (skillMd) formData.append("skill_md", skillMd);
      formData.append("file", blob, `${skillName}.zip`);
      const client = new CloudApiClient(cloudConfig.token);
      const result = await client.createSkill(formData);
      incrementSkillRefreshKey();
      await window.electronAPI.skills.writeFingerprint(skillName, fingerprint);
      await window.electronAPI.skills.writeInstalledMeta(skillName, {
        skillId: result.skill.id,
        version: result.skill.current_version,
      });
      setPublishStatus((prev) => new Map(prev).set(skillName, "published"));
    } catch (err: unknown) {
      const e = err as Error & { status?: number; code?: string };
      if (e?.status === 401) {
        useAppStore.getState().setCloudConfig(null);
      } else if (e?.status === 409) {
        setPublishError(t("skillMarket.duplicateContent"));
        await window.electronAPI.skills.writeFingerprint(skillName, fingerprint);
        setPublishStatus((prev) => new Map(prev).set(skillName, "published"));
      } else {
        setPublishError(e?.message || t("skillMarket.publishFailed"));
      }
    } finally {
      setPublishingId(null);
    }
  }

  async function handleUpdate(skillName: string) {
    const cloudSkill = cloudSkills.find(
      (cs) => cs.name.toLowerCase() === skillName.toLowerCase()
    ) || teamCloudSkills.find(
      (cs) => cs.name.toLowerCase() === skillName.toLowerCase()
    );
    if (!cloudSkill || !cloudConfig?.token) return;
    setUpdatingId(skillName);
    try {
      const client = new CloudApiClient(cloudConfig.token);
      const isMyCloud = cloudSkills.some(
        (cs) => cs.name.toLowerCase() === skillName.toLowerCase()
      );
      const downloadPath = isMyCloud
        ? `/api/skills/${cloudSkill.id}/versions/${cloudSkill.current_version}/download`
        : `/api/teams/${activeTeamId}/skills/${cloudSkill.id}/versions/${cloudSkill.current_version}/download`;
      const { blob, filename } = await client.downloadSkill(downloadPath);
      const buffer = await blob.arrayBuffer();
      const tmpPath = await window.electronAPI.file.saveToTemp(buffer, filename);
      const extractDir = await window.electronAPI.file.extractArchive(tmpPath);
      try {
        await window.electronAPI.skills.install(extractDir);
        await window.electronAPI.skills.writeInstalledMeta(skillName, {
          skillId: cloudSkill.id,
          version: cloudSkill.current_version,
        });
      } finally {
        await window.electronAPI.file.removeTemp(extractDir).catch(() => {});
      }
      incrementSkillRefreshKey();
      setPublishStatus((prev) => new Map(prev).set(skillName, "published"));
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      if (e?.status === 401) {
        useAppStore.getState().setCloudConfig(null);
      } else {
        setPublishError(e?.message || t("skillMarket.publishFailed"));
      }
    } finally {
      setUpdatingId(null);
    }
  }

  // ─── cloud install ───
  async function doCloudInstall(cloudSkill: CloudSkill, source: string) {
    if (!cloudConfig?.token) return;
    setInstallingId(cloudSkill.id);
    try {
      const client = new CloudApiClient(cloudConfig.token);
      const downloadPath = source === "mycloud"
        ? `/api/skills/${cloudSkill.id}/versions/${cloudSkill.current_version}/download`
        : `/api/teams/${activeTeamId}/skills/${cloudSkill.id}/versions/${cloudSkill.current_version}/download`;
      const { blob, filename } = await client.downloadSkill(downloadPath);
      if (isElectron) {
        const buffer = await blob.arrayBuffer();
        const tmpPath = await window.electronAPI.file.saveToTemp(buffer, filename);
        const extractDir = await window.electronAPI.file.extractArchive(tmpPath);
        try {
          const result = await window.electronAPI.skills.install(extractDir);
          if (result?.skill?.name) {
            await window.electronAPI.skills.writeInstalledMeta(result.skill.name, {
              skillId: cloudSkill.id,
              version: cloudSkill.current_version,
            });
          }
        } finally {
          await window.electronAPI.file.removeTemp(extractDir).catch(() => {});
        }
      }
      await loadSkills(true);
      incrementSkillRefreshKey();
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      if (e?.status === 401) useAppStore.getState().setCloudConfig(null);
      else setPublishError(e?.message || "Install failed");
    } finally {
      setInstallingId(null);
    }
  }

  // ─── cloud operations ───
  function handleUnshare(skillName: string) {
    const cloudSkill = cloudSkills.find(
      (cs) => cs.name.toLowerCase() === skillName.toLowerCase()
    );
    if (cloudSkill) setUnshareTarget(cloudSkill);
  }

  function handleDeleteCloud(skillName: string) {
    const cloudSkill = cloudSkills.find(
      (cs) => cs.name.toLowerCase() === skillName.toLowerCase()
    );
    if (cloudSkill) setDeleteCloudTarget(cloudSkill);
  }

  async function confirmUnshare() {
    if (!cloudConfig?.token || !unshareTarget || !activeTeamId) return;
    const skill = unshareTarget;
    setUnshareTarget(null);
    try {
      const client = new CloudApiClient(cloudConfig.token);
      await client.unshareSkill(activeTeamId, skill.id);
      incrementSkillRefreshKey();
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      if (e?.status === 401) useAppStore.getState().setCloudConfig(null);
      else setPublishError(e?.message || t("skillMarket.publishFailed"));
    }
  }

  async function doDeleteCloud(skill: CloudSkill) {
    if (!cloudConfig?.token) return;
    setDeleteCloudTarget(null);
    try {
      const client = new CloudApiClient(cloudConfig.token);
      await client.deleteSkill(skill.id);
      if (isElectron) {
        await window.electronAPI.skills.deleteFingerprint(skill.name).catch(() => {});
      }
      incrementSkillRefreshKey();
    } catch (err: unknown) {
      const e = err as Error & { status?: number };
      if (e?.status === 401) useAppStore.getState().setCloudConfig(null);
      else setPublishError(e?.message || t("skillMarket.publishFailed"));
    }
  }

  // ─── filter chip definitions ───
  const filterChips = useMemo(() => {
    const chips: Array<{ key: FilterKey; label: string }> = [
      { key: "all", label: t("skillMarket.filterAll") },
      { key: "mycloud", label: t("skillMarket.filterMyCloud") },
    ];
    if (activeTeamId) {
      chips.push({ key: "team", label: t("skillMarket.filterTeam") });
    }
    chips.push({ key: "ai", label: t("skillMarket.filterAI") });
    chips.push({ key: "builtin", label: t("skillMarket.filterBuiltin") });
    return chips;
  }, [t, activeTeamId]);

  // ─── source label helper ───
  function getSourceLabel(ds: DisplaySkill): string {
    let label: string;
    switch (ds.source) {
      case "ai": label = t("skillMarket.sourceAI"); break;
      case "custom": label = t("skillMarket.sourceCustom"); break;
      case "mycloud": label = t("skillMarket.sourceMyCloud"); break;
      case "team": label = `${t("skillMarket.sourceTeam")}·${ds.sourceTeam || ""}`; break;
      case "builtin": label = t("skillMarket.sourceBuiltin"); break;
    }
    // Append cloud membership for installed (non-cloud-only) skills
    if (!ds.isCloudOnly && ds.cloudMembership === "mycloud") {
      label += ` · ${t("skillMarket.sourceMyCloud")}`;
    } else if (!ds.isCloudOnly && ds.cloudMembership === "team") {
      label += ` · ${t("skillMarket.sourceTeam")}·${ds.sourceTeam || ""}`;
    }
    return label;
  }

  /* ─── render ─── */

  return (
    <div className="space-y-4">
      {publishError && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {publishError}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4" />
          {error.key ? t(error.key) : error.text}
        </div>
      )}

      {/* Filter chips + toolbar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          {filterChips.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilterKey(f.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filterKey === f.key
                  ? "bg-accent/10 text-accent"
                  : "bg-surface-muted text-text-secondary hover:text-text-primary"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-text-muted whitespace-nowrap">
            {filteredSkills.length} {t("skillMarket.skillCount")}
          </span>
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => toggleViewMode("cards")}
              className={`p-1.5 transition-colors ${
                viewMode === "cards"
                  ? "bg-accent/10 text-accent"
                  : "text-text-muted hover:text-text-primary"
              }`}
              title={t("skillMarket.cardView")}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => toggleViewMode("list")}
              className={`p-1.5 transition-colors ${
                viewMode === "list"
                  ? "bg-accent/10 text-accent"
                  : "text-text-muted hover:text-text-primary"
              }`}
              title={t("skillMarket.listView")}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("skillMarket.search")}
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
        />
      </div>

      {/* Unified skill list */}
      {filteredSkills.length === 0 ? (
        <div className="text-center py-8 text-text-muted">
          {!cloudConfig?.token && (filterKey === "mycloud" || filterKey === "team") ? (
            <div className="rounded-lg border border-border p-6 text-center max-w-sm mx-auto">
              <Cloud className="w-8 h-8 mx-auto mb-3 text-text-muted" />
              <p className="text-sm text-text-secondary mb-4">{t("skillMarket.loginPrompt")}</p>
              <button
                onClick={() => useAppStore.getState().setShowLoginModal(true)}
                className="px-5 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-medium hover:bg-accent-hover transition-colors"
              >
                {t("auth.login")}
              </button>
            </div>
          ) : (
            <>
              <Package className="w-6 h-6 mx-auto mb-2 opacity-40" />
              <p className="text-sm">
                {searchQuery.trim()
                  ? t("skillMarket.noMatch")
                  : t("skillMarket.noSkills")}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className={viewMode === "cards" ? "grid grid-cols-1 md:grid-cols-2 gap-3" : "space-y-2"} style={{ scrollbarGutter: "stable" }}>
          {filteredSkills.map((ds) => {
            const cloudSkill = ds.cloudData;

            // ── Cloud-only skill ──
            if (ds.isCloudOnly && cloudSkill) {
              return (
                <CloudOnlySkillCard
                  key={ds.id}
                  name={ds.name}
                  description={cloudSkill.description || ""}
                  source={ds.source}
                  sourceLabel={getSourceLabel(ds)}
                  onInstall={() => doCloudInstall(cloudSkill, ds.source)}
                  installing={installingId === cloudSkill.id}
                  onSkillMd={
                    cloudSkill.skill_md
                      ? () => setMdModal({ name: ds.name, content: cloudSkill.skill_md ?? null })
                      : undefined
                  }
                  viewMode={viewMode}
                  t={t}
                />
              );
            }

            // ── Installed skill ──
            const skill = skills.find((s) => s.name === ds.name);
            if (!skill) return null;
            const status = publishStatus.get(ds.name);

            const cloudOpsNode =
              cloudConfig && ds.cloudMembership === "mycloud" && cloudSkill ? (
                <>
                  {activeTeamId &&
                    cloudSkill.shared_teams?.some(
                      (st: { team_id: string }) => st.team_id === activeTeamId,
                    ) && (
                      <span className="flex items-center gap-0.5 text-xs text-text-muted">
                        <span>
                          {t("skillMarket.sharedTo", { team: activeTeamName })}
                        </span>
                        <button
                          onClick={() => handleUnshare(skill.name)}
                          className="p-0.5 rounded hover:bg-surface-hover hover:text-error transition-colors"
                          title={t("skillMarket.unshare")}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    )}
                  <button
                    onClick={() => handleDeleteCloud(skill.name)}
                    className="flex items-center gap-1 px-1 py-0.5 rounded text-xs text-text-muted hover:text-error hover:bg-error/5 transition-colors"
                    title={t("skillMarket.deleteCloud")}
                  >
                    <Trash2 className="w-3 h-3" />
                    {t("skillMarket.deleteCloud")}
                  </button>
                </>
              ) : undefined;

            return (
              <SkillCard
                key={ds.id}
                skill={skill}
                isLoading={isLoading}
                onToggle={() => handleToggle(skill)}
                footer={skill.description || formatTimeAgo(skill.createdAt, t)}
                t={t}
                onDelete={ds.type !== "builtin" ? () => handleDelete(skill.id, skill.name) : undefined}
                onPublish={
                  cloudConfig && ds.type !== "builtin" && status !== "has_update"
                    ? () => handlePublish(skill.name)
                    : undefined
                }
                onUpdate={
                  cloudConfig && status === "has_update"
                    ? () => handleUpdate(skill.name)
                    : undefined
                }
                publishStatus={status}
                isPublishing={publishingId === skill.name}
                isUpdating={updatingId === skill.name}
                onSkillMd={() => openSkillMd(skill.name)}
                viewMode={viewMode}
                source={ds.source}
                sourceLabel={getSourceLabel(ds)}
                cloudOps={cloudOpsNode}
              />
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title={t("skills.deleteSkill", { name: pendingDelete?.skillName ?? "" })}
        onConfirm={() => {
          const id = pendingDelete?.skillId;
          if (!id) return;
          setPendingDelete(null);
          doDelete(id);
        }}
        onCancel={() => setPendingDelete(null)}
      />

      {/* Unshare confirm dialog */}
      <ConfirmDialog
        isOpen={unshareTarget !== null}
        title={
          unshareTarget
            ? t("skillMarket.unshareConfirm", {
                name: unshareTarget.name,
                team: activeTeamName,
              })
            : ""
        }
        confirmLabel={t("skillMarket.confirm")}
        onConfirm={confirmUnshare}
        onCancel={() => setUnshareTarget(null)}
      />

      {/* Delete cloud version confirm dialog */}
      <ConfirmDialog
        isOpen={deleteCloudTarget !== null}
        title={
          deleteCloudTarget
            ? t("skillMarket.deleteCloudConfirm", {
                name: deleteCloudTarget.name,
              })
            : ""
        }
        onConfirm={() => {
          const skill = deleteCloudTarget;
          if (skill) doDeleteCloud(skill);
        }}
        onCancel={() => setDeleteCloudTarget(null)}
      />

      <SkillMdModal
        isOpen={mdModal !== null}
        title={mdModal?.name ?? ""}
        content={mdModal?.content ?? null}
        onClose={() => setMdModal(null)}
      />
    </div>
  );
}
