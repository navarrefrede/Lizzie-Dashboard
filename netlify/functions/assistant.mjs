/**
 * /api/assistant  (POST)
 * Receives a natural language message, calls Claude, Claude writes to Airtable.
 */

const BASE_ID       = "appoYAY87ApVe74NH";
const TASKS_TABLE   = "tblpvGShoT1jSFiYA";
const APPT_TABLE    = "tblYoE6gqRzz8HXzh";
const CLASS_TABLE   = "tblFjSCv9YnACEd4q";

const FIELD_IDS = {
  tasks: {
    name:      "fldk6OphWSvYXoNYJ",
    dueDate:   "fldfea7bOlQK5TE0b",
    priority:  "fldzrqF6ISwzI6qmT",
    category:  "fldomczJ8lj4xRr97",
    notes:     "fld9ZzSBewQrd7i6G",
    completed: "fldRKYOCp59dENISp",
  },
  appointments: {
    name:         "fldmQIVtP60Wck9Pq",
    dateTime:     "fld5vhy9VSh3gzTtH",
    doctor:       "fldK34rzQGn7T0NKs",
    type:         "fldEWuTLbZKnu2Wwp",
    location:     "fldmKEznTfJQYyVKK",
    status:       "fldwYB109tEq7nLQu",
    bookingNotes: "fldfp6gOkpJpDL7Cv",
  },
  classes: {
    name:     "fldx4BAewNWPaBjKZ",
    course:   "fldHLqS7HfP4OYeKL",
    dueDate:  "fld4NhdLNHqEE18q0",
    type:     "fldbinqAuEiTDAx1E",
    status:   "fldTEwMYSFhSGb1xU",
    priority: "fld1FqLHhdD51Y0co",
    notes:    "fldyQF8uk9Y6sixyV",
  },
};

const SYSTEM_PROMPT = `You are a helpful personal assistant managing Lizzie's life manager dashboard.
You have access to three Airtable tables: Tasks, Doctor Appointments, and Class Assignments.

Today's date is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.

When the user asks you to add, create, update, or manage items, respond with a JSON action object.
When the user just asks a question or chats, respond with a friendly plain text reply.

For actions, respond ONLY with valid JSON in this exact format (no markdown, no extra text):
{
  "action": "create_task" | "create_appointment" | "create_class",
  "data": { ...fields },
  "reply": "Friendly confirmation message to show the user"
}

Field formats:
- create_task: { name (required), dueDate (YYYY-MM-DD or null), priority ("Urgent"|"High"|"Medium"|"Low"|null), notes (string|null) }
- create_appointment: { name (required), dateTime (ISO 8601 or null), doctor (string|null), location (string|null), type (string|null), status ("Scheduled"|null), bookingNotes (string|null) }
- create_class: { name (required), course (string|null), dueDate (YYYY-MM-DD or null), type (string|null), priority ("High"|"Medium"|"Low"|null), notes (string|null) }

For plain conversation (no action needed), just reply with a friendly plain text string — no JSON.

Keep replies short, warm, and personal. You're talking to Lizzie.`;

async function callClaude(message, anthropicKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: message }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error: ${res.status}`);
  const data = await res.json();
  return data.content?.find(b => b.type === "text")?.text || "";
}

async function createAirtableRecord(tableId, fields, airtableKey) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${airtableKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  });
  if (!res.ok) throw new Error(`Airtable error: ${res.status}`);
  return res.json();
}

function buildTaskFields(data) {
  const f = {};
  if (data.name)     f[FIELD_IDS.tasks.name]      = data.name;
  if (data.dueDate)  f[FIELD_IDS.tasks.dueDate]   = data.dueDate;
  if (data.priority) f[FIELD_IDS.tasks.priority]  = data.priority;
  if (data.notes)    f[FIELD_IDS.tasks.notes]      = data.notes;
  f[FIELD_IDS.tasks.completed] = false;
  return f;
}

function buildApptFields(data) {
  const f = {};
  if (data.name)         f[FIELD_IDS.appointments.name]         = data.name;
  if (data.dateTime)     f[FIELD_IDS.appointments.dateTime]     = data.dateTime;
  if (data.doctor)       f[FIELD_IDS.appointments.doctor]       = data.doctor;
  if (data.location)     f[FIELD_IDS.appointments.location]     = data.location;
  if (data.type)         f[FIELD_IDS.appointments.type]         = data.type;
  if (data.status)       f[FIELD_IDS.appointments.status]       = data.status;
  if (data.bookingNotes) f[FIELD_IDS.appointments.bookingNotes] = data.bookingNotes;
  return f;
}

function buildClassFields(data) {
  const f = {};
  if (data.name)     f[FIELD_IDS.classes.name]     = data.name;
  if (data.course)   f[FIELD_IDS.classes.course]   = data.course;
  if (data.dueDate)  f[FIELD_IDS.classes.dueDate]  = data.dueDate;
  if (data.type)     f[FIELD_IDS.classes.type]     = data.type;
  if (data.priority) f[FIELD_IDS.classes.priority] = data.priority;
  if (data.notes)    f[FIELD_IDS.classes.notes]    = data.notes;
  return f;
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const airtableKey  = Netlify.env.get("AIRTABLE_API_KEY");

  if (!anthropicKey) return new Response(JSON.stringify({ error: "Missing ANTHROPIC_API_KEY" }), { status: 500, headers: { "Content-Type": "application/json" } });
  if (!airtableKey)  return new Response(JSON.stringify({ error: "Missing AIRTABLE_API_KEY" }),  { status: 500, headers: { "Content-Type": "application/json" } });

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const { message } = body;
  if (!message?.trim()) {
    return new Response(JSON.stringify({ error: "No message provided" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const raw = await callClaude(message.trim(), anthropicKey);

    // Try to parse as action JSON
    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch {
      // Plain text reply — no action
      return new Response(JSON.stringify({ reply: raw, action: null }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!parsed.action) {
      return new Response(JSON.stringify({ reply: parsed.reply || raw, action: null }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Execute the action
    let tableId, fields;
    if (parsed.action === "create_task") {
      tableId = TASKS_TABLE;
      fields  = buildTaskFields(parsed.data || {});
    } else if (parsed.action === "create_appointment") {
      tableId = APPT_TABLE;
      fields  = buildApptFields(parsed.data || {});
    } else if (parsed.action === "create_class") {
      tableId = CLASS_TABLE;
      fields  = buildClassFields(parsed.data || {});
    } else {
      return new Response(JSON.stringify({ reply: parsed.reply || "Done!", action: parsed.action }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    await createAirtableRecord(tableId, fields, airtableKey);

    return new Response(JSON.stringify({ reply: parsed.reply || "Done!", action: parsed.action, refresh: true }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("Assistant error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = { path: "/api/assistant" };
