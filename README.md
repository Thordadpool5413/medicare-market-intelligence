# Medicare Market Intelligence

A production ready Next.js starter app that turns public CMS Medicare signals into hospice market intelligence using the OpenAI Responses API and a remote CMS Medicare MCP server.

## What this app does

This app gives a hospice sales leader or market development team a clean interface to ask Medicare market questions, choose a geography, and receive executive ready intelligence based on public CMS Medicare data signals.

The app is designed around compliant public data use. It does not use patient information, patient identifiers, patient level claims, or PHI.

## Data flow

1. A user enters a Medicare market question in the dashboard.
2. The browser sends the request to the Next.js API route at `/api/analyze`.
3. The API route checks for obvious patient identifiers.
4. The API route calls the OpenAI Responses API.
5. OpenAI connects to the CMS Medicare MCP server.
6. The response is returned to the dashboard as field ready intelligence.

## Required environment variables

Create a `.env.local` file from `.env.example`.

```bash
cp .env.example .env.local
```

Then set these values.

```bash
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5.5
CMS_MEDICARE_MCP_URL=https://mcp.olyport.com/cms-medicare/mcp
```

If your OpenAI account does not have access to the model in `.env.example`, change `OPENAI_MODEL` to a Responses API compatible model that is enabled for your account.

## Run locally

```bash
npm install
npm run dev
```

Open the local Next.js URL shown in your terminal.

## Build locally

```bash
npm run build
npm run start
```

## Deploy on Vercel

1. Push this repository to GitHub.
2. Import the repository into Vercel.
3. Add the environment variables from `.env.example` in Vercel project settings.
4. Deploy.

## Important security notes

The CMS Medicare MCP endpoint is a remote MCP server. Remote MCP servers are third party services. Review what data you send to the server and do not send PHI, patient identifiers, patient names, dates of birth, medical record numbers, claim identifiers, or other sensitive patient level information.

The app includes a basic guardrail for obvious patient identifiers, but that does not replace policy, training, logging, access controls, or human review.

## App structure

```text
app/page.tsx
app/layout.tsx
app/globals.css
app/components/MarketIntelligenceClient.tsx
app/api/analyze/route.ts
app/api/health/route.ts
lib/compliance.ts
lib/prompts.ts
```

## Suggested next upgrades

1. Add saved territory profiles.
2. Add structured output JSON for tables and scoring.
3. Add PDF export for leadership reports.
4. Add audit logging for prompts and MCP tool use.
5. Add authentication before deployment to a live team.
6. Add explicit allowlists after the CMS MCP server tool names are confirmed.
