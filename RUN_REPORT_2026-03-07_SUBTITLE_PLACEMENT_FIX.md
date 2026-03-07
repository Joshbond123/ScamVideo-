# Subtitle Placement + Sync Investigation — 2026-03-07

## Problem observed
A generated Catbox video showed subtitles at the top area and not in a viral-style caption zone.

Video inspected:
- `https://files.catbox.moe/64eaeu.mp4`

Visual inspection confirmed:
- captions rendered near the top region,
- poor short-form readability,
- subtitle timing looked too fragmented (word-level flashes instead of short readable phrases).

## Root cause
In the MoviePy render workflows:
1. Positioning was applied inside `subtitle_generator` (`TextClip(...).with_position(...)`). In practice this produced unstable placement behavior with `SubtitlesClip` composition in our pipeline.
2. Subtitle events were written almost one-to-one from timestamp events, producing very short subtitle spans that are hard to read on mobile.

## Fix implemented (subtitle-only scope)
Applied to all active render workflow variants:
- `.github/workflows/moviepy-render.yml`
- `.github/workflows/render-dispatch.yml`
- `.github/workflows/video-render-dispatch.yml`
- `.github/workflows/ffmpeg-render.yml`

Changes:
1. **Stable lower-middle placement**
   - moved positioning to the subtitles layer:
     - `SubtitlesClip(...).with_position(('center', int(H * 0.66)))`
   - removed per-clip positioning from `subtitle_generator`.

2. **Viral/mobile styling improvements**
   - white text,
   - thicker stroke for contrast,
   - narrower caption width to keep subtitles around 1–2 lines.

3. **Readable phrase chunking with timing sync**
   - convert normalized timestamp events into short chunks using thresholds:
     - max words / max chars / max gap / min duration / max duration,
   - keeps subtitles synchronized with voice progression while avoiding unreadably fast flashes.

## Validation checks
- Workflow/syntax precheck passed locally (`npm run check:prebuild`).
- Catbox video was inspected directly with browser automation before fix to confirm the issue.

## Notes
The fix intentionally changes only subtitle generation/placement/styling behavior and does not alter other pipeline stages.
