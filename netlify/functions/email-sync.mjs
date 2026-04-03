import { Netlify } from "@netlify/functions";

// Runs every morning at 8am ET (1pm UTC)
export const config = {
  schedule: "0 13 * * *",
  path: "/.netlify/functions/email-sync",
};

// ── helpers ──────────────────────────────────────────────────────────────────

async function getGmailAccessToken(clientId, clientSecret, refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

async function searchGmail(accessToken, query) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail search failed: ${await res.text()}`);
  const data = await res.json();
  return data.messages || [];
}

async function getMessageBody(accessToken, messageId) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail fetch failed: ${await res.text()}`);
  const msg = await res.json();

  // Extract subject
  const headers = msg.payload?.headers || [];
  const subject = headers.find(h => h.name === "Subject")?.value || "";
  const from    = headers.find(h => h.name === "From")?.value || "";
  const date    = headers.find(h => h.name === "Date")?.value || "";

  // Extract plain text body
  function extractText(part) {
    if (!part) return "";
    if (part.mimeType === "text/plain" && part.body?.data) {
      return Buffer.from(part.body.data, "base64").toString("utf-8");
    }
    if (part.parts) {
      return part.parts.map(extractText).join("\n");
    }
    return "";
  }

  const body = extractText(msg.payload);
  return { subject, from, date, body: body.slice(0, 2000) }; // cap at 2000 chars
}

async function parseWithClaude(anthropicKey, emails, today) {
  const emailSummaries = emails.map((e, i) =>
    `Email ${i + 1}:\nFrom: ${e.from}\nDate: ${e.date}\nSubject: ${e.subject}\nBody:\n${e.body}`
  ).join("\n\n---\n\n");

  const systemPrompt = `You are parsing emails to extract doctor/medical appointments and important scheduled events for Lizzie's life manager.

Today is ${today}.

Look through these emails and extract any appointments, bookings, or scheduled events. For each one found, return a JSON array:
[
  {
    "name": "appointment name/type (e.g. 'Dermatology Appointment', 'Dentist Checkup')",
    "dateTime": "ISO 8601 format if found, else null",
    "doctor": "doctor or provider name if found, else null",
    "location": "location/address if found, else null",
    "type": "appointment type if clear, else null",
    "status": "Scheduled",
    "bookingNotes": "any relevant notes like confirmation number, instructions, else null"
  }
]

If no appointments are found, return an empty array: []
Return ONLY valid JSON, no markdown, no extra text.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: emailSummaries }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API error: ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.find(b => b.type === "text")?.text || "[]";

  try {
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    console.error("Claude returned non-JSON:", text);
    return [];
  }
}

async function getExistingAppointments(airtableKey, baseId, tableId) {
  const res = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}`, {
    headers: { Authorization: `Bearer ${airtableKey}` },
  });
  if (!res.ok) throw new Error(`Airtable fetch failed: ${await res.text()}`);
  const data = await res.json();
  return data.records || [];
}

async function createAirtableRecord(airtableKey, baseId, tableId, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${airtableKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  });
  if (!res.ok) throw new Error(`Airtable create failed: ${await res.text()}`);
  return res.json();
}

// ── main handler ─────────────────────────────────────────────────────────────

export default async () => {
  const anthropicKey  = (Netlify.env.get("ANTHROPIC_API_KEY") || "").trim();
  const airtableKey   = Netlify.env.get("AIRTABLE_PAT");
  const gmailClientId = Netlify.env.get("GMAIL_CLIENT_ID");
  const gmailSecret   = Netlify.env.get("GMAIL_CLIENT_SECRET");
  const gmailRefresh  = Netlify.env.get("GMAIL_REFRESH_TOKEN");

  if (!anthropicKey || !airtableKey || !gmailClientId || !gmailSecret || !gmailRefresh) {
    console.error("Missing required environment variables");
    return new Response("Missing env vars", { status: 500 });
  }

  const BASE_ID    = "appoYAY87ApVe74NH";
  const APPT_TABLE = "tblYoE6gqRzz8HXzh";
  const FIELDS = {
    name:         "fldmQIVtP60Wck9Pq",
    dateTime:     "fld5vhy9VSh3gzTtH",
    doctor:       "fldK34rzQGn7T0NKs",
    type:         "fldEWuTLbZKnu2Wwp",
    location:     "fldmKEznTfJQYyVKK",
    status:       "fldwYB109tEq7nLQu",
    bookingNotes: "fldfp6gOkpJpDL7Cv",
  };

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  console.log(`[email-sync] Running at ${today}`);

  try {
    // 1. Get Gmail access token
    const accessToken = await getGmailAccessToken(gmailClientId, gmailSecret, gmailRefresh);

    // 2. Search for appointment-related emails from last 24 hours
    const query = "newer_than:1d (appointment OR booking OR confirmation OR scheduled OR reminder OR doctor OR dentist OR clinic OR medical OR prescription) -category:promotions -category:social";
    const messages = await searchGmail(accessToken, query);
    console.log(`[email-sync] Found ${messages.length} candidate emails`);

    if (messages.length === 0) {
      console.log("[email-sync] No relevant emails found, done.");
      return new Response("No emails found", { status: 200 });
    }

    // 3. Fetch email bodies (up to 10 to avoid hitting Claude limits)
    const emailBodies = [];
    for (const msg of messages.slice(0, 10)) {
      try {
        const body = await getMessageBody(accessToken, msg.id);
        emailBodies.push(body);
      } catch (e) {
        console.warn(`Could not fetch message ${msg.id}:`, e.message);
      }
    }

    // 4. Parse with Claude
    const appointments = await parseWithClaude(anthropicKey, emailBodies, today);
    console.log(`[email-sync] Claude extracted ${appointments.length} appointments`);

    if (appointments.length === 0) {
      console.log("[email-sync] No appointments found in emails, done.");
      return new Response("No appointments extracted", { status: 200 });
    }

    // 5. Get existing appointments to avoid duplicates
    const existing = await getExistingAppointments(airtableKey, BASE_ID, APPT_TABLE);
    const existingNames = existing.map(r =>
      (r.fields[FIELDS.name] || "").toLowerCase().trim()
    );

    // 6. Create new records, skipping duplicates
    let created = 0;
    let skipped = 0;
    for (const appt of appointments) {
      const nameKey = (appt.name || "").toLowerCase().trim();

      // Simple duplicate check: same name and within same day
      const isDuplicate = existing.some(r => {
        const existingName = (r.fields[FIELDS.name] || "").toLowerCase().trim();
        const existingDT   = r.fields[FIELDS.dateTime] || "";
        const apptDT       = appt.dateTime || "";
        const sameDay = apptDT && existingDT
          ? apptDT.slice(0, 10) === existingDT.slice(0, 10)
          : false;
        return existingName === nameKey && sameDay;
      });

      if (isDuplicate) {
        console.log(`[email-sync] Skipping duplicate: ${appt.name}`);
        skipped++;
        continue;
      }

      const fields = {};
      if (appt.name)         fields[FIELDS.name]         = appt.name;
      if (appt.dateTime)     fields[FIELDS.dateTime]     = appt.dateTime;
      if (appt.doctor)       fields[FIELDS.doctor]       = appt.doctor;
      if (appt.location)     fields[FIELDS.location]     = appt.location;
      if (appt.type)         fields[FIELDS.type]         = appt.type;
      if (appt.status)       fields[FIELDS.status]       = appt.status;
      if (appt.bookingNotes) fields[FIELDS.bookingNotes] = appt.bookingNotes;

      await createAirtableRecord(airtableKey, BASE_ID, APPT_TABLE, fields);
      console.log(`[email-sync] Created: ${appt.name}`);
      created++;
    }

    const summary = `Done. Created: ${created}, Skipped (duplicates): ${skipped}`;
    console.log(`[email-sync] ${summary}`);
    return new Response(summary, { status: 200 });

  } catch (e) {
    console.error("[email-sync] Error:", e.message);
    return new Response(`Error: ${e.message}`, { status: 500 });
  }
};
