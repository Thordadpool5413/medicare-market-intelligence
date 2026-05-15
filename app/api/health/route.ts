import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "Medicare Market Intelligence",
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    mcpServer: process.env.CMS_MEDICARE_MCP_URL || "https://mcp.olyport.com/cms-medicare/mcp",
    generatedAt: new Date().toISOString()
  });
}
