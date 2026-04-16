import { useEffect, useMemo, useState } from "react";
import { putApi, useApi } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";

type PromptOverrideMode = "inherit" | "append" | "replace";

interface PromptSegmentOverride {
  readonly mode: PromptOverrideMode;
  readonly text: string;
}

interface PromptOverrideEntry {
  readonly system?: PromptSegmentOverride;
  readonly user?: PromptSegmentOverride;
}

interface PromptCatalogSnippet {
  readonly label: string;
  readonly file: string;
  readonly content: string;
}

interface PromptCatalogEntry {
  readonly id: string;
  readonly group: "agents" | "interaction" | "pipeline";
  readonly agent: string;
  readonly title: string;
  readonly description: string;
  readonly systemSnippets: ReadonlyArray<PromptCatalogSnippet>;
  readonly userSnippets: ReadonlyArray<PromptCatalogSnippet>;
}

interface PromptPayload {
  readonly prompts: ReadonlyArray<PromptCatalogEntry>;
  readonly overrides: Record<string, PromptOverrideEntry>;
}

interface Nav {
  readonly toDashboard: () => void;
}

function normalizeSegment(segment?: PromptSegmentOverride): PromptSegmentOverride {
  return {
    mode: segment?.mode ?? "inherit",
    text: segment?.text ?? "",
  };
}

function normalizeOverrides(overrides?: Record<string, PromptOverrideEntry>): Record<string, PromptOverrideEntry> {
  return Object.fromEntries(
    Object.entries(overrides ?? {}).map(([promptId, entry]) => [
      promptId,
      {
        ...(entry.system ? { system: normalizeSegment(entry.system) } : {}),
        ...(entry.user ? { user: normalizeSegment(entry.user) } : {}),
      },
    ]),
  );
}

function upsertSegment(
  overrides: Record<string, PromptOverrideEntry>,
  promptId: string,
  field: "system" | "user",
  next: PromptSegmentOverride,
): Record<string, PromptOverrideEntry> {
  const current = overrides[promptId] ?? {};
  return {
    ...overrides,
    [promptId]: {
      ...current,
      [field]: next,
    },
  };
}

function hasOverride(entry?: PromptOverrideEntry): boolean {
  if (!entry) return false;
  const system = entry.system;
  const user = entry.user;
  return Boolean(
    (system && (system.mode !== "inherit" || system.text.trim().length > 0))
    || (user && (user.mode !== "inherit" || user.text.trim().length > 0)),
  );
}

function removePromptOverride(
  overrides: Record<string, PromptOverrideEntry>,
  promptId: string,
): Record<string, PromptOverrideEntry> {
  const next = { ...overrides };
  delete next[promptId];
  return next;
}

function compactOverrides(overrides: Record<string, PromptOverrideEntry>): Record<string, PromptOverrideEntry> {
  return Object.fromEntries(
    Object.entries(overrides).flatMap(([promptId, entry]) => {
      const system = entry.system && (entry.system.mode !== "inherit" || entry.system.text.trim().length > 0)
        ? entry.system
        : undefined;
      const user = entry.user && (entry.user.mode !== "inherit" || entry.user.text.trim().length > 0)
        ? entry.user
        : undefined;
      return system || user
        ? [[promptId, { ...(system ? { system } : {}), ...(user ? { user } : {}) }]]
        : [];
    }),
  );
}

function groupLabel(group: PromptCatalogEntry["group"]): string {
  switch (group) {
    case "agents":
      return "Agents";
    case "interaction":
      return "Interaction";
    case "pipeline":
      return "Pipeline";
  }
}

export function PromptManager({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<PromptPayload>("/project/prompts");
  const [selectedId, setSelectedId] = useState<string>("");
  const [draftOverrides, setDraftOverrides] = useState<Record<string, PromptOverrideEntry>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setDraftOverrides(normalizeOverrides(data.overrides));
    if (!selectedId && data.prompts.length > 0) {
      setSelectedId(data.prompts[0]!.id);
    }
    if (selectedId && !data.prompts.some((prompt) => prompt.id === selectedId) && data.prompts.length > 0) {
      setSelectedId(data.prompts[0]!.id);
    }
  }, [data, selectedId]);

  const groupedPrompts = useMemo(() => {
    const groups: Array<{ group: PromptCatalogEntry["group"]; prompts: PromptCatalogEntry[] }> = [];
    for (const group of ["agents", "interaction", "pipeline"] as const) {
      const prompts = (data?.prompts ?? []).filter((prompt) => prompt.group === group);
      if (prompts.length > 0) {
        groups.push({ group, prompts });
      }
    }
    return groups;
  }, [data?.prompts]);

  const selectedPrompt = useMemo(
    () => data?.prompts.find((prompt) => prompt.id === selectedId) ?? data?.prompts[0],
    [data?.prompts, selectedId],
  );

  const selectedOverride = selectedPrompt
    ? draftOverrides[selectedPrompt.id]
    : undefined;

  if (loading) {
    return <div className="text-muted-foreground py-20 text-center text-sm">Loading prompt catalog...</div>;
  }
  if (error) {
    return <div className="text-destructive py-20 text-center">Error: {error}</div>;
  }
  if (!data || data.prompts.length === 0) {
    return <div className="text-muted-foreground py-20 text-center text-sm">No prompt entries found.</div>;
  }

  const saveOverrides = async () => {
    setSaving(true);
    try {
      await putApi("/project/prompts", { overrides: compactOverrides(draftOverrides) });
      await refetch();
    } catch (saveError) {
      alert(saveError instanceof Error ? saveError.message : "Failed to save prompt overrides");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span className="text-foreground">{t("nav.prompts")}</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl">{t("prompts.title")}</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            {t("prompts.subtitle")}
          </p>
        </div>
        <button
          onClick={saveOverrides}
          disabled={saving}
          className={`px-4 py-2.5 text-sm rounded-md ${c.btnPrimary} disabled:opacity-50`}
        >
          {saving ? t("config.saving") : t("prompts.save")}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className={`border ${c.cardStatic} ${c.surface} rounded-xl p-4 space-y-5 h-fit`}>
          {groupedPrompts.map(({ group, prompts }) => (
            <div key={group} className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-bold">
                {groupLabel(group)}
              </div>
              <div className="space-y-2">
                {prompts.map((prompt) => {
                  const active = selectedPrompt?.id === prompt.id;
                  const overridden = hasOverride(draftOverrides[prompt.id]);
                  return (
                    <button
                      key={prompt.id}
                      onClick={() => setSelectedId(prompt.id)}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition-all ${
                        active
                          ? "border-primary bg-primary/10 shadow-sm"
                          : "border-border hover:border-primary/40 hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-sm text-foreground">{prompt.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground font-mono">{prompt.agent}</div>
                        </div>
                        {overridden && (
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                            {t("prompts.overridden")}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {selectedPrompt && (
          <div className="space-y-6">
            <div className={`border ${c.cardStatic} ${c.surface} rounded-xl p-6 space-y-3`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-bold">
                    {selectedPrompt.agent}
                  </div>
                  <h2 className="mt-2 font-serif text-2xl">{selectedPrompt.title}</h2>
                </div>
                <code className="rounded-lg bg-muted px-2 py-1 text-xs text-foreground/80">{selectedPrompt.id}</code>
              </div>
              <p className="text-sm text-muted-foreground">{selectedPrompt.description}</p>
            </div>

            <PromptSourceSection
              title={t("prompts.systemSource")}
              snippets={selectedPrompt.systemSnippets}
              emptyLabel={t("prompts.noSystemSource")}
              c={c}
            />
            <PromptSourceSection
              title={t("prompts.userSource")}
              snippets={selectedPrompt.userSnippets}
              emptyLabel={t("prompts.noUserSource")}
              c={c}
            />

            <div className={`border ${c.cardStatic} ${c.surface} rounded-xl p-6 space-y-6`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-serif text-xl">{t("prompts.overrideTitle")}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{t("prompts.overrideHint")}</p>
                </div>
                <button
                  onClick={() => setDraftOverrides(removePromptOverride(draftOverrides, selectedPrompt.id))}
                  className={`px-3 py-2 text-xs rounded-md ${c.btnSecondary}`}
                >
                  {t("prompts.reset")}
                </button>
              </div>

              <PromptOverrideEditor
                label={t("prompts.systemOverride")}
                value={normalizeSegment(selectedOverride?.system)}
                onChange={(next) => setDraftOverrides(upsertSegment(draftOverrides, selectedPrompt.id, "system", next))}
                c={c}
                placeholder={t("prompts.placeholder")}
              />

              <PromptOverrideEditor
                label={t("prompts.userOverride")}
                value={normalizeSegment(selectedOverride?.user)}
                onChange={(next) => setDraftOverrides(upsertSegment(draftOverrides, selectedPrompt.id, "user", next))}
                c={c}
                placeholder={t("prompts.placeholder")}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PromptSourceSection({
  title,
  snippets,
  emptyLabel,
  c,
}: {
  title: string;
  snippets: ReadonlyArray<PromptCatalogSnippet>;
  emptyLabel: string;
  c: ReturnType<typeof useColors>;
}) {
  return (
    <div className={`border ${c.cardStatic} ${c.surface} rounded-xl p-6 space-y-4`}>
      <h3 className="font-serif text-xl">{title}</h3>
      {snippets.length === 0 && (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      )}
      {snippets.map((snippet) => (
        <div key={`${snippet.file}:${snippet.label}`} className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-foreground">{snippet.label}</div>
            <code className="rounded-lg bg-muted px-2 py-1 text-[11px] text-foreground/80">{snippet.file}</code>
          </div>
          <pre className="overflow-x-auto rounded-xl border border-border bg-muted/40 p-4 text-xs leading-6 text-foreground/85">
            <code>{snippet.content}</code>
          </pre>
        </div>
      ))}
    </div>
  );
}

function PromptOverrideEditor({
  label,
  value,
  onChange,
  c,
  placeholder,
}: {
  label: string;
  value: PromptSegmentOverride;
  onChange: (next: PromptSegmentOverride) => void;
  c: ReturnType<typeof useColors>;
  placeholder: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="font-medium text-sm text-foreground">{label}</div>
        <select
          value={value.mode}
          onChange={(event) => onChange({ ...value, mode: event.target.value as PromptOverrideMode })}
          className={`${c.input} rounded-lg px-2 py-1.5 text-sm`}
        >
          <option value="inherit">inherit</option>
          <option value="append">append</option>
          <option value="replace">replace</option>
        </select>
      </div>
      <textarea
        value={value.text}
        onChange={(event) => onChange({ ...value, text: event.target.value })}
        rows={10}
        placeholder={placeholder}
        className={`${c.input} min-h-[220px] w-full rounded-xl px-4 py-3 text-sm leading-6 font-mono`}
      />
    </div>
  );
}
