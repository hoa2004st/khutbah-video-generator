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
  DeckDesign,
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
  const deckStyle = getDeckStyle(deck.design);

  return (
    <AbsoluteFill className="composition-root" style={deckStyle}>
      <div className="ornament ornament-left" />
      <div className="ornament ornament-right" />
      {slides.map((slide) => (
        <Sequence
          key={slide.id}
          from={slide.startFrame}
          durationInFrames={slide.durationInFrames}
        >
          {slide.kind === 'content' ? (
            <ContentSlide slide={slide} deck={deck} />
          ) : (
            <TitleSlide slide={slide} prominent={slide.kind === 'title'} />
          )}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

function getFontFamily(fontFamily: DeckDesign['fontFamily']): string {
  switch (fontFamily) {
    case 'sans':
      return '"Segoe UI", "Noto Sans", "Noto Naskh Arabic", sans-serif';
    case 'arabic':
      return '"Noto Naskh Arabic", "Amiri", Georgia, serif';
    case 'classic':
      return '"Palatino Linotype", Palatino, Georgia, "Noto Naskh Arabic", serif';
    case 'serif':
    default:
      return 'Georgia, "Times New Roman", "Noto Naskh Arabic", serif';
  }
}

function getDeckStyle(design: DeckDesign): React.CSSProperties {
  return {
    '--deck-font': getFontFamily(design.fontFamily),
    '--deck-bg': design.backgroundColor,
    '--deck-bg-image': design.backgroundImage ? `url("${design.backgroundImage}")` : 'none',
    '--deck-text': design.fontColor,
    '--deck-x-margin': `${design.margin}px`,
    '--deck-y-margin': `${design.verticalMargin}px`,
    '--deck-content-size': `${design.fontSize}px`,
    '--deck-title-size': `${Math.round(design.fontSize * 2.18)}px`,
    '--deck-main-title-size': `${Math.round(design.fontSize * 2.82)}px`,
  } as React.CSSProperties;
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
        <h1>{slide.title}</h1>
      </div>
    </AbsoluteFill>
  );
}

function ContentSlide({slide, deck}: {slide: SlidePlan; deck: DeckSpec}) {
  const frame = useCurrentFrame();
  const {fps, height} = useVideoConfig();
  const isBilingual = deck.design.contentLayout === 'bilingual';

  const fadeInFrames = Math.round(fps * 0.1);
  const fadeOutStart = slide.durationInFrames - Math.round(fps * 0.1);
  const progress = interpolate(frame, [fadeInFrames, fadeOutStart], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = interpolate(frame, [0, fadeInFrames, fadeOutStart, slide.durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Scroll the wall from fully below the mask (translateY = viewport height) to
  // fully above it (translateY = -100% of the wall's OWN height). Expressing the
  // end as a CSS percentage lets the browser resolve it against the actual
  // laid-out height at paint time, so we never measure the DOM.
  //
  // Why this matters: the previous implementation measured scrollHeight in a
  // useEffect and used -contentHeight as the end position. Remotion renders long
  // videos as independent 3-minute chunk segments, each in a fresh browser, and
  // each re-measured the Arabic text's height slightly differently. The segment
  // after the 3-minute mark would measure a larger height, scroll the text off
  // the top early, and leave only the background. A CSS percentage is identical
  // in every segment and every parallel worker, so the scroll is always correct.
  const scrollTransform = `translateY(calc(${(1 - progress) * height}px - ${progress * 100}%))`;

  return (
    <AbsoluteFill
      className={`slide content-slide${isBilingual ? ' content-slide-bilingual' : ''}`}
      style={{opacity}}
    >
      <div className="content-mask">
        {isBilingual ? (
          <div className="content-columns">
            <article className="content-wall" style={{transform: scrollTransform}}>
              {splitParagraphs(slide.content ?? '').map((paragraph, index) => (
                <p key={`${slide.id}-primary-${index}`} dir="auto">
                  {paragraph}
                </p>
              ))}
            </article>
            <article className="content-wall" style={{transform: scrollTransform}}>
              {splitParagraphs(slide.contentSecondary ?? '').map((paragraph, index) => (
                <p key={`${slide.id}-secondary-${index}`} dir="auto">
                  {paragraph}
                </p>
              ))}
            </article>
          </div>
        ) : (
          <article className="content-wall" style={{transform: scrollTransform}}>
            {splitParagraphs(slide.content ?? '').map((paragraph, index) => (
              <p key={`${slide.id}-${index}`} dir="auto">
                {paragraph}
              </p>
            ))}
          </article>
        )}
      </div>
    </AbsoluteFill>
  );
}
