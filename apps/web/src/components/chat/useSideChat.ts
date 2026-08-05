import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, OrchestrationThread, ProjectId } from "@t3tools/contracts";
import { useCallback } from "react";

import { useRightPanelStore } from "../../rightPanelStore";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { newMessageId, newThreadId } from "~/lib/utils";

/** Panel tabs are narrow; keep titles to a glanceable length. */
const TITLE_MAX = 40;
/**
 * A quoted passage is context, not the question. Long selections make the
 * seeded prompt unreadable in the panel and cost tokens on every side chat.
 */
const QUOTE_MAX = 2_000;

export function buildSideChatTitle(selection: string): string {
  const flat = selection.replace(/\s+/g, " ").trim();
  return flat.length <= TITLE_MAX ? flat : `${flat.slice(0, TITLE_MAX - 1)}…`;
}

export function buildSideChatSeed(input: {
  readonly selection: string;
  readonly parentTitle: string;
}): string {
  const quote = input.selection.trim().slice(0, QUOTE_MAX);
  return [
    `I'm asking about a passage from another conversation in this workspace ("${input.parentTitle}"):`,
    "",
    quote
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
    "",
    "Answer questions about this passage. You have the same workspace, so read files as needed.",
  ].join("\n");
}

/**
 * Opens a side chat for a selected passage: a real thread in the same project,
 * branch, and worktree as the parent, seeded with the quotation and surfaced as
 * a right-panel tab. It is a normal thread, so it keeps working — and stays
 * readable — after the panel is closed.
 */
export function useOpenSideChat(input: {
  readonly environmentId: EnvironmentId;
  readonly parentThread: OrchestrationThread | null;
  readonly projectId: ProjectId | null;
}) {
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
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

      // Open the tab before the turn starts so the panel shows the seeded
      // question streaming in rather than an empty pane.
      openSideChat(scopeThreadRef(environmentId, parentThread.id), threadId, title);

      const startResult = await startTurn({
        environmentId,
        input: {
          threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: buildSideChatSeed({ selection: trimmed, parentTitle: parentThread.title }),
            attachments: [],
          },
          modelSelection,
          titleSeed: title,
          runtimeMode,
          interactionMode,
          createdAt,
        },
      });
      if (startResult._tag === "Failure") {
        toastManager.add({ type: "error", title: "Side chat could not send the quoted passage" });
      }
    },
    [createThread, environmentId, openSideChat, parentThread, projectId, startTurn],
  );
}
