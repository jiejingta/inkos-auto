import type { AutomationMode, ExecutionStatus, InteractionIntentType } from "@actalk/inkos-core";

export function formatTuiResult(params: {
  readonly intent: InteractionIntentType;
  readonly status: ExecutionStatus;
  readonly bookId?: string;
  readonly mode?: AutomationMode;
  readonly responseText?: string;
}): string {
  if (params.responseText?.trim()) {
    return params.responseText.trim();
  }

  if (params.intent === "switch_mode" && params.mode) {
    return `Mode switched to ${params.mode}.`;
  }

  if (params.intent === "list_books") {
    return "Books listed.";
  }

  if (params.intent === "select_book" && params.bookId) {
    return `Active book: ${params.bookId}`;
  }

  if (params.bookId) {
    return `${intentLabel(params.intent)} — ${params.bookId}`;
  }

  return intentLabel(params.intent);
}

function intentLabel(intent: InteractionIntentType): string {
  const labels: Partial<Record<InteractionIntentType, string>> = {
    write_next: "Chapter written",
    revise_chapter: "Chapter revised",
    rewrite_chapter: "Chapter rewritten",
    update_focus: "Focus updated",
    explain_status: "Status",
    explain_failure: "Explanation",
    pause_book: "Book paused",
    rename_entity: "Entity renamed",
    patch_chapter_text: "Text patched",
    edit_truth: "Truth file updated",
  };
  return labels[intent] ?? `Completed ${intent}`;
}
