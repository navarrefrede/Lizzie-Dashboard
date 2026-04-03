export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // All env vars read inside handler per Netlify guidelines
  const anthropicKey = Netlify.env.get("ANTHROPIC_API_KEY");
  const airtableKey  = Netlify.env.get("AIRTABLE_PAT");

  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: "Missing ANTHROPIC_API_KEY" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
  if (!airtableKey) {
    return new Response(JSON.stringify({ error: "Missing AIRTABLE_PAT" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const message = (body.message || "").trim();
  if (!message) {
    return new Response(JSON.stringify({ error: "No message provided" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  // Constants inside handler
  const BASE_ID     = "appoYAY87ApVe74NH";
  const TABLES      = { tasks: "tblpvGShoT1jSFiYA", appointments: "tblYoE6gqRzz8HXzh", classes: "tblFjSCv9YnACEd4q" };
  const FIELDS = {
    tasks:        { name: "fldk6OphWSvYXoNYJ", dueDate: "fldfea7bOlQK5TE0b", priority: "fldzrqF6ISwzI6qmT", notes: "fld9ZzSBewQrd7i6G", completed: "fldRKYOCp59dENISp" },
    appointments: { name: "fldmQIVtP60Wck9Pq", dateTime: "fld5vhy9VSh3gzTtH", doctor: "fldK34rzQGn7T0NKs", type: "fldEWuTLbZKnu2Wwp", location: "fldmKEznTfJQYyVKK", status: "fldwYB109tEq7nLQu", bookingNotes: "fldfp6gOkpJpDL7Cv" },
    classes:      { name: "fldx4BAewNWPaBjKZ", course: "fldHLqS7HfP4OYeKL", dueDate: "fld4NhdLNHqEE18q0", type: "fldbinqAuEiTDAx1E", status: "fldTEwMYSFhSGb1xU", priority: "fld1FqLHhdD51Y0co", notes: "fldyQF8uk9Y6sixyV" }
  };

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const systemPrompt = `You are a helpful personal assistant managing Lizzie's life manager dashboard.
You have access to three Airtable tables: Tasks, Doctor Appointments, and Class Assignments.
Today's date is ${today}.

When the user asks you to add, create, or manage items, respond ONLY with valid JSON (no markdown, no extra text):
{
  "action": "create_task" | "create_appointment" | "create_class",
  "data": { ...fields },
  "reply": "Short friendly confirmation for Lizzie"
}

Field formats:
- create_task: { name (required), dueDate ("YYYY-MM-DD" or null), priority ("Urgent"|"High"|"Medium"|"Low"|null), notes (string|null) }
- create_appointment: { name (required), dateTime ("ISO 8601" or null), doctor (string|null), location (string|null), type (string|null), status ("Scheduled"|null), bookingNotes (string|null) }
- create_class: { name (required), course (string|null), dueDate ("YYYY-MM-DD" or null), type (string|null), priority ("High"|"Medium"|"Low"|null), notes (string|null) }

For casual chat or questions (no action needed), reply with plain text only — no JSON.
Keep replies warm and personal. You're talking to Lizzie.`;

  // Call Claude
  let claudeText;
  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: "user", content: message }],
      }),
    });
    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API ${claudeRes.status}: ${errText}`);
    }
    const claudeData = await claudeRes.json();
    claudeText = claudeData.content?.find(b => b.type === "text")?.text || "";
  } catch (e) {
    return new Response(JSON.stringify({ error: "Claude API error: " + e.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  // Try to parse as action JSON
  let parsed = null;
  try {
    const cleaned = claudeText.replace(/```json|```/g, "").trim();
    if (cleaned.startsWith("{")) {
      parsed = JSON.parse(cleaned);
    }
  } catch {
    // Not JSON — plain text reply
  }

  if (!parsed || !parsed.action) {
    return new Response(JSON.stringify({ reply: claudeText, action: null }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Build Airtable fields from parsed data
  const d = parsed.data || {};
  let tableId, fields = {};

  if (parsed.action === "create_task") {
    tableId = TABLES.tasks;
    if (d.name)     fields[FIELDS.tasks.name]      = d.name;
    if (d.dueDate)  fields[FIELDS.tasks.dueDate]   = d.dueDate;
    if (d.priority) fields[FIELDS.tasks.priority]  = d.priority;
    if (d.notes)    fields[FIELDS.tasks.notes]     = d.notes;
    fields[FIELDS.tasks.completed] = false;

  } else if (parsed.action === "create_appointment") {
    tableId = TABLES.appointments;
    if (d.name)         fields[FIELDS.appointments.name]         = d.name;
    if (d.dateTime)     fields[FIELDS.appointments.dateTime]     = d.dateTime;
    if (d.doctor)       fields[FIELDS.appointments.doctor]       = d.doctor;
    if (d.location)     fields[FIELDS.appointments.location]     = d.location;
    if (d.type)         fields[FIELDS.appointments.type]         = d.type;
    if (d.status)       fields[FIELDS.appointments.status]       = d.status;
    if (d.bookingNotes) fields[FIELDS.appointments.bookingNotes] = d.bookingNotes;

  } else if (parsed.action === "create_class") {
    tableId = TABLES.classes;
    if (d.name)     fields[FIELDS.classes.name]     = d.name;
    if (d.course)   fields[FIELDS.classes.course]   = d.course;
    if (d.dueDate)  fields[FIELDS.classes.dueDate]  = d.dueDate;
    if (d.type)     fields[FIELDS.classes.type]     = d.type;
    if (d.priority) fields[FIELDS.classes.priority] = d.priority;
    if (d.notes)    fields[FIELDS.classes.notes]    = d.notes;

  } else {
    return new Response(JSON.stringify({ reply: parsed.reply || "Done!", action: parsed.action }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  // Write to Airtable
  try {
    const atRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${airtableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });
    if (!atRes.ok) {
      const errText = await atRes.text();
      throw new Error(`Airtable ${atRes.status}: ${errText}`);
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: "Airtable error: " + e.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ reply: parsed.reply || "Done!", action: parsed.action, refresh: true }), {
    headers: { "Content-Type": "application/json" }
  });
};

export const config = { path: "/api/assistant" };
