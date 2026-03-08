// @ts-nocheck
import React, {useMemo} from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type SubtitleEvent = {text: string; start: number; end: number};
export type RenderProps = {
  audioPath: string;
  imagePaths: string[];
  subtitleEvents: SubtitleEvent[];
  voiceDurationSec: number;
};

const groupWindow = (events: SubtitleEvent[], idx: number) => {
  const words: string[] = [];
  for (let i = idx; i >= 0 && words.length < 6; i -= 1) {
    const gap = i < idx ? events[i + 1].start - events[i].end : 0;
    if (gap > 0.45) break;
    words.unshift(events[i].text.toUpperCase());
  }
  const text = words.join(' ').trim();
  if (text.length <= 24) return text;
  const tokens = text.split(' ');
  const line1: string[] = [];
  const line2: string[] = [];
  for (const token of tokens) {
    const current = line2.length ? line2 : line1;
    const projected = `${current.join(' ')} ${token}`.trim();
    if (current === line1 && projected.length <= 24) {
      line1.push(token);
      continue;
    }
    if (line2.length === 0 || `${line2.join(' ')} ${token}`.trim().length <= 24) {
      line2.push(token);
      continue;
    }
    break;
  }
  return [line1.join(' '), line2.join(' ')].filter(Boolean).join('\n').trim();
};

export const ShortVideo: React.FC<RenderProps> = ({audioPath, imagePaths, subtitleEvents, voiceDurationSec}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const safeImages = imagePaths.length ? imagePaths : ['https://dummyimage.com/1080x1920/000/fff.png&text=SCAM+ALERT'];
  const sceneFrames = Math.max(1, Math.floor(durationInFrames / safeImages.length));
  const nowSec = frame / fps;

  const subtitle = useMemo(() => {
    if (!subtitleEvents.length) return {text: '', startFrame: 0};
    let activeIdx = subtitleEvents.findIndex((event) => nowSec >= event.start && nowSec <= event.end + 0.03);
    if (activeIdx < 0) {
      activeIdx = subtitleEvents.findIndex((event) => event.start > nowSec);
      if (activeIdx > 0) activeIdx -= 1;
    }
    if (activeIdx < 0) return {text: '', startFrame: 0};
    const text = groupWindow(subtitleEvents, activeIdx);
    return {
      text,
      startFrame: Math.floor((subtitleEvents[activeIdx].start || 0) * fps),
    };
  }, [fps, nowSec, subtitleEvents]);

  const subtitlePop = spring({
    fps,
    frame: Math.max(0, frame - subtitle.startFrame),
    config: {damping: 220, stiffness: 250, mass: 0.5},
    durationInFrames: 8,
  });

  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      {safeImages.map((src, idx) => {
        const start = idx * sceneFrames;
        const fromNext = start + sceneFrames;
        const opacity = interpolate(frame, [start, start + 5, fromNext - 6, fromNext], [0, 1, 1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        return (
          <Sequence key={`${src}-${idx}`} from={start} durationInFrames={sceneFrames + 8}>
            <AbsoluteFill style={{opacity}}>
              <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {audioPath ? <Audio src={audioPath} /> : null}

      <AbsoluteFill
        style={{
          justifyContent: 'flex-start',
          alignItems: 'center',
          top: '64%',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: '78%',
            minHeight: 180,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            whiteSpace: 'pre-line',
            color: '#fff',
            fontSize: 84,
            fontWeight: 900,
            lineHeight: 1.1,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            WebkitTextStroke: '6px rgba(0,0,0,0.95)',
            paintOrder: 'stroke fill',
            transform: `scale(${0.92 + subtitlePop * 0.08})`,
            opacity: subtitle.text ? 1 : 0,
            padding: '8px 16px',
          }}
        >
          {subtitle.text}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
