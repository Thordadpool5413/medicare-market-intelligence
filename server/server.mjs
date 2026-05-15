import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const riskyPatterns = [
  { name: "Social Security number", pattern: /\b\d{3}\s?\d{2}\s?\d{4}\b/i },
  { name: "medical record number", pattern: /\b(mrn|medical record|record number|patient id|claim id)\b/i },
  { name: "date of birth", pattern: /\b(dob|date of birth)\b/i },
  { name: "direct patient reference", pattern: /\b(patient name|named patient|specific patient)\b/i }
];

function readText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function checkForPatientIdentifiers(value) {
  const text = value.trim();

  if (!text) {
    return {
      ok: false,
      message: "Please enter a market question before running the analysis."
    };
  }

  for (const item of riskyPatterns) {
    if (item.pattern.test(text)) {
      return {
        ok: false,
        message: `Possible ${item.name} detected. Remove patient identifiers before using this public Medicare intelligence app.`
      };
    }
  }

  return { ok: true };
}

function buildMedicareMarketPrompt(input) {
  return `You are a Medicare market intelligence analyst supporting hospice growth strategy. Use only public CMS Medicare data available through the connected CMS Medicare MCP server. Do not invent provider names, hospital metrics, star ratings, spending amounts, utilization rates, quality measures, readmission figures, or county level facts. If a specific requested data point is unavailable from the MCP server, say that clearly and explain what related public signals were available.

Business context:
The user needs compliant, practical field intelligence for hospice education and referral strategy. The response must stay away from patient level information, patient targeting, claim specific targeting, and anything that could be interpreted as using PHI.

User request:
Question: ${input.question}
Geography: ${input.geography}
Audience: ${input.audience}
Preferred output style: ${input.outputStyle}

Analysis requirements:
1. Identify the most relevant CMS Medicare public data signals available through the MCP tools.
2. Explain which signals matter for hospice education strategy and why.
3. Separate confirmed CMS sourced findings from strategic interpretation.
4. Provide suggested outreach audiences, but frame them around education, quality, transitions of care, serious illness support, and family readiness.
5. Include compliance safe language. Do not suggest patient inducement, steering, exclusive referral behavior, or anything involving patient identifiers.
6. Include a section called Data limitations when CMS data is incomplete or not available.
7. Write in clear, executive ready language for a hospice sales leader.

Return the answer in this structure:
Executive view
CMS public data signals reviewed
Market opportunity findings
Suggested education audiences
Compliant field conversation angles
Data limitations
Recommended next steps`;
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    service: "Medicare Market Intelligence API",
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    mcpServer: process.env.CMS_MEDICARE_MCP_URL || "https://mcp.olyport.com/cms-medicare/mcp",
    generatedAt: new Date().toISOString()
  });
});

app.post("/api/analyze", async (request, response) => {
  const input = {
    question: readText(request.body?.question),
    geography: readText(request.body?.geography),
    audience: readText(request.body?.audience) || "Hospice sales leader",
    outputStyle: readText(request.body?.outputStyle) || "Leadership ready field intelligence"
  };

  if (!input.question) {
    response.status(400).json({ error: "Please enter a Medicare market question." });
    return;
  }

  if (!input.geography) {
    response.status(400).json({ error: "Please enter a geography, such as a county, city, state, hospital market, or territory." });
    return;
  }

  const compliance = checkForPatientIdentifiers(Object.values(input).join("\n"));
  if (!compliance.ok) {
    response.status(400).json({ error: compliance.message });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    response.status(500).json({
      error: "OPENAI_API_KEY is missing. Add it to your Hostinger Node app environment variables."
    });
    return;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-5.5";
  const mcpServer = process.env.CMS_MEDICARE_MCP_URL || "https://mcp.olyport.com/cms-medicare/mcp";

  try {
    const result = await client.responses.create({
      model,
      tools: [
        {
          type: "mcp",
          server_label: "cms_medicare",
          server_description: "Public CMS Medicare data including Medicare spending, chronic conditions, hospital quality, readmissions, and enrollment.",
          server_url: mcpServer,
          require_approval: "never"
        }
      ],
      input: buildMedicareMarketPrompt(input)
    });

    response.json({
      analysis: result.output_text || "The model returned no text output. Check the MCP server response and OpenAI logs.",
      meta: {
        model,
        mcpServer,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error while calling the OpenAI Responses API."
    });
  }
});

app.listen(port, () => {
  console.log(`Medicare Market Intelligence API running on port ${port}`);
});
