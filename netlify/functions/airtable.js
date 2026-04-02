// Netlify serverless function — proxies requests to Airtable so the
// personal access token never touches the browser.

exports.handler = async (event) => {
  const PAT = process.env.AIRTABLE_PAT;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;

  // Which table? Passed as ?table=appointments | tasks | classes
  const table = event.queryStringParameters?.table;

  const tableMap = {
    appointments: "tblYoE6gqRzz8HXzh",
    tasks: "tblpvGShoT1jSFiYA",
    classes: "tblFjSCv9YnACEd4q",
  };

  if (!table || !tableMap[table]) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid table parameter. Use: appointments, tasks, or classes." }),
    };
  }

  const url = `https://api.airtable.com/v0/${BASE_ID}/${tableMap[table]}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${PAT}` },
    });

    const data = await response.json();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
