import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  pruneMessages,
  stepCountIs,
  tool,
} from "ai";
import { z } from "zod";

// ── Constants ────────────────────────────────────────────────────────

const LLAMA_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const FALLBACK_MODEL = "@cf/meta/llama-3.1-8b-instruct";

const INGESTION_SYSTEM_PROMPT = `You process meeting transcripts. Respond with valid JSON only — no markdown fences, no commentary, no extra text.

Return exactly this shape:
{
  "summary": "A concise 3-5 sentence business-style summary of the meeting.",
  "actionItems": ["Action item 1", "Action item 2"]
}

Rules:
- The summary should capture key decisions, topics discussed, and outcomes.
- Each action item should be a clear, actionable task as a single string.
- If no action items are apparent, return an empty array.`;

const CHAT_SYSTEM_PROMPT = `You are CortexMinutes, an AI-powered team meeting memory assistant.

CRITICAL RULES:
1. You MUST call a tool for ANY question about meetings, action items, decisions, or tasks. Never guess.
2. You ALWAYS have the right tool available. NEVER say "your request is incomplete", "I need more details", or "my functions are insufficient". If a user message mentions meetings or action items, call the matching tool immediately.
3. After a tool returns data, summarize it in natural language. Never dump raw JSON.
4. If a tool returns no data, say so honestly (e.g. "No completed action items found.").

TOOL MAPPING — match the user's message to a tool call:
- "Show pending action items" / "pending tasks" / "what are my action items" → listActionItems with status "pending"
- "Show completed action items" / "completed tasks" / "done items" → listActionItems with status "completed"
- "Show all action items" → listActionItems with status "all"
- "Show recent meetings" / "recent meetings" / "latest meetings" → getRecentMeetings with count 5
- "What did we discuss last?" / "last meeting" / "most recent meeting" → getLastMeeting
- "Search for X" / "did we talk about X?" → queryMeetings with the keyword
- "Mark item #N as done" / "complete #N" → completeActionItem with that ID

RESPONSE FORMAT:
- Cite meeting titles and dates when referencing meetings.
- Format action items as "**#ID**: description (status)".
- Keep answers concise and professional.
- Use markdown bullet points for lists.`;

// ── Types ────────────────────────────────────────────────────────────

interface MeetingRow {
  id: string;
  title: string;
  transcript: string;
  summary: string;
  created_at: string;
}

interface ActionItemRow {
  id: number;
  meeting_id: string;
  description: string;
  status: string;
}

interface IngestionResult {
  meetingId: string;
  summary: string;
  actionItems: string[];
  aiProcessed: boolean;
}

// ── TeamAgent ────────────────────────────────────────────────────────

export class TeamAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;

  private ensureSchema() {
    this.sql`
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        transcript TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS action_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id TEXT NOT NULL REFERENCES meetings(id),
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      )
    `;
  }

  onStart() {
    this.ensureSchema();
  }

  // ── Meeting Ingestion ─────────────────────────────────────────────

  async ingestMeeting(title: string, transcript: string): Promise<IngestionResult> {
    this.ensureSchema();

    const meetingId = crypto.randomUUID();

    // Always persist the meeting row, even if AI fails later
    this.sql`
      INSERT INTO meetings (id, title, transcript, summary)
      VALUES (${meetingId}, ${title}, ${transcript}, ${""})
    `;

    const workersai = createWorkersAI({ binding: this.env.AI });
    const prompt = `Meeting title: ${title}\n\nTranscript:\n${transcript}`;

    const aiResult = await this.tryGenerateSummary(workersai, LLAMA_MODEL, prompt)
      ?? await this.tryGenerateSummary(workersai, FALLBACK_MODEL, prompt);

    if (!aiResult) {
      // Both models failed — degrade gracefully
      const placeholder = "AI summarization temporarily unavailable.";
      this.sql`UPDATE meetings SET summary = ${placeholder} WHERE id = ${meetingId}`;
      return { meetingId, summary: placeholder, actionItems: [], aiProcessed: false };
    }

    const { summary, actionItems } = aiResult;

    this.sql`UPDATE meetings SET summary = ${summary} WHERE id = ${meetingId}`;

    for (const description of actionItems) {
      const desc = description.trim();
      this.sql`
        INSERT INTO action_items (meeting_id, description, status)
        VALUES (${meetingId}, ${desc}, ${"pending"})
      `;
    }

    return { meetingId, summary, actionItems, aiProcessed: true };
  }

  private async tryGenerateSummary(
    workersai: ReturnType<typeof createWorkersAI>,
    model: string,
    prompt: string,
  ): Promise<{ summary: string; actionItems: string[] } | null> {
    try {
      const { text } = await generateText({
        model: workersai(model),
        system: INGESTION_SYSTEM_PROMPT,
        prompt,
      });

      const parsed = JSON.parse(text);
      const summary = typeof parsed.summary === "string" ? parsed.summary : "";
      const actionItems = Array.isArray(parsed.actionItems)
        ? parsed.actionItems.filter(
            (item: unknown): item is string =>
              typeof item === "string" && item.trim() !== "",
          )
        : [];

      return { summary, actionItems };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`AI call failed (${model}):`, errMsg);
      return null;
    }
  }

  // ── Chat Q&A ──────────────────────────────────────────────────────

  // Shared tool definitions — used by onChatMessage
  private get chatTools() {
    return {
      getLastMeeting: tool({
        description:
          "Get the single most recent meeting for this team. Use this when the user asks about the last meeting, most recent discussion, or what was discussed recently.",
        inputSchema: z.object({}),
        execute: async () => {
          try {
            const rows = this.sql<MeetingRow>`
              SELECT id, title, transcript, summary, created_at FROM meetings
              ORDER BY created_at DESC LIMIT 1
            `;

            if (rows.length === 0) {
              return { found: false, message: "No meetings have been ingested yet." };
            }

            const m = rows[0];
            return {
              found: true,
              id: m.id,
              title: m.title,
              summary: m.summary,
              createdAt: m.created_at,
              transcriptSnippet: m.transcript.slice(0, 500),
            };
          } catch (err) {
            console.error("getLastMeeting failed:", err);
            return { found: false, message: "Failed to fetch the last meeting." };
          }
        },
      }),

      listActionItems: tool({
        description:
          "List action items for this team. Call this whenever the user asks about action items, tasks, or to-dos. Use status 'pending' for open/pending tasks, 'completed' for done/completed tasks, or 'all' for everything.",
        inputSchema: z.object({
          status: z
            .enum(["pending", "completed", "all"])
            .describe("Filter: 'pending' for open tasks, 'completed' for done tasks, 'all' for both"),
        }),
        execute: async ({ status }) => {
          try {
            const rows =
              status === "all"
                ? this.sql<ActionItemRow>`
                    SELECT id, meeting_id, description, status FROM action_items
                    ORDER BY id DESC LIMIT 50
                  `
                : this.sql<ActionItemRow>`
                    SELECT id, meeting_id, description, status FROM action_items
                    WHERE status = ${status}
                    ORDER BY id DESC LIMIT 50
                  `;

            if (rows.length === 0) {
              return { found: false, message: `No ${status} action items found.` };
            }
            return {
              found: true,
              count: rows.length,
              items: rows.map((r) => ({
                id: r.id,
                meetingId: r.meeting_id,
                description: r.description,
                status: r.status,
              })),
            };
          } catch (err) {
            console.error("listActionItems failed:", err);
            return { found: false, message: "Failed to query action items." };
          }
        },
      }),

      completeActionItem: tool({
        description: "Mark a specific action item as completed by its numeric ID.",
        inputSchema: z.object({
          id: z.number().describe("The numeric ID of the action item to mark as completed"),
        }),
        execute: async ({ id }) => {
          try {
            const existing = this.sql<ActionItemRow>`
              SELECT id, description, status FROM action_items WHERE id = ${id}
            `;

            if (existing.length === 0) {
              return { success: false, message: `Action item #${id} not found.` };
            }
            if (existing[0].status === "completed") {
              return { success: true, message: `Action item #${id} is already completed.` };
            }

            this.sql`UPDATE action_items SET status = ${"completed"} WHERE id = ${id}`;

            return {
              success: true,
              message: `Marked #${id} ("${existing[0].description}") as completed.`,
            };
          } catch (err) {
            console.error("completeActionItem failed:", err);
            return { success: false, message: "Failed to update action item." };
          }
        },
      }),

      queryMeetings: tool({
        description:
          "Search meetings by a keyword in title, summary, or transcript. Use this when the user asks about a specific topic.",
        inputSchema: z.object({
          query: z.string().describe("The keyword or phrase to search for"),
        }),
        execute: async ({ query }) => {
          try {
            const pattern = `%${query}%`;
            const rows = this.sql<MeetingRow>`
              SELECT id, title, summary, created_at FROM meetings
              WHERE title LIKE ${pattern} OR summary LIKE ${pattern} OR transcript LIKE ${pattern}
              ORDER BY created_at DESC LIMIT 10
            `;

            if (rows.length === 0) {
              return { found: false, message: `No meetings found matching "${query}".` };
            }
            return {
              found: true,
              count: rows.length,
              meetings: rows.map((r) => ({
                id: r.id,
                title: r.title,
                summary: r.summary,
                createdAt: r.created_at,
              })),
            };
          } catch (err) {
            console.error("queryMeetings failed:", err);
            return { found: false, message: "Failed to search meetings." };
          }
        },
      }),

      getRecentMeetings: tool({
        description: "Get a list of the most recent meetings for this team. Call this when the user says 'show recent meetings', 'latest meetings', or asks what meetings have happened. Use count 5 as a sensible default.",
        inputSchema: z.object({
          count: z.number().describe("How many recent meetings to return (use 5 as default)"),
        }),
        execute: async ({ count }) => {
          try {
            const limit = Math.max(1, Math.min(count, 20));
            const rows = this.sql<MeetingRow>`
              SELECT id, title, summary, created_at FROM meetings
              ORDER BY created_at DESC LIMIT ${limit}
            `;

            if (rows.length === 0) {
              return { found: false, message: "No meetings have been ingested yet." };
            }
            return {
              found: true,
              count: rows.length,
              meetings: rows.map((r) => ({
                id: r.id,
                title: r.title,
                summary: r.summary,
                createdAt: r.created_at,
              })),
            };
          } catch (err) {
            console.error("getRecentMeetings failed:", err);
            return { found: false, message: "Failed to fetch recent meetings." };
          }
        },
      }),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async tryChat(
    workersai: ReturnType<typeof createWorkersAI>,
    model: string,
    opts: {
      messages: Awaited<ReturnType<typeof convertToModelMessages>>;
      tools: any;
      abortSignal?: AbortSignal;
    },
  ): Promise<string | null> {
    try {
      const { text } = await generateText({
        model: workersai(model),
        system: CHAT_SYSTEM_PROMPT,
        messages: opts.messages,
        tools: opts.tools,
        stopWhen: stepCountIs(6),
        abortSignal: opts.abortSignal,
      });
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`AI chat error (${model}):`, msg);
      return null;
    }
  }

  private sendTextResponse(text: string): Response {
    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        const id = crypto.randomUUID();
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: text });
        writer.write({ type: "text-end", id });
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    this.ensureSchema();

    const workersai = createWorkersAI({ binding: this.env.AI });
    const messages = pruneMessages({
      messages: await convertToModelMessages(this.messages),
      toolCalls: "before-last-2-messages",
    });
    const tools = this.chatTools;
    const chatOpts = { messages, tools, abortSignal: options?.abortSignal };

    // Try primary model, fall back to smaller model on failure (e.g. 504 timeout)
    const text =
      (await this.tryChat(workersai, LLAMA_MODEL, chatOpts)) ??
      (await this.tryChat(workersai, FALLBACK_MODEL, chatOpts));

    if (text === null) {
      return this.sendTextResponse(
        "I tried to reach the AI service but it timed out. Please try again in a moment.",
      );
    }

    const finalText = text.trim() || "I looked up the data but couldn't generate a response. Please try asking again.";
    return this.sendTextResponse(finalText);
  }
}

// ── Worker Fetch Handler ─────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname.startsWith("/api/team/")) {
      return handleMeetingIngestion(request, url, env);
    }

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;

// ── API Route Handlers ───────────────────────────────────────────────

async function handleMeetingIngestion(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  const segments = url.pathname.split("/");
  const teamId = segments[3];

  if (!teamId || segments[4] !== "meetings") {
    return jsonError("Invalid route. Expected /api/team/:teamId/meetings", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("title" in body) ||
    typeof (body as Record<string, unknown>).title !== "string" ||
    !("transcript" in body) ||
    typeof (body as Record<string, unknown>).transcript !== "string"
  ) {
    return jsonError("Invalid request body", 400);
  }

  const { title, transcript } = body as { title: string; transcript: string };

  if (!title.trim() || !transcript.trim()) {
    return jsonError("Invalid request body", 400);
  }

  const agentId = env.TeamAgent.idFromName(teamId);
  const stub = env.TeamAgent.get(agentId);

  const result = await stub.ingestMeeting(title.trim(), transcript.trim());
  return Response.json(result, { status: 200 });
}

function jsonError(message: string, status: number): Response {
  return Response.json({ success: false, error: message }, { status });
}
