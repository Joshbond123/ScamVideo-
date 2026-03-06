# Deploy Debug Report

Date: 2026-03-05

## Render architecture update
- Local and Supabase media processing are removed.
- Video rendering is now handled by GitHub Actions using GStreamer workflow dispatch.
- Supabase is now storage/metadata only.

## Validation focus
- GitHub workflow discovery and dispatch health.
- Scheduler preflight checks for active render workflow.
- End-to-end pipeline stages through publish.
