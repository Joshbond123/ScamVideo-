# Video Pipeline Live Run Report (2026-03-07)

## Scope
This run validates the production video scheduling pipeline end-to-end against the configured Supabase project and Facebook page.

## Environment
- App server started locally with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set.
- Scheduler triggered with an immediate `video` schedule.
- Existing configured Facebook page: `OnChain Detectives` (`1033780829811170`).

## Execution Summary
Scheduled job id: `deeaf34a-2791-438c-95c5-86d1644c67ca`

Observed stage progression in scheduler logs:
1. `validate_required_config`
2. `topic_discovery`
3. `topic_selection`
4. `topic_rewrite`
5. `video_script_generation`
6. `video_voiceover_generation`
7. `video_scene_image_generation`
8. `video_render_ffmpeg`
9. `video_host_catbox`
10. `video_publish_facebook`
11. `video_cleanup_assets`
12. terminal state `posted`

## Verified Outcomes
- Render workflow dispatched and completed successfully on GitHub Actions run `22799812441`.
- Generated media uploaded to Catbox URL: `https://files.catbox.moe/w53z0s.mp4`.
- Output downloaded and validated as MP4 container by checking `ftyp`, `moov`, and `mdat` atoms.
- Facebook publish verification succeeded for object id `4176521482657959` and reel URL `/reel/4176521482657959/`.
- Published content record exists for this schedule in `published_videos` state.

## Notes
- Current production renderer is FFmpeg via GitHub Actions (`render-dispatch.yml`), not MoviePy.
- No code defects were encountered during this run.
