import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { checkForPatientIdentifiers } from "../../../lib/compliance";
import { buildMedicareMarketPrompt, type MedicareAnalysisInput } from "../../../lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

type ApiBody = Partial<MedicareAnalysisInput>;

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildCombinedText(input: MedicareAnalysisInput): string {
  return [input.question, input.geography, input.audience, input.outputStyle].join("\n");
}

export async function POST(request: NextRequest) {
  let body: ApiBody;

  try {
    body = (await request.json()) as ApiBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const input: MedicareAnalysisInput = {
    question: readText(body.question),
    geography: readText(body.geography),
    audience: readText(body.audience) || "Hospice sales leader",
    outputStyle: readText(body.outputStyle) || "Leadership ready field intelligence"
  };

  if (!input.question) {
    return NextResponse.json({ error: "Please enter a Medicare market question." }, { status: 400 });
  }

  if (!input.geography) {
    return NextResponse.json({ error: "Please enter a geography, such as a county, city, state, hospital market, or territory." }, { status: 400 });
  }

  const compliance = checkForPatientIdentifiers(buildCombinedText(input));
  if (!compliance.ok) {
    return NextResponse.json({ error: compliance.message }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is missing. Add it to .env.local for local use or to your hosting provider environment variables for deployment."
      },
      { status: 500 }
    );
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-5.5";
  const mcpServer = process.env.CMS_MEDICARE_MCP_URL || "https://mcp.olyport.com/cms-medicare/mcp";
  const prompt = buildMedicareMarketPrompt(input);

  try {
    const response = await client.responses.create({
      model,
      tools: [
        {
          type: "mcp",
          server_label: "cms_medicare",
          server_description:
            "Public CMS Medicare data including Medicare spending, chronic conditions, hospital quality, readmissions, and enrollment.",
          server_url: mcpServer,
          require_approval: "never"
        } as any
      ],
      input: prompt
    });

    return NextResponse.json({
      analysis: response.output_text || "The model returned no text output. Check the MCP server response and OpenAI logs.",
      meta: {
        model,
        mcpServer,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error while calling the OpenAI Responses API.";

    return NextResponse.json(
      {
        error: message
      },
      { status: 500 }
    );
  }
}
