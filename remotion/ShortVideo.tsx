// @ts-nocheck
import React, {useMemo} from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  staticFile,
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

export const ShortVideo: React.FC<RenderProps> = ({audioPath, imagePaths, subtitleEvents, voiceDurationSec}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const safeImages = imagePaths.length ? imagePaths : ['https://dummyimage.com/1080x1920/000/fff.png&text=SCAM+ALERT'];
  const resolveAsset = (src: string) => (src.startsWith('http://') || src.startsWith('https://') ? src : staticFile(src.replace(/^\/+/, '')));
  const sceneFrames = Math.max(1, Math.floor(durationInFrames / safeImages.length));
  const nowSec = frame / fps;

  const activeWord = useMemo(() => {
    if (!subtitleEvents.length) return {text: '', startFrame: 0};
    const active = subtitleEvents.find((event) => nowSec >= event.start && nowSec <= event.end + 0.01);
    if (!active) return {text: '', startFrame: 0};
    return {
      text: String(active.text || '').replace(/\s+/g, ' ').trim().toUpperCase(),
      startFrame: Math.floor((active.start || 0) * fps),
    };
  }, [fps, nowSec, subtitleEvents]);

  const pop = spring({
    fps,
    frame: Math.max(0, frame - activeWord.startFrame),
    config: {damping: 200, stiffness: 280, mass: 0.48},
    durationInFrames: 7,
  });

  const fade = interpolate(frame, [activeWord.startFrame, activeWord.startFrame + 3], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
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
              <Img src={resolveAsset(src)} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {audioPath ? <Audio src={resolveAsset(audioPath)} /> : null}

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
            color: '#fff',
            fontSize: 88,
            fontWeight: 900,
            lineHeight: 1.06,
            letterSpacing: 1.6,
            textTransform: 'uppercase',
            WebkitTextStroke: '6px rgba(0,0,0,0.98)',
            textShadow: '0 0 20px rgba(0,0,0,0.55), 0 5px 20px rgba(0,0,0,0.6)',
            paintOrder: 'stroke fill',
            transform: `scale(${0.9 + pop * 0.1})`,
            opacity: activeWord.text ? fade : 0,
            padding: '8px 16px',
            background: 'transparent',
          }}
        >
          {activeWord.text}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
