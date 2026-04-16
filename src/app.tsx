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
} from "@phosphor-icons/react";

// ── Small components ──────────────────────────────────────────────────

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-mode") === "dark"
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

// ── Tool rendering ────────────────────────────────────────────────────

function ToolPartView({ part }: { part: UIMessage["parts"][number] }) {
  if (!isToolUIPart(part)) return null;
  const toolName = getToolName(part);

  if (part.state === "output-available") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2 mb-1">
            <GearIcon size={14} className="text-kumo-inactive" />
            <Text size="xs" variant="secondary" bold>
              {toolName}
            </Text>
            <Badge variant="secondary">Done</Badge>
          </div>
          <div className="font-mono">
            <Text size="xs" variant="secondary">
              {JSON.stringify(part.output, null, 2)}
            </Text>
          </div>
        </Surface>
      </div>
    );
  }

  if (part.state === "input-available" || part.state === "input-streaming") {
    return (
      <div className="flex justify-start">
        <Surface className="max-w-[85%] px-4 py-2.5 rounded-xl ring ring-kumo-line">
          <div className="flex items-center gap-2">
            <GearIcon size={14} className="text-kumo-inactive animate-spin" />
            <Text size="xs" variant="secondary">
              Running {toolName}...
            </Text>
          </div>
        </Surface>
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
          <h1 className="text-2xl font-bold text-kumo-default mb-2">
            CortexMinutes
          </h1>
          <Text variant="secondary">
            Enter your team ID to access meetings, action items, and chat.
          </Text>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = value.trim();
            if (trimmed) {
              onSelect(trimmed);
            }
          }}
          className="space-y-4"
        >
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. engineering, product, design"
            autoFocus
            className="w-full px-4 py-3 text-sm rounded-xl border border-kumo-line bg-kumo-base text-kumo-default placeholder:text-kumo-inactive focus:outline-none focus:ring-2 focus:ring-kumo-accent"
          />
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={!value.trim()}
          >
            Enter Team Space
          </Button>
        </form>
      </Surface>
    </div>
  );
}

// ── Meeting Ingestion Panel ───────────────────────────────────────────

function MeetingPanel({
  teamId,
  onIngested,
}: {
  teamId: string;
  onIngested: () => void;
}) {
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
      const res = await fetch(`/api/team/${encodeURIComponent(teamId)}/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), transcript: transcript.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Request failed" })) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setSuccess(`Meeting "${title.trim()}" ingested successfully.`);
      setTitle("");
      setTranscript("");
      onIngested();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
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
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Meeting title"
          className="w-full px-3 py-2 text-sm rounded-lg border border-kumo-line bg-kumo-base text-kumo-default placeholder:text-kumo-inactive focus:outline-none focus:ring-1 focus:ring-kumo-accent"
        />
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Paste meeting transcript here..."
          rows={5}
          className="w-full px-3 py-2 text-sm rounded-lg border border-kumo-line bg-kumo-base text-kumo-default placeholder:text-kumo-inactive focus:outline-none focus:ring-1 focus:ring-kumo-accent resize-y"
        />
        {error && (
          <div className="text-red-500">
            <Text size="xs">{error}</Text>
          </div>
        )}
        {success && (
          <div className="text-green-500">
            <Text size="xs">{success}</Text>
          </div>
        )}
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={submitting || !title.trim() || !transcript.trim()}
        >
          {submitting ? "Processing..." : "Ingest Transcript"}
        </Button>
      </form>
    </Surface>
  );
}

// ── Main Chat ─────────────────────────────────────────────────────────

function TeamWorkspace({ teamId, onLeave }: { teamId: string; onLeave: () => void }) {
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [showIngest, setShowIngest] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const agent = useAgent<TeamAgent>({
    agent: "TeamAgent",
    name: teamId,
    onOpen: useCallback(() => setConnected(true), []),
    onClose: useCallback(() => setConnected(false), []),
    onError: useCallback(
      (error: Event) => console.error("WebSocket error:", error),
      []
    ),
  });

  const {
    messages,
    sendMessage,
    clearHistory,
    stop,
    status,
  } = useAgentChat({ agent });

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

  return (
    <div className="flex flex-col h-screen bg-kumo-elevated">
      {/* Header */}
      <header className="px-5 py-4 bg-kumo-base border-b border-kumo-line">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-kumo-default">
              CortexMinutes
            </h1>
            <Badge variant="secondary">
              <ChatCircleDotsIcon size={12} weight="bold" className="mr-1" />
              {teamId}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <CircleIcon
                size={8}
                weight="fill"
                className={connected ? "text-kumo-success" : "text-kumo-danger"}
              />
              <Text size="xs" variant="secondary">
                {connected ? "Connected" : "Disconnected"}
              </Text>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<NotePencilIcon size={14} />}
              onClick={() => setShowIngest(!showIngest)}
            >
              Ingest
            </Button>
            <ThemeToggle />
            <Button
              variant="secondary"
              size="sm"
              icon={<TrashIcon size={14} />}
              onClick={clearHistory}
            >
              Clear
            </Button>
            <Button variant="secondary" size="sm" onClick={onLeave}>
              Switch Team
            </Button>
          </div>
        </div>
      </header>

      {/* Ingest panel (collapsible) */}
      {showIngest && (
        <div className="max-w-3xl mx-auto w-full px-5 pt-4">
          <MeetingPanel
            teamId={teamId}
            onIngested={() => setShowIngest(false)}
          />
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-6 space-y-5">
          {messages.length === 0 && (
            <Empty
              icon={<ChatCircleDotsIcon size={32} />}
              title={`Welcome to ${teamId}'s space`}
              contents={
                <div className="space-y-3">
                  <Text variant="secondary" size="sm">
                    Ingest meeting transcripts, then ask questions about them.
                  </Text>
                  <div className="flex flex-wrap justify-center gap-2">
                    {[
                      { icon: <ListChecksIcon size={14} />, text: "Show pending action items" },
                      { icon: <MagnifyingGlassIcon size={14} />, text: "What did we discuss last?" },
                    ].map(({ icon, text }) => (
                      <Button
                        key={text}
                        variant="outline"
                        size="sm"
                        icon={icon}
                        disabled={isStreaming}
                        onClick={() => {
                          sendMessage({
                            role: "user",
                            parts: [{ type: "text", text }],
                          });
                        }}
                      >
                        {text}
                      </Button>
                    ))}
                  </div>
                </div>
              }
            />
          )}

          {messages.map((message: UIMessage, index: number) => {
            const isUser = message.role === "user";
            const isLastAssistant =
              message.role === "assistant" && index === messages.length - 1;

            return (
              <div key={message.id} className="space-y-2">
                {/* Tool parts */}
                {message.parts.filter(isToolUIPart).map((part) => (
                  <ToolPartView key={part.toolCallId} part={part} />
                ))}

                {/* Text parts */}
                {message.parts
                  .filter((part) => part.type === "text")
                  .map((part, i) => {
                    const text = (part as { type: "text"; text: string }).text;
                    if (!text) return null;

                    if (isUser) {
                      return (
                        <div key={i} className="flex justify-end">
                          <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-md bg-kumo-contrast text-kumo-inverse leading-relaxed">
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
                            isAnimating={isLastAssistant && isStreaming}
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

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-kumo-line bg-kumo-base">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="max-w-3xl mx-auto px-5 py-4"
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
  );
}

// ── App Root ──────────────────────────────────────────────────────────

export default function App() {
  const [teamId, setTeamId] = useState<string | null>(() => {
    // Persist team selection across page reloads
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
