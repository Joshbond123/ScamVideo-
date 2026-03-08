// @ts-nocheck
import React from 'react';
import {Composition} from 'remotion';
import {ShortVideo, type RenderProps} from './ShortVideo';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition<RenderProps>
      id="ShortVideo"
      component={ShortVideo}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={300}
      defaultProps={{audioPath: '', backgroundMusicUrl: '', backgroundMusicVolume: 0.1, imagePaths: [], subtitleEvents: [], voiceDurationSec: 10}}
      calculateMetadata={({props}) => ({
        durationInFrames: Math.max(30, Math.ceil((Number(props?.voiceDurationSec || 1) + 0.2) * 30)),
      })}
    />
  );
};
