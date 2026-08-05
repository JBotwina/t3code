import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { newMessageId } from "~/lib/utils";
import { useThread } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { Spinner } from "../ui/spinner";
import { cn } from "~/lib/utils";

/**
 * A side chat rendered inside the right panel.
 *
 * Deliberately thin: it reads one thread and starts turns on it. Everything
 * that makes the main composer expensive — attachments, slash commands,
 * worktree preparation, draft persistence — is absent on purpose, because a
 * side chat is for asking about one thing while the main thread keeps running.
 */
export function SideChatPanel({
  environmentId,
  threadId,
  markdownCwd,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly markdownCwd?: string;
}) {
  const threadRef = scopeThreadRef(environmentId, threadId);
  const thread = useThread(threadRef);
  const startTurn = useAtomCommand(threadEnvironment.startTurn, "side chat send");
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, "side chat interrupt");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = thread?.messages ?? [];
  const isRunning = thread?.session?.status === "running";
  const lastMessageId = messages.at(-1)?.id ?? null;
  const streamingText = messages.at(-1)?.text ?? "";

  // Side chats are short and the panel is narrow; following the tail here is
  // the wanted behaviour, unlike the main timeline.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [lastMessageId, streamingText]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !thread) return;
    setSending(true);
    setDraft("");
    const result = await startTurn({
      environmentId,
      input: {
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text,
          attachments: [],
        },
        modelSelection: thread.modelSelection,
        titleSeed: thread.title,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        createdAt: new Date().toISOString(),
      },
    });
    setSending(false);
    if (result._tag === "Failure") {
      // Put the text back rather than losing it to a failed send.
      setDraft(text);
    }
  }, [draft, environmentId, sending, startTurn, thread, threadId]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void send();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Ask about the quoted passage. This chat runs in the same workspace as the main thread.
          </p>
        ) : null}
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-secondary px-3 py-2 text-sm whitespace-pre-wrap">
                {message.text}
              </div>
            </div>
          ) : (
            <div key={message.id} className="min-w-0 text-sm">
              <ChatMarkdown
                text={message.text || (message.streaming ? "" : "(empty response)")}
                cwd={markdownCwd}
                isStreaming={message.streaming}
              />
            </div>
          ),
        )}
        {isRunning && messages.at(-1)?.role === "user" ? (
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Spinner className="size-3" />
            Working
          </div>
        ) : null}
      </div>

      <div className="border-border/60 border-t p-2">
        <div className="flex items-end gap-2 rounded-xl border border-border/60 bg-card px-2 py-1.5">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Ask about this…"
            aria-label="Side chat message"
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            aria-label={isRunning ? "Stop" : "Send"}
            title={isRunning ? "Stop" : "Send"}
            disabled={!isRunning && draft.trim().length === 0}
            onClick={() => {
              if (isRunning) {
                void interruptTurn({ environmentId, input: { threadId } });
                return;
              }
              void send();
            }}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:cursor-pointer disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            {isRunning ? <SquareIcon className="size-3" /> : <ArrowUpIcon className="size-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
