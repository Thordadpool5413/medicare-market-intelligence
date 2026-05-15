# GitHub setup

## Local setup

```bash
git clone https://github.com/Thordadpool5413/medicare-market-intelligence.git
cd medicare-market-intelligence
cp .env.example .env.local
npm install
npm run dev
```

## Required environment variables

Do not commit your real `.env.local` file.

Add these values locally, in Vercel, and in GitHub Actions secrets if you want CI builds to use live settings.

```bash
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5.5
CMS_MEDICARE_MCP_URL=https://mcp.olyport.com/cms-medicare/mcp
```

If your OpenAI account does not have access to the model listed above, change `OPENAI_MODEL` to a Responses API compatible model enabled for your account.

## Deploy on Vercel

1. Import this GitHub repo into Vercel.
2. Add the environment variables from `.env.example`.
3. Deploy.
4. Test `/api/health` first.
5. Test the home page and run a market intelligence question.
