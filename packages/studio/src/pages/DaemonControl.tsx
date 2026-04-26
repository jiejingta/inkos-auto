import { useApi, postApi } from "../hooks/use-api";
import { useEffect, useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import type { SSEMessage } from "../hooks/use-sse";
import { shouldRefetchDaemonStatus } from "../hooks/use-book-activity";

interface Nav {
  toDashboard: () => void;
}

export const DAEMON_EVENT_LOG_LIMIT = 500;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function formatDaemonEventMessage(message: Pick<SSEMessage, "event" | "data">): string {
  const data = asRecord(message.data);

  if (message.event === "daemon:error") {
    const bookId = typeof data.bookId === "string" ? data.bookId : "scheduler";
    const error = typeof data.error === "string" ? data.error : undefined;
    return error ? `${bookId}: ${error}` : bookId;
  }

  const primary = data.message ?? data.error ?? data.bookId;
  return primary !== undefined ? String(primary) : JSON.stringify(data);
}

export function selectDaemonEvents(messages: ReadonlyArray<SSEMessage>): ReadonlyArray<SSEMessage> {
  return messages
    .filter((m) => m.event.startsWith("daemon:") || m.event === "log")
    .slice(-DAEMON_EVENT_LOG_LIMIT);
}

export function DaemonControl({ nav, theme, t, sse }: { nav: Nav; theme: Theme; t: TFunction; sse: { messages: ReadonlyArray<SSEMessage> } }) {
  const c = useColors(theme);
  const { data, refetch } = useApi<{ running: boolean }>("/daemon");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const recent = sse.messages.at(-1);
    if (!shouldRefetchDaemonStatus(recent)) return;
    void refetch();
  }, [refetch, sse.messages]);

  const daemonEvents = selectDaemonEvents(sse.messages);

  const handleStart = async () => {
    setLoading(true);
    try {
      await postApi("/daemon/start");
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await postApi("/daemon/stop");
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const isRunning = data?.running ?? false;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.home")}</button>
        <span className="text-border">/</span>
        <span className="text-foreground">{t("nav.daemon")}</span>
      </div>

      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl">{t("daemon.title")}</h1>
        <div className="flex items-center gap-3">
          <span className={`text-sm uppercase tracking-wide font-medium ${isRunning ? "text-emerald-500" : "text-muted-foreground"}`}>
            {isRunning ? t("daemon.running") : t("daemon.stopped")}
          </span>
          {isRunning ? (
            <button
              onClick={handleStop}
              disabled={loading}
              className={`px-4 py-2.5 text-sm rounded-md ${c.btnDanger} disabled:opacity-50`}
            >
              {loading ? t("daemon.stopping") : t("daemon.stop")}
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={loading}
              className={`px-4 py-2.5 text-sm rounded-md ${c.btnPrimary} disabled:opacity-50`}
            >
              {loading ? t("daemon.starting") : t("daemon.start")}
            </button>
          )}
        </div>
      </div>

      {/* Daemon event log */}
      <div className={`border ${c.cardStatic} rounded-lg`}>
        <div className="px-5 py-3.5 border-b border-border">
          <span className="text-sm uppercase tracking-wide text-muted-foreground font-medium">{t("daemon.eventLog")}</span>
        </div>
        <div className="p-4 max-h-[500px] overflow-y-auto">
          {daemonEvents.length > 0 ? (
            <div className="space-y-1.5 font-mono text-sm">
              {daemonEvents.map((msg, i) => {
                return (
                  <div key={i} className="leading-relaxed text-muted-foreground">
                    <span className="text-primary/50">{msg.event}</span>
                    <span className="text-border mx-1.5">›</span>
                    <span className="whitespace-pre-wrap break-words">{formatDaemonEventMessage(msg)}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-muted-foreground text-sm italic py-8 text-center">
              {isRunning ? t("daemon.waitingEvents") : t("daemon.startHint")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
