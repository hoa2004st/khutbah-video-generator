import React from 'react';
import {Composition} from 'remotion';
import {DeckSpec, FPS, VIDEO_HEIGHT, VIDEO_WIDTH, defaultDeck, getTotalFrames} from '../shared/deck';
import {KhutbahComposition} from './KhutbahComposition';

export const COMPOSITION_ID = 'KhutbahDeck';

type RootProps = {
  deck?: DeckSpec;
};

export function RemotionRoot({deck = defaultDeck}: RootProps) {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={KhutbahComposition}
      durationInFrames={getTotalFrames(deck)}
      fps={FPS}
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
      defaultProps={{deck}}
    />
  );
}
