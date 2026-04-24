import { useState } from "react";
import { useApi } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface LogEntry {
  readonly level?: string;
  readonly tag?: string;
  readonly message: string;
  readonly timestamp?: string;
}

interface AiLogMessage {
  readonly role?: string;
  readonly content?: string;
}

interface AiLogEntry {
  readonly timestamp?: string;
  readonly phase?: string;
  readonly mode?: string;
  readonly agent?: string;
  readonly promptId?: string;
  readonly error?: string;
  readonly content?: string;
  readonly messages?: ReadonlyArray<AiLogMessage>;
}

interface Nav {
  toDashboard: () => void;
}

const LEVEL_COLORS: Record<string, string> = {
  error: "text-destructive",
  warn: "text-amber-500",
  info: "text-primary/70",
  debug: "text-muted-foreground/50",
};

export function LogViewer({ nav, theme, t }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const [view, setView] = useState<"system" | "ai">("system");
  const { data, refetch } = useApi<{ entries: ReadonlyArray<LogEntry> }>("/logs");
  const { data: aiData, refetch: refetchAi } = useApi<{ entries: ReadonlyArray<AiLogEntry> }>("/ai-logs");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span className="text-foreground">{t("logs.title")}</span>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl">{t("logs.title")}</h1>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-muted/30 p-1">
            <button
              onClick={() => setView("system")}
              className={`px-3 py-2 text-sm rounded-md transition-colors ${view === "system" ? c.btnSecondary : "text-muted-foreground hover:text-foreground"}`}
            >
              {t("logs.systemTab")}
            </button>
            <button
              onClick={() => setView("ai")}
              className={`px-3 py-2 text-sm rounded-md transition-colors ${view === "ai" ? c.btnSecondary : "text-muted-foreground hover:text-foreground"}`}
            >
              {t("logs.aiTab")}
            </button>
          </div>
          <button
            onClick={() => {
              if (view === "system") {
                void refetch();
                return;
              }
              void refetchAi();
            }}
            className={`px-4 py-2.5 text-sm rounded-md ${c.btnSecondary}`}
          >
            {t("common.refresh")}
          </button>
        </div>
      </div>

      <div className={`border ${c.cardStatic} rounded-lg overflow-hidden`}>
        <div className="p-4 max-h-[600px] overflow-y-auto">
          {view === "system" && data?.entries && data.entries.length > 0 ? (
            <div className="space-y-1 font-mono text-sm leading-relaxed">
              {data.entries.map((entry, i) => (
                <div key={i} className="flex gap-2">
                  {entry.timestamp && (
                    <span className="text-muted-foreground shrink-0 w-20 tabular-nums">
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                  {entry.level && (
                    <span className={`shrink-0 w-12 uppercase ${LEVEL_COLORS[entry.level] ?? "text-muted-foreground"}`}>
                      {entry.level}
                    </span>
                  )}
                  {entry.tag && (
                    <span className="text-primary/70 shrink-0">[{entry.tag}]</span>
                  )}
                  <span className="text-foreground/80">{entry.message}</span>
                </div>
              ))}
            </div>
          ) : view === "ai" && aiData?.entries && aiData.entries.length > 0 ? (
            <div className="space-y-4">
              {aiData.entries.map((entry, i) => (
                <div key={i} className={`rounded-lg border ${c.cardStatic} bg-card/50 p-4 space-y-3`}>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {entry.timestamp && <span>{new Date(entry.timestamp).toLocaleString()}</span>}
                    {entry.phase && <span className="rounded bg-muted px-2 py-1 uppercase">{entry.phase}</span>}
                    {entry.agent && <span className="rounded bg-muted px-2 py-1">{entry.agent}</span>}
                    {entry.promptId && <span className="rounded bg-muted px-2 py-1">{entry.promptId}</span>}
                    {entry.mode && <span className="rounded bg-muted px-2 py-1">{entry.mode}</span>}
                  </div>

                  {entry.messages && entry.messages.length > 0 && (
                    <div className="space-y-3">
                      {entry.messages.map((message, index) => (
                        <div key={index} className="space-y-1">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            {message.role ?? "message"}
                          </div>
                          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-sm text-foreground/85">
                            {message.content ?? ""}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}

                  {entry.content && (
                    <div className="space-y-1">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        {t("logs.aiResponse")}
                      </div>
                      <pre className="whitespace-pre-wrap break-words rounded-md bg-emerald-500/10 p-3 text-sm text-foreground/85">
                        {entry.content}
                      </pre>
                    </div>
                  )}

                  {entry.error && (
                    <div className="space-y-1">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        {t("common.error")}
                      </div>
                      <pre className="whitespace-pre-wrap break-words rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                        {entry.error}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground text-sm italic py-12 text-center">
              {view === "system" ? t("logs.empty") : t("logs.aiEmpty")}
            </div>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {view === "system" ? t("logs.showingRecent") : t("logs.showingRecentAi")}
      </p>
    </div>
  );
}
