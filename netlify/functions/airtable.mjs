export default async (req, context) => {
  const PAT = Netlify.env.get("AIRTABLE_PAT");
  const BASE_ID = Netlify.env.get("AIRTABLE_BASE_ID");

  if (!PAT || !BASE_ID) {
    return new Response(JSON.stringify({ error: "Missing env vars" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const url = new URL(req.url);
  const table = url.searchParams.get("table");

  const tableMap = {
    appointments: "tblYoE6gqRzz8HXzh",
    tasks: "tblpvGShoT1jSFiYA",
    classes: "tblFjSCv9YnACEd4q",
  };

  if (!table || !tableMap[table]) {
    return new Response(JSON.stringify({ error: "Use ?table=appointments, tasks, or classes" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}/${tableMap[table]}`;

  try {
    const response = await fetch(airtableUrl, {
      headers: { Authorization: `Bearer ${PAT}` }
    });
    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config = {
  path: "/.netlify/functions/airtable"
};
