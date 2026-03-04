# Supabase Deployment + Video Pipeline Debug Report

Date: 2026-03-03

## Actions completed

1. Added/updated GitHub Actions repository secrets via GitHub API:
   - `SUPABASE_PROJECT_REF=hhwjolwawbkbnxbduvht`
   - `SUPABASE_ACCESS_TOKEN=<provided value>`
2. Triggered workflow dispatch for:
   - `.github/workflows/deploy-supabase-functions.yml`
3. Observed workflow run result:
   - Run ID `22631869429`
   - Failed at `Link to Supabase project`
4. Confirmed Supabase function endpoint still missing:
   - `POST https://hhwjolwawbkbnxbduvht.supabase.co/functions/v1/render-video` returns `404 NOT_FOUND`
5. Scheduled + manually ran a video job for validation:
   - Job failed during `validate_required_config` with missing Supabase render function endpoint.

## Root cause

The deployment workflow now has the required secret names, but the current value in `SUPABASE_ACCESS_TOKEN` is not accepted by Supabase CLI during project linking. Without successful link/deploy, the `render-video` Edge Function is not present, so the scheduler blocks video generation at preflight.

## Next required fix

Set `SUPABASE_ACCESS_TOKEN` in GitHub Secrets to a valid Supabase Personal Access Token from Supabase dashboard, then rerun workflow `Deploy Supabase Edge Functions`.
