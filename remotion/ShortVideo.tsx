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
  backgroundMusicUrl?: string;
  backgroundMusicVolume?: number;
  imagePaths: string[];
  subtitleEvents: SubtitleEvent[];
  voiceDurationSec: number;
};

export const ShortVideo: React.FC<RenderProps> = ({
  audioPath,
  backgroundMusicUrl,
  backgroundMusicVolume = 0.1,
  imagePaths,
  subtitleEvents,
  voiceDurationSec,
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  const safeImages = imagePaths.length ? imagePaths : ['https://dummyimage.com/1080x1920/000/fff.png&text=SCAM+ALERT'];
  const resolveAsset = (src: string) => (src.startsWith('http://') || src.startsWith('https://') ? src : staticFile(src.replace(/^\/+/, '')));
  const sceneFrames = Math.max(1, Math.floor(durationInFrames / safeImages.length));
  const nowSec = frame / fps;

  const activeWord = useMemo(() => {
    if (!subtitleEvents.length) return {text: '', startFrame: 0};

    const idx = subtitleEvents.findIndex((event) => {
      const start = Math.max(0, Number(event.start || 0));
      const end = Math.max(start + 0.04, Number(event.end || 0));
      return nowSec >= start && nowSec <= end + 0.02;
    });

    if (idx < 0) return {text: '', startFrame: 0};
    const word = String(subtitleEvents[idx].text || '').trim().toUpperCase();
    return {
      text: word,
      startFrame: Math.floor(Math.max(0, Number(subtitleEvents[idx].start || 0)) * fps),
    };
  }, [fps, nowSec, subtitleEvents]);

  const subtitlePop = spring({
    fps,
    frame: Math.max(0, frame - activeWord.startFrame),
    config: {damping: 180, stiffness: 260, mass: 0.5},
    durationInFrames: 7,
  });

  const subtitleFade = interpolate(frame - activeWord.startFrame, [0, 2, 5], [0, 0.75, 1], {
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

      {backgroundMusicUrl ? <Audio src={resolveAsset(backgroundMusicUrl)} volume={backgroundMusicVolume} /> : null}
      {audioPath ? <Audio src={resolveAsset(audioPath)} volume={1} /> : null}

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
            fontSize: 92,
            fontWeight: 900,
            lineHeight: 1.05,
            letterSpacing: 1.6,
            textTransform: 'uppercase',
            WebkitTextStroke: '6px rgba(0,0,0,0.98)',
            textShadow: '0 6px 22px rgba(0,0,0,0.65)',
            paintOrder: 'stroke fill',
            transform: `scale(${0.9 + subtitlePop * 0.1})`,
            opacity: activeWord.text ? subtitleFade : 0,
            padding: '8px 16px',
            backgroundColor: 'transparent',
          }}
        >
          {activeWord.text}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
