# Medicare Market Intelligence

A Hostinger ready Vite React app with an optional Node 24 API server that turns public CMS Medicare signals into hospice market intelligence using the OpenAI Responses API and a remote CMS Medicare MCP server.

## Hostinger settings

Use these settings for the front end deployment:

```text
Framework: Vite
Build and output settings: Default
Node version: 24.x
```

Vite builds the front end into the default `dist` folder.

## Important architecture note

The Vite front end must not contain your OpenAI API key. Vite bundles browser code, so any secret placed in the front end can become visible to users.

This repo includes a Node 24 Express server in `server/server.mjs` for the live `/api/analyze` and `/api/health` endpoints. Use that server on Hostinger if your plan supports Node apps, or deploy it to another secure backend and set `VITE_API_BASE_URL` in Hostinger to that backend URL.

## What this app does

This app gives a hospice sales leader or market development team a clean interface to ask Medicare market questions, choose a geography, and receive executive ready intelligence based on public CMS Medicare data signals.

The app is designed around compliant public data use. It does not use patient information, patient identifiers, patient level claims, or PHI.

## Data flow

1. A user enters a Medicare market question in the dashboard.
2. The Vite front end sends the request to `/api/analyze` or to `VITE_API_BASE_URL/api/analyze`.
3. The Node API server checks for obvious patient identifiers.
4. The Node API server calls the OpenAI Responses API.
5. OpenAI connects to the CMS Medicare MCP server.
6. The response is returned to the dashboard as field ready intelligence.

## Required environment variables

For the Node API server:

```bash
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5.5
CMS_MEDICARE_MCP_URL=https://mcp.olyport.com/cms-medicare/mcp
PORT=8787
```

For the Vite front end only when the API is hosted on a different domain:

```bash
VITE_API_BASE_URL=https://your-secure-api-domain.com
```

Leave `VITE_API_BASE_URL` blank when the API server is available on the same domain as the front end.

## Run locally

Run the Vite front end:

```bash
npm install
npm run dev
```

Run the Node API server in a second terminal:

```bash
npm run dev:server
```

Or run both together:

```bash
npm run dev:full
```

The Vite dev server proxies `/api` requests to `http://localhost:8787`.

## Build locally

```bash
npm run build
```

This creates the Vite production build in `dist`.

## Start the Node API server

```bash
npm run start
```

## Hostinger deployment checklist

1. Connect this GitHub repository to Hostinger.
2. Choose Vite as the framework.
3. Leave build and output settings on Default.
4. Choose Node version 24.x.
5. Add `OPENAI_API_KEY`, `OPENAI_MODEL`, and `CMS_MEDICARE_MCP_URL` to the secure server environment for the Node API server.
6. If your Node API server is separate from the Vite site, add `VITE_API_BASE_URL` to the Vite environment variables.
7. Deploy.
8. Test `/api/health` first.
9. Test the home page by running a Medicare market question.

## Important security notes

The CMS Medicare MCP endpoint is a remote MCP server. Remote MCP servers are third party services. Review what data you send to the server and do not send PHI, patient identifiers, patient names, dates of birth, medical record numbers, claim identifiers, or other sensitive patient level information.

The app includes a basic guardrail for obvious patient identifiers, but that does not replace policy, training, logging, access controls, or human review.

## App structure

```text
index.html
vite.config.ts
src/main.tsx
src/App.tsx
src/styles.css
server/server.mjs
```

## Suggested next upgrades

1. Add saved territory profiles.
2. Add structured output JSON for tables and scoring.
3. Add PDF export for leadership reports.
4. Add audit logging for prompts and MCP tool use.
5. Add authentication before deployment to a live team.
6. Add explicit allowlists after the CMS MCP server tool names are confirmed.
