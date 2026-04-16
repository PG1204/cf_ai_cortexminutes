import { routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";

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

// ── TeamAgent ────────────────────────────────────────────────────────
//
// Each team gets a distinct Durable Object instance (keyed by teamId),
// backed by its own SQLite database. The Agents SDK provides `this.sql`
// as the tagged-template SQL interface on SQLite-backed DOs.

export class TeamAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;

  /**
   * Initialize SQLite tables. Idempotent thanks to IF NOT EXISTS.
   */
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

  /**
   * Called once when the Durable Object is instantiated (or wakes from
   * hibernation). Sets up the schema before any requests are handled.
   */
  onStart() {
    this.ensureSchema();
  }

  // ── Meeting Ingestion ─────────────────────────────────────────────
  //
  // Called via RPC from the fetch handler. Inserts the meeting record
  // and (in a later step) will call an LLM to produce a summary and
  // extract action items.

  async ingestMeeting(title: string, transcript: string): Promise<MeetingRow> {
    this.ensureSchema();

    const id = crypto.randomUUID();

    // TODO: Call Llama 3.3 to generate summary + extract action items.
    // For now, store with an empty summary and no action items.
    const summary = "";

    this.sql`
      INSERT INTO meetings (id, title, transcript, summary)
      VALUES (${id}, ${title}, ${transcript}, ${summary})
    `;

    // TODO: Parse LLM response and insert action items:
    // this.sql`INSERT INTO action_items (meeting_id, description, status)
    //          VALUES (${id}, ${desc}, ${"pending"})`;

    return {
      id,
      title,
      transcript,
      summary,
      created_at: new Date().toISOString(),
    };
  }

  // ── Chat Q&A ──────────────────────────────────────────────────────
  //
  // Called by the Agents SDK when a WebSocket chat message arrives.
  // Will later use streamText with tools (queryMeetings, listActionItems,
  // completeActionItem) backed by the SQLite tables above.

  async onChatMessage(_onFinish: unknown, _options?: OnChatMessageOptions) {
    // TODO: Wire up Workers AI (Llama 3.3) with:
    //   - System prompt describing CortexMinutes
    //   - Tools that query/mutate the meetings & action_items tables
    //   - streamText() returning a UI message stream response
    return new Response("Chat not yet implemented", { status: 501 });
  }
}

// ── Worker Fetch Handler ─────────────────────────────────────────────
//
// Routes incoming requests:
//   POST /api/team/:teamId/meetings  → meeting ingestion via DO RPC
//   /agents/*                        → Agents SDK (WebSocket chat)
//   Everything else                  → 404 (static assets handled by wrangler)

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Meeting ingestion API
    if (request.method === "POST" && url.pathname.startsWith("/api/team/")) {
      return handleMeetingIngestion(request, url, env);
    }

    // Agent WebSocket / chat routes — routeAgentRequest maps the
    // request to the correct TeamAgent DO based on the agent name
    // passed by the client (which we set to the teamId).
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
  // Parse /api/team/:teamId/meetings
  const segments = url.pathname.split("/");
  const teamId = segments[3];

  if (!teamId || segments[4] !== "meetings") {
    return jsonError("Invalid route. Expected /api/team/:teamId/meetings", 400);
  }

  let body: { title?: string; transcript?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
    return jsonError("Missing or empty 'title' field", 400);
  }
  if (!body.transcript || typeof body.transcript !== "string" || !body.transcript.trim()) {
    return jsonError("Missing or empty 'transcript' field", 400);
  }

  // Resolve the DO instance for this team — idFromName ensures
  // the same teamId always maps to the same Durable Object.
  const agentId = env.TeamAgent.idFromName(teamId);
  const stub = env.TeamAgent.get(agentId);

  const meeting = await stub.ingestMeeting(body.title.trim(), body.transcript.trim());

  return Response.json({ success: true, meeting }, { status: 201 });
}

function jsonError(message: string, status: number): Response {
  return Response.json({ success: false, error: message }, { status });
}
