import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, OrchestrationThread, ProjectId } from "@t3tools/contracts";
import { useCallback } from "react";

import { useRightPanelStore } from "../../rightPanelStore";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { newThreadId } from "~/lib/utils";

/** Panel tabs are narrow; keep titles to a glanceable length. */
const TITLE_MAX = 40;
/**
 * A quoted passage is context, not the question. Long selections make the
 * quote block unreadable in the panel and cost tokens on every side chat.
 */
const QUOTE_MAX = 2_000;

export function buildSideChatTitle(selection: string): string {
  const flat = selection.replace(/\s+/g, " ").trim();
  return flat.length <= TITLE_MAX ? flat : `${flat.slice(0, TITLE_MAX - 1)}…`;
}

export function truncateSideChatQuote(selection: string): string {
  return selection.trim().slice(0, QUOTE_MAX);
}

/**
 * The quotation is context for whatever the user goes on to ask, so it is
 * carried on the first message rather than sent as a turn of its own. No
 * instructions ride along with it: the question is the user's to write.
 */
export function buildSideChatFirstMessage(input: {
  readonly quote: string;
  readonly question: string;
}): string {
  if (!input.quote) return input.question;
  return [
    "Quoting a passage from another conversation in this workspace:",
    "",
    input.quote
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
    "",
    input.question,
  ].join("\n");
}

/**
 * Opens a side chat for a selected passage: a real thread in the same project,
 * branch, and worktree as the parent, surfaced as a right-panel tab with the
 * passage quoted and nothing asked yet. It is a normal thread, so it keeps
 * working — and stays readable — after the panel is closed.
 */
export function useOpenSideChat(input: {
  readonly environmentId: EnvironmentId;
  readonly parentThread: OrchestrationThread | null;
  readonly projectId: ProjectId | null;
}) {
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const openSideChat = useRightPanelStore((store) => store.openSideChat);
  const { environmentId, parentThread, projectId } = input;

  return useCallback(
    async (selection: string) => {
      const trimmed = selection.trim();
      if (!trimmed || !parentThread || !projectId) return;

      // A side chat inherits the parent's model, mode, branch, and worktree:
      // it is the same conversation, asked from a different angle.
      const { modelSelection, runtimeMode, interactionMode } = parentThread;
      const title = buildSideChatTitle(trimmed);
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();

      const createResult = await createThread({
        environmentId,
        input: {
          threadId,
          projectId,
          title,
          modelSelection,
          runtimeMode,
          interactionMode,
          branch: parentThread.branch,
          worktreePath: parentThread.worktreePath,
          createdAt,
        },
      });
      if (createResult._tag === "Failure") {
        toastManager.add({ type: "error", title: "Could not start a side chat" });
        return;
      }

      // The panel opens showing the quotation with the composer empty and
      // focused: the passage is context, and the question is the user's.
      openSideChat(
        scopeThreadRef(environmentId, parentThread.id),
        threadId,
        title,
        truncateSideChatQuote(trimmed),
      );
    },
    [createThread, environmentId, openSideChat, parentThread, projectId],
  );
}
