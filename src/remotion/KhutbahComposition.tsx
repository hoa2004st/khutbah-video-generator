import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  DeckSpec,
  SlidePlan,
  buildSlidePlan,
  splitParagraphs,
} from '../shared/deck';
import '../styles/composition.css';

type Props = {
  deck: DeckSpec;
};

export function KhutbahComposition({deck}: Props) {
  const slides = buildSlidePlan(deck);

  return (
    <AbsoluteFill className="composition-root">
      <div className="ornament ornament-left" />
      <div className="ornament ornament-right" />
      {slides.map((slide) => (
        <Sequence
          key={slide.id}
          from={slide.startFrame}
          durationInFrames={slide.durationInFrames}
        >
          {slide.kind === 'content' ? (
            <ContentSlide slide={slide} />
          ) : (
            <TitleSlide slide={slide} prominent={slide.kind === 'title'} />
          )}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function TitleSlide({slide, prominent}: {slide: SlidePlan; prominent: boolean}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const entrance = spring({
    frame,
    fps,
    config: {damping: 18, stiffness: 85, mass: 0.9},
    durationInFrames: Math.round(fps * 1.1),
  });
  const exitStart = slide.durationInFrames - Math.round(fps * 1.1);
  const exit = interpolate(frame, [exitStart, slide.durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const translateY = interpolate(entrance, [0, 1], [160, 0]) + interpolate(exit, [0, 1], [0, -160]);
  const opacity = interpolate(frame, [0, 16, exitStart, slide.durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill className="slide title-slide">
      <div
        className={prominent ? 'title-block title-block-main' : 'title-block'}
        style={{transform: `translateY(${translateY}px)`, opacity}}
      >
        <p className="title-kicker">Khutbah Video</p>
        <h1>{slide.title}</h1>
      </div>
    </AbsoluteFill>
  );
}

function ContentSlide({slide}: {slide: SlidePlan}) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const fadeInFrames = Math.round(fps * 0.8);
  const fadeOutStart = slide.durationInFrames - Math.round(fps * 0.8);
  const progress = interpolate(frame, [fadeInFrames, fadeOutStart], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = interpolate(frame, [0, fadeInFrames, fadeOutStart, slide.durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const travel = 78;

  return (
    <AbsoluteFill className="slide content-slide" style={{opacity}}>
      <div className="content-mask">
        <article
          className="content-wall"
          style={{transform: `translateY(${interpolate(progress, [0, 1], [8, -travel])}%)`}}
        >
          {splitParagraphs(slide.content ?? '').map((paragraph, index) => (
            <p key={`${slide.id}-${index}`} dir="auto">
              {paragraph}
            </p>
          ))}
        </article>
      </div>
    </AbsoluteFill>
  );
}
