# MoviePy Pipeline Live Run Report (2026-03-07)

## Objective
Validate that the video pipeline runs end-to-end with MoviePy rendering and successfully publishes to Facebook.

## Architecture validated
AI scene images -> UnrealSpeech voiceover -> SRT subtitle generation from UnrealSpeech timestamps -> MoviePy render -> Catbox upload -> Facebook publish.

## Code changes applied during validation
1. Replaced FFmpeg workflow steps with MoviePy-based rendering workflows.
2. Switched scheduler render stage to `video_render_moviepy`.
3. Removed ASS subtitle generation path and switched subtitle flow to SRT events.
4. Set GitHub render defaults to prefer `moviepy-render.yml`.
5. Fixed MoviePy subtitle generator wiring (`SubtitlesClip(..., make_textclip=...)`).
6. Added Catbox upload retry logic for transient empty payload responses.

## Real test executions
### Attempt A (failed)
- Schedule id: `40944d77-0738-418f-b019-294bacccc916`
- Failure: MoviePy workflow failed in subtitle step due incorrect `SubtitlesClip` argument mapping.
- Fix applied: use keyword argument `make_textclip=subtitle_generator`.

### Attempt B (failed)
- Schedule id: `347839b5-0da7-41ab-b521-a0e421b96754`
- Render workflow succeeded: run `22800148867`.
- Failure: Catbox API returned empty payload.
- Fix applied: retry Catbox upload up to 3 attempts with backoff.

### Attempt C (success)
- Schedule id: `6f1ee6b8-6759-42ed-aa79-439c97460e59`
- Render workflow succeeded: run `22800242323`.
- Catbox upload succeeded: `https://files.catbox.moe/06i6sh.mp4`.
- Facebook publish verification succeeded: object `1311013271056714`, URL `/reel/1311013271056714/`.
- Terminal state: `posted`.

## Output verification
- Downloaded Catbox output and validated MP4 container atoms:
  - `ftyp` at offset 4
  - `moov` at offset 36
  - `mdat` at offset 80056
- Published-videos state contains the successful schedule id and Facebook reel URL.

## Conclusion
MoviePy rendering pipeline is functioning end-to-end in production path with successful video render, upload, and Facebook publication.
