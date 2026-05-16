# Supabase Backend Setup

This app now uses Supabase as the backend of record for national CMS Provider Data.

Hostinger only needs to run the Vite front end. The browser reads from Supabase using the anon key. The national CMS ingestion runs through a secure server side script using the Supabase service role key.

## 1. Create the Supabase tables

Open Supabase, go to SQL Editor, and run the full contents of:

```text
supabase/schema.sql
```

This creates:

```text
cms_hospitals
cms_hospices
cms_ingestion_runs
```

It also enables public read access for the dashboard through Row Level Security policies.

## 2. Add Hostinger Vite environment variables

In Hostinger, add these environment variables for the Vite app:

```text
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

Do not add the service role key to Hostinger front end variables.

## 3. Add GitHub Actions secrets

In GitHub, go to:

```text
Settings > Secrets and variables > Actions > Repository secrets
```

Add:

```text
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
```

The service role key is used only by the ingestion workflow. It should never be exposed in the browser.

## 4. Run the ingestion workflow

Go to GitHub:

```text
Actions > Ingest CMS National Data to Supabase > Run workflow
```

This runs:

```text
npm run ingest:supabase
```

The workflow pulls public CMS Provider Data and upserts records into Supabase.

## 5. Deploy Hostinger

Use:

```text
Framework: Vite
Build command: npm run build
Output directory: dist
Node version: 24.x
```

The app no longer needs Hostinger Node API routing for data. Supabase is the backend.

## 6. Verify it worked

In Supabase Table Editor, confirm rows exist in:

```text
cms_hospitals
cms_hospices
cms_ingestion_runs
```

Then open the deployed app. The dashboard should show national hospital counts and hospice counts.

## Troubleshooting

If the dashboard says Supabase data failed to load, check:

1. `VITE_SUPABASE_URL` is set in Hostinger.
2. `VITE_SUPABASE_ANON_KEY` is set in Hostinger.
3. The Supabase schema has been run.
4. Row Level Security policies exist and allow public select.
5. The ingestion workflow completed successfully.
6. `cms_hospitals` contains rows.

If the ingestion workflow fails, check GitHub Actions logs and confirm:

1. `SUPABASE_URL` is present as a GitHub secret.
2. `SUPABASE_SERVICE_ROLE_KEY` is present as a GitHub secret.
3. The service role key is copied from Supabase project settings, not the anon key.
