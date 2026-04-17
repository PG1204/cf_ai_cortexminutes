# Prompts used to build CortexMinutes

This file lists the main prompts used with AI coding assistants while building this project.  
Prompts are grouped roughly in the order they were used.

---

## 1. Adapting the Cloudflare agents starter

**Prompt**

> I cloned the Cloudflare `agents-starter` template. I want to turn it into “CortexMinutes”: a per-team meeting memory app where each team has its own agent, I can ingest meeting transcripts, and then ask questions about what we discussed and which action items are pending or completed.  
>  
> Please outline which parts of the starter I should keep (Agents wiring, Kumo UI, etc.) and what I should remove or replace. Then propose the main components and files I’ll need.

---

## 2. Designing the TeamAgent and schema

**Prompt**

> I want a `TeamAgent` that manages meeting history for a single team using Cloudflare Agents and SQLite.  
>  
> Design the schema for two tables:
> - `meetings`: id, title, transcript, summary, created_at  
> - `action_items`: id, meeting_id, description, status (`pending` or `completed`)  
>  
> Then show how to define a `TeamAgent` class in `server.ts` that:
> - Ensures the tables exist on startup.  
> - Exposes an `ingestMeeting(title, transcript)` method that inserts a row and returns a summary + extracted action items.

---

## 3. Ingestion with Workers AI and robust JSON parsing

**Prompt**

> In my `TeamAgent.ingestMeeting(title, transcript)` method, I want to call Workers AI (Llama) to generate a summary and action items from the transcript.  
>  
> Requirements:
> - Use a system prompt that tells the model to return JSON only with the shape:  
>   `{ "summary": string, "actionItems": string[] }`.  
> - Use a primary Llama 3.3 model and a fallback smaller Llama model if the first call fails.  
> - Add a helper that can parse JSON even if the model wraps it in backticks or extra text.  
> - Validate the parsed JSON with zod before trusting it.  
> - If both models fail or the JSON shape is invalid, store a placeholder summary and no action items.
>  
> Please write the `INGESTION_SYSTEM_PROMPT`, the helper function, and the `tryGenerateSummary` logic, and show how they plug into `ingestMeeting`.

---

## 4. Tools and chat system prompt

**Prompt**

> I want chat over this meeting data using Cloudflare’s `AIChatAgent` and the `ai` SDK tools API.  
>  
> Define tools on `TeamAgent` for:
> - `getLastMeeting()` – return the most recent meeting for the team.  
> - `getRecentMeetings(count)` – latest N meetings.  
> - `listActionItems(status)` – status in `pending | completed | all`.  
> - `completeActionItem(id)` – mark an action item as completed.  
> - `queryMeetings(query)` – search title, summary, transcript with a LIKE query.  
>  
> Each tool should:
> - Use parameterized SQL queries, return simple JSON objects, and handle “no rows found” gracefully.  
> - Return a normalized shape like `{ ok: boolean, data?: ..., error?: string }`.  
>  
> Then write a `CHAT_SYSTEM_PROMPT` that:
> - Forces the model to call tools for any question about meetings or action items.  
> - Maps common phrases (“What did we discuss last?”, “Show recent meetings”, “Show pending action items”, “Show completed action items”) to the appropriate tools.  
> - Instructs the model to summarize tool results in natural language and never dump raw JSON.

---

## 5. Wiring chat with generateText and tools

**Prompt**

> In `TeamAgent.onChatMessage`, I want to use the `ai` SDK’s `generateText` to:
> - Convert persisted agent messages to model messages.  
> - Attach the tools we defined.  
> - Allow the model to call tools internally and then send back a final assistant message.  
>  
> Please show a `tryChat` helper that:
> - Accepts a model name, messages, tools, and an abortSignal.  
> - Calls `generateText` with `system: CHAT_SYSTEM_PROMPT`, the messages, the tools, and a reasonable step limit.  
> - Returns the final text or `null` on error.  
>  
> Then show `onChatMessage` using a primary Workers AI Llama model and a fallback model, plus a streaming UI response.

---

## 6. React chat UI and tool rendering

**Prompt**

> I have a React app using `useAgent` and `useAgentChat` to talk to `TeamAgent`.  
>  
> I want the chat UI to:
> - Render user messages on the right, assistant messages on the left with markdown.  
> - Show tool activity as subtle status chips (e.g. “Fetching action items”) rather than dumping tool JSON.  
> - Hide any leaked tool-call JSON the model might emit (for example `{"name":"getLastMeeting","parameters":{}}`).  
>  
> Please update `src/app.tsx` to:
> - Add a `ToolPartView` component that renders a small chip for each tool call state (running / completed).  
> - Add a helper that detects leaked tool-call text and skips or replaces it with a friendly fallback message.

---

## 7. Voice ingestion with MediaRecorder

**Prompt**

> In `MeetingPanel` in `src/app.tsx`, add support for voice-based ingestion.  
>  
> Requirements:
> - Add a “Record voice transcript” button near the transcript textarea.  
> - Use the browser `MediaRecorder` API to record microphone audio.  
> - On stop, send the audio Blob to a `/api/transcribe` endpoint and get back `{ text }`.  
> - Insert the returned text into the transcript textarea (append if there is existing text).  
> - Keep the existing text-based ingestion flow unchanged; still POST `{ title, transcript }` to `/api/team/:teamId/meetings`.  
> - Show friendly error messages if microphone access is denied or transcription fails.
>  
> Please implement the React state and event handlers in `MeetingPanel` and a minimal fetch call to `/api/transcribe`.

---

## 8. Debugging tool call leaks

**Prompt**

> In the chat UI, when I ask “What did we discuss last?” I sometimes see assistant messages like:  
> `Your function call is {"name": "getLastMeeting", "parameters": {}}`  
> or  
> `I didn't receive a tool call response.`
>  
> I want to:
> - Stop the model from emitting raw tool-call JSON or narrating tool calls.  
> - Filter any remaining leaked text on the frontend.  
>  
> Please:
> - Strengthen `CHAT_SYSTEM_PROMPT` to explicitly forbid output like “Your function call is …” or raw `{"name": ...}`.  
> - Add a helper `isLeakedToolCall(text)` in `app.tsx` that detects:
>   - Embedded `{"name": "...", "parameters": ...}` JSON.  
>   - Phrases like “function call” + `name`.  
>   - Phrases like “didn't receive a tool call response”.  
> - When such text is detected in an assistant message, replace the bubble with a generic friendly response instead of showing the raw internal text.

---

## 9. Final robustness and README

**Prompt**

> The code is working end-to-end for CortexMinutes (ingestion, tools, chat, and voice).  
> I want a final polish pass to make it production/demo ready.  
>  
> Please:
> - Review `server.ts` and suggest any improvements for error handling, logging, and response shapes.  
> - Ensure ingestion and chat have clear fallback behavior when Workers AI fails.  
> - Propose a README structure specific to CortexMinutes (features, architecture, how to demo, configuration) to replace the generic `agents-starter` README, and draft the content.

---

These are the main prompts that shaped the project. Smaller follow-up prompts (e.g., minor copy changes or renaming variables) are not listed here to keep the file readable.