# CortexMinutes

CortexMinutes is an AI-powered meeting memory for your team, built on Cloudflare Agents.  
Ingest meeting transcripts (including voice), then ask natural-language questions about what was discussed and what action items are pending. [web:185][web:205]

---

## Features

- **Per-team memory**  
  Each team (e.g. `engineering`, `marketing`, `sales`) gets its own long‑lived agent and SQLite-backed meeting history.

- **Meeting ingestion (text + voice)**  
  - Paste a transcript and ingest it.  
  - Or record audio in the browser; the app transcribes it to text and ingests as a meeting.

- **Question answering over meetings**  
  Ask questions like:
  - “What did we discuss last?”  
  - “Show recent meetings”  
  - “Show pending action items”  
  - “Show completed action items”  

- **Tool-backed answers**  
  The agent calls tools to:
  - Fetch the last meeting  
  - List or complete action items  
  - Search meetings by keyword  
  and then summarizes results in natural language.

- **Cloudflare-native stack**  
  - Cloudflare Agents SDK (Durable Agents)  
  - Workers AI (Llama 3.3 + fallback 3.1 models)  
  - SQLite for meeting + action item storage  
  - React UI with Kumo components

---

## Architecture

**Backend – `src/server.ts`**

- `TeamAgent` extends `AIChatAgent<Env>` and owns:
  - `meetings` table: `id`, `title`, `transcript`, `summary`, `created_at`.  
  - `action_items` table: `id`, `meeting_id`, `description`, `status`.  
- **Ingestion pipeline**:
  - Persists each meeting row up front.
  - Calls Workers AI with an ingestion system prompt to extract:
    - A 3–5 sentence summary.  
    - A list of action items.  
  - Uses a primary Llama 3.3 model with a Llama 3.1 fallback and robust JSON parsing (zod‑validated).  
  - If AI fails, stores a placeholder summary and continues.

- **Chat tools** (`chatTools`):
  - `getLastMeeting` – most recent meeting for the team.  
  - `getRecentMeetings` – latest N meetings.  
  - `listActionItems` – pending / completed / all items.  
  - `completeActionItem` – mark an item as done by ID.  
  - `queryMeetings` – search meetings by keyword.  
  Each tool returns a simple `{ ok, data?, error? }` shape for the model to consume.

- **Chat logic**:
  - Uses `generateText` with tools enabled, plus a strict `CHAT_SYSTEM_PROMPT` that:
    - Forces tool usage for meeting/action-item questions.  
    - Forbids leaking raw tool JSON into replies.  
    - Instructs the model to explain tool errors in natural language rather than exposing internals.

**Frontend – `src/app.tsx`**

- **Team selector**  
  - Lets you pick from preset teams or enter a custom team ID.  
  - Persists the chosen team in `localStorage`.

- **MeetingPanel**  
  - Title + transcript fields.  
  - Voice ingestion:
    - Records via the browser microphone (MediaRecorder).  
    - Sends audio to a transcription endpoint.  
    - Fills the transcript textarea with the recognized text.  
  - Calls `/api/team/:teamId/meetings` and shows:
    - A success banner with the number of extracted action items.  
    - A special note if AI summarization was unavailable.  
    - Inline error messages on invalid input or server errors.

- **Chat workspace**  
  - Uses `useAgent` and `useAgentChat` to connect to `TeamAgent`.  
  - Shows:
    - User bubbles on the right.  
    - Assistant bubbles on the left, rendered via `Streamdown` for markdown.  
    - Tool activity chips (“Fetching action items”, “Looking up last meeting”) instead of raw JSON.  
  - Filters out leaked tool-call text and replaces it with a friendly fallback message if needed.

- **Sidebar**  
  - Quick Actions panel with buttons for:
    - “Show pending action items”  
    - “What did we discuss last?”  
    - “Show recent meetings”  
    - “Show completed action items”  

**Client entry – `src/client.tsx`**

- Imports `./styles.css`, mounts `<App />` into `#root`, and guards against a missing root element.

---

## Getting started

### Prerequisites

- Node.js and npm  
- Cloudflare account  
- Wrangler CLI installed: [Cloudflare Workers quickstart](https://developers.cloudflare.com/agents/getting-started/quick-start/) [web:202]

### Install and run locally

```bash
npm install
npm run dev
```

Then open the dev server URL that Wrangler prints (typically `http://localhost:8788`).

---

## How to use / demo

1. **Select a team**  
   - On first load, choose a preset team like `engineering` or enter a custom name.  
   - The selected team is shown in the header and remembered for next time.

2. **Ingest a meeting (text)**  
   - In the “Ingest Meeting” panel:  
     - Enter a title (e.g., “Sprint planning – April 2026”).  
     - Paste a transcript into the textarea.  
     - Click “Ingest Transcript”.  
   - You’ll see a banner like:  
     - `"Sprint planning – April 2026" ingested — 3 action items extracted.`  
     - If AI is unavailable, the banner notes that summarization is temporarily unavailable.

3. **Ingest a meeting (voice)**  
   - Click “Record voice transcript”.  
   - Speak a short summary of the meeting.  
   - Stop recording; the transcript textarea is filled with the recognized text.  
   - Edit if needed, then click “Ingest Transcript” as above.

4. **Ask questions in chat**  
   Try questions like:

   - “What did we discuss last?”  
   - “Show recent meetings.”  
   - “Show pending action items.”  
   - “Show completed action items.”  

   The agent will call tools to fetch data and reply with concise summaries, citing meeting titles and dates where possible.

5. **Use Quick Actions**  
   - On the right-hand side, use the quick action buttons to send those same queries with one click.

---

## Configuration

Key config lives in `wrangler.toml` / `wrangler.jsonc`:

- AI binding for Workers AI models, referenced as `env.AI` in `server.ts`. [web:185][web:205]  
- `TeamAgent` binding defining the Durable Agent class and namespace.

No extra API keys are required when using Workers AI on Cloudflare.

---

## AI assistance and prompts

This project was built with help from AI coding assistants. AI was used to:

- Adapt the Cloudflare `agents-starter` template into a team meeting memory app.  
- Design the `meetings` and `action_items` schema and tools.  
- Implement robust ingestion (with JSON validation, fallbacks, and logging).  
- Wire up the React chat UI, voice transcription flow, and tool activity indicators.  
- Perform final error-handling and prompt-tuning passes.

A more detailed list of prompts and iterations is captured in `PROMPTS.md`.

---

## Deploy

```bash
npm run deploy
```

Wrangler will deploy the agent to Cloudflare’s global network. Meeting data is stored in SQLite, and `TeamAgent` instances hibernate when idle and resume when new requests arrive. [web:185]

---

## Learn more

- [Agents SDK documentation](https://developers.cloudflare.com/agents/)  
- [Chat agents API reference](https://developers.cloudflare.com/agents/api-reference/chat-agents/)  
- [Using AI models on Cloudflare](https://developers.cloudflare.com/agents/api-reference/using-ai-models/)  
- [Workers AI models](https://developers.cloudflare.com/workers-ai/models/)