import { Suspense, useCallback, useState, useEffect, useRef } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { isToolUIPart, getToolName, type UIMessage } from "ai";
import type { TeamAgent } from "./server";
import {
  Badge,
  Button,
  Empty,
  InputArea,
  Surface,
  Text,
} from "@cloudflare/kumo";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import {
  PaperPlaneRightIcon,
  StopIcon,
  TrashIcon,
  GearIcon,
  ChatCircleDotsIcon,
  CircleIcon,
  MoonIcon,
  SunIcon,
  NotePencilIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  ClockIcon,
  CheckCircleIcon,
  UsersIcon,
  ArrowsClockwiseIcon,
  LightningIcon,
} from "@phosphor-icons/react";

// ── Constants ────────────────────────────────────────────────────────

const PRESET_TEAMS = ["engineering", "marketing", "sales", "product", "design"];

const QUICK_ACTIONS = [
  { icon: <ListChecksIcon size={14} />, text: "Show pending action items" },
  { icon: <MagnifyingGlassIcon size={14} />, text: "What did we discuss last?" },
  { icon: <ClockIcon size={14} />, text: "Show recent meetings" },
  { icon: <CheckCircleIcon size={14} />, text: "Show completed action items" },
];

// ── Small components ──────────────────────────────────────────────────

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-mode") === "dark",
  );

  const toggle = useCallback(() => {
    const next = !dark;
    setDark(next);
    const mode = next ? "dark" : "light";
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [dark]);

  return (
    <Button
      variant="secondary"
      shape="square"
      icon={dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
      onClick={toggle}
      aria-label="Toggle theme"
    />
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Detect text that is really a raw tool-call JSON blob Llama sometimes emits as plain text */
function isRawToolCallText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed);
    // Llama tool-call format: {"name": "...", "parameters": {...}}
    if (typeof parsed === "object" && parsed !== null && "name" in parsed && "parameters" in parsed) {
      return true;
    }
  } catch {
    // not valid JSON — not a tool call
  }
  return false;
}

// ── Tool rendering ────────────────────────────────────────────────────
// Tools are internal agent operations — we show only a subtle indicator,
// never the raw JSON input/output.

const TOOL_LABELS: Record<string, string> = {
  getLastMeeting: "Looking up last meeting",
  listActionItems: "Fetching action items",
  completeActionItem: "Updating action item",
  queryMeetings: "Searching meetings",
  getRecentMeetings: "Fetching recent meetings",
};

function ToolPartView({ part }: { part: UIMessage["parts"][number] }) {
  if (!isToolUIPart(part)) return null;
  const toolName = getToolName(part);
  const label = TOOL_LABELS[toolName] ?? toolName;

  // Tool finished — show a collapsed one-liner (no JSON output)
  if (part.state === "output-available") {
    return (
      <div className="flex justify-start">
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-kumo-elevated">
          <GearIcon size={12} className="text-kumo-inactive" />
          <Text size="xs" variant="secondary">
            {label}
          </Text>
          <CheckCircleIcon size={12} weight="fill" className="text-green-500" />
        </div>
      </div>
    );
  }

  // Tool is running — show a spinner
  if (part.state === "input-available" || part.state === "input-streaming") {
    return (
      <div className="flex justify-start">
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-kumo-elevated">
          <GearIcon size={12} className="text-kumo-inactive animate-spin" />
          <Text size="xs" variant="secondary">
            {label}...
          </Text>
        </div>
      </div>
    );
  }

  return null;
}

// ── Team Selector ─────────────────────────────────────────────────────

function TeamSelector({
  onSelect,
}: {
  onSelect: (teamId: string) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <div className="flex items-center justify-center h-screen bg-kumo-elevated">
      <Surface className="p-8 rounded-2xl ring ring-kumo-line max-w-md w-full mx-4">
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2 mb-3">
            <ChatCircleDotsIcon size={28} weight="duotone" className="text-kumo-accent" />
            <h1 className="text-2xl font-bold text-kumo-default">
              CortexMinutes
            </h1>
          </div>
          <Text variant="secondary">
            Your team's meeting memory. Select a team to get started.
          </Text>
        </div>

        <div className="mb-4">
          <div className="mb-2">
            <Text size="xs" variant="secondary" bold>
              Quick select
            </Text>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESET_TEAMS.map((team) => (
              <button
                key={team}
                type="button"
                onClick={() => onSelect(team)}
                className="px-3 py-1.5 text-sm rounded-lg border border-kumo-line bg-kumo-base text-kumo-default hover:bg-kumo-elevated hover:border-kumo-accent transition-colors cursor-pointer"
              >
                {team}
              </button>
            ))}
          </div>
        </div>

        <div className="relative mb-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-kumo-line" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-kumo-base px-3">
              <Text size="xs" variant="secondary">or enter a custom team</Text>
            </span>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = value.trim();
            if (trimmed) onSelect(trimmed);
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. platform-team"
            autoFocus
            className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-kumo-line bg-kumo-base text-kumo-default placeholder:text-kumo-inactive focus:outline-none focus:ring-2 focus:ring-kumo-accent"
          />
          <Button type="submit" variant="primary" disabled={!value.trim()}>
            Join
          </Button>
        </form>
      </Surface>
    </div>
  );
}

// ── Meeting Ingestion Panel ───────────────────────────────────────────

function MeetingPanel({ teamId }: { teamId: string }) {
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !transcript.trim()) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(
        `/api/team/${encodeURIComponent(teamId)}/meetings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            transcript: transcript.trim(),
          }),
        },
      );

      if (!res.ok) {
        let errorMsg = `HTTP ${res.status}`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) errorMsg = data.error;
        } catch {
          // response body wasn't JSON
        }
        throw new Error(errorMsg);
      }

      let data: { meetingId: string; summary: string; actionItems: string[] };
      try {
        data = await res.json();
      } catch {
        throw new Error("Server returned invalid JSON");
      }

      const itemCount = data.actionItems.length;
      setSuccess(
        `"${title.trim()}" ingested — ${itemCount} action item${itemCount !== 1 ? "s" : ""} extracted.`,
      );
      setTitle("");
      setTranscript("");
    } catch (err) {
      console.error("Ingestion error:", err);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Surface className="p-4 rounded-xl ring ring-kumo-line">
      <div className="flex items-center gap-2 mb-3">
        <NotePencilIcon size={16} className="text-kumo-accent" />
        <Text size="sm" bold>
          Ingest Meeting
        </Text>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setSuccess(null);
          }}
          placeholder="Meeting title"
          className="w-full px-3 py-2 text-sm rounded-lg border border-kumo-line bg-kumo-base text-kumo-default placeholder:text-kumo-inactive focus:outline-none focus:ring-1 focus:ring-kumo-accent"
        />
        <textarea
          value={transcript}
          onChange={(e) => {
            setTranscript(e.target.value);
            setSuccess(null);
          }}
          placeholder="Paste meeting transcript here..."
          rows={5}
          className="w-full px-3 py-2 text-sm rounded-lg border border-kumo-line bg-kumo-base text-kumo-default placeholder:text-kumo-inactive focus:outline-none focus:ring-1 focus:ring-kumo-accent resize-y"
        />
        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
            <span className="text-xs text-red-600 dark:text-red-400">
              {error}
            </span>
          </div>
        )}
        {success && (
          <div className="px-3 py-2 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
            <div className="flex items-center gap-1.5">
              <CheckCircleIcon
                size={14}
                weight="fill"
                className="text-green-600 dark:text-green-400 shrink-0"
              />
              <span className="text-xs text-green-700 dark:text-green-300">
                {success}
              </span>
            </div>
          </div>
        )}
        <Button
          type="submit"
          variant="primary"
          size="sm"
          className="w-full"
          disabled={submitting || !title.trim() || !transcript.trim()}
        >
          {submitting ? "Processing..." : "Ingest Transcript"}
        </Button>
      </form>
    </Surface>
  );
}

// ── Quick Actions ─────────────────────────────────────────────────────

function QuickActionsPanel({
  onAction,
  disabled,
}: {
  onAction: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <Surface className="p-4 rounded-xl ring ring-kumo-line">
      <div className="flex items-center gap-2 mb-3">
        <LightningIcon size={16} className="text-kumo-accent" />
        <Text size="sm" bold>
          Quick Actions
        </Text>
      </div>
      <div className="space-y-1.5">
        {QUICK_ACTIONS.map(({ icon, text }) => (
          <button
            key={text}
            type="button"
            disabled={disabled}
            onClick={() => onAction(text)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left rounded-lg text-kumo-default hover:bg-kumo-elevated disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <span className="text-kumo-inactive shrink-0">{icon}</span>
            {text}
          </button>
        ))}
      </div>
    </Surface>
  );
}

// ── Main Workspace ───────────────────────────────────────────────────

function TeamWorkspace({
  teamId,
  onLeave,
}: {
  teamId: string;
  onLeave: () => void;
}) {
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const agent = useAgent<TeamAgent>({
    agent: "TeamAgent",
    name: teamId,
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onError: useCallback(
      (error: Event) => console.error("WebSocket error:", error),
      [],
    ),
  });

  const { messages, sendMessage, clearHistory, stop, status } =
    useAgentChat({ agent });

  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isStreaming]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, isStreaming, sendMessage]);

  const sendQuickAction = useCallback(
    (text: string) => {
      if (isStreaming) return;
      sendMessage({ role: "user", parts: [{ type: "text", text }] });
    },
    [isStreaming, sendMessage],
  );

  return (
    <div className="flex flex-col h-screen bg-kumo-elevated">
      {/* ── Header ── */}
      <header className="shrink-0 px-5 py-3 bg-kumo-base border-b border-kumo-line">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <ChatCircleDotsIcon
                size={20}
                weight="duotone"
                className="text-kumo-accent"
              />
              <h1 className="text-base font-semibold text-kumo-default">
                CortexMinutes
              </h1>
            </div>
            <Badge variant="secondary">
              <UsersIcon size={12} weight="bold" className="mr-1" />
              {teamId}
            </Badge>
            <div className="flex items-center gap-1.5 ml-1">
              <CircleIcon
                size={8}
                weight="fill"
                className={
                  connected ? "text-green-500" : "text-red-400"
                }
              />
              <Text size="xs" variant="secondary">
                {connected ? "Connected" : "Disconnected"}
              </Text>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<TrashIcon size={14} />}
              onClick={clearHistory}
            >
              Clear
            </Button>
            <ThemeToggle />
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowsClockwiseIcon size={14} />}
              onClick={onLeave}
            >
              Switch Team
            </Button>
          </div>
        </div>
      </header>

      {/* ── Body: Chat + Sidebar ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Chat */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-2xl mx-auto px-5 py-6 space-y-5">
              {messages.length === 0 && (
                <Empty
                  icon={<ChatCircleDotsIcon size={32} />}
                  title={`Welcome to ${teamId}'s space`}
                  contents={
                    <Text variant="secondary" size="sm">
                      Ingest meeting transcripts, then ask questions about
                      them. Use the quick actions on the right to get started.
                    </Text>
                  }
                />
              )}

              {messages.map((message: UIMessage, index: number) => {
                const isUser = message.role === "user";
                const isLastAssistant =
                  message.role === "assistant" &&
                  index === messages.length - 1;

                return (
                  <div key={message.id} className="space-y-2">
                    {message.parts.filter(isToolUIPart).map((part) => (
                      <ToolPartView key={part.toolCallId} part={part} />
                    ))}

                    {message.parts
                      .filter((part) => part.type === "text")
                      .map((part, i) => {
                        const text = (
                          part as { type: "text"; text: string }
                        ).text;
                        if (!text) return null;

                        // Skip raw tool-call JSON that Llama sometimes emits as plain text
                        if (!isUser && isRawToolCallText(text)) return null;

                        if (isUser) {
                          return (
                            <div key={i} className="flex justify-end">
                              <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-kumo-contrast text-kumo-inverse leading-relaxed text-sm">
                                {text}
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div key={i} className="flex justify-start">
                            <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-kumo-base text-kumo-default leading-relaxed">
                              <Streamdown
                                className="sd-theme rounded-2xl rounded-bl-md p-3"
                                plugins={{ code }}
                                controls={false}
                                isAnimating={
                                  isLastAssistant && isStreaming
                                }
                              >
                                {text}
                              </Streamdown>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                );
              })}

              {isStreaming && messages.length > 0 && (
                <div className="flex justify-start">
                  <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-kumo-base">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-kumo-inactive animate-bounce [animation-delay:0ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-kumo-inactive animate-bounce [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-kumo-inactive animate-bounce [animation-delay:300ms]" />
                      </div>
                      <Text size="xs" variant="secondary">
                        Thinking...
                      </Text>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-kumo-line bg-kumo-base">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="max-w-2xl mx-auto px-5 py-3"
            >
              <div className="flex items-end gap-3 rounded-xl border border-kumo-line bg-kumo-base p-3 shadow-sm focus-within:ring-2 focus-within:ring-kumo-ring focus-within:border-transparent transition-shadow">
                <InputArea
                  ref={textareaRef}
                  value={input}
                  onValueChange={setInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${el.scrollHeight}px`;
                  }}
                  placeholder="Ask about meetings, action items, or anything..."
                  disabled={!connected || isStreaming}
                  rows={1}
                  className="flex-1 ring-0! focus:ring-0! shadow-none! bg-transparent! outline-none! resize-none max-h-40"
                />
                {isStreaming ? (
                  <Button
                    type="button"
                    variant="secondary"
                    shape="square"
                    aria-label="Stop generation"
                    icon={<StopIcon size={18} />}
                    onClick={stop}
                    className="mb-0.5"
                  />
                ) : (
                  <Button
                    type="submit"
                    variant="primary"
                    shape="square"
                    aria-label="Send message"
                    disabled={!input.trim() || !connected}
                    icon={<PaperPlaneRightIcon size={18} />}
                    className="mb-0.5"
                  />
                )}
              </div>
            </form>
          </div>
        </div>

        {/* Right: Sidebar */}
        <aside className="hidden lg:flex flex-col w-80 shrink-0 border-l border-kumo-line bg-kumo-base overflow-y-auto">
          <div className="p-4 space-y-4">
            <MeetingPanel teamId={teamId} />
            <QuickActionsPanel
              onAction={sendQuickAction}
              disabled={!connected || isStreaming}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── App Root ──────────────────────────────────────────────────────────

export default function App() {
  const [teamId, setTeamId] = useState<string | null>(() => {
    return localStorage.getItem("cortexminutes:teamId");
  });

  const selectTeam = useCallback((id: string) => {
    localStorage.setItem("cortexminutes:teamId", id);
    setTeamId(id);
  }, []);

  const leaveTeam = useCallback(() => {
    localStorage.removeItem("cortexminutes:teamId");
    setTeamId(null);
  }, []);

  if (!teamId) {
    return <TeamSelector onSelect={selectTeam} />;
  }

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen text-kumo-inactive">
          Loading...
        </div>
      }
    >
      <TeamWorkspace teamId={teamId} onLeave={leaveTeam} />
    </Suspense>
  );
}
