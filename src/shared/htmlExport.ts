import {
  DeckDesign,
  DeckSpec,
  FPS,
  PASSAGE_TITLES,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  buildSlidePlan,
  splitParagraphs,
} from './deck.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderParagraphs(content: string): string {
  return splitParagraphs(content)
    .map((paragraph) => `<p dir="auto">${escapeHtml(paragraph)}</p>`)
    .join('\n');
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

function getBackgroundImageValue(backgroundImage: string): string {
  return backgroundImage ? `url(${JSON.stringify(backgroundImage)})` : 'none';
}

export function buildStandaloneHtml(deck: DeckSpec): string {
  const slides = buildSlidePlan(deck);
  const totalSeconds = slides.reduce((sum, slide) => sum + slide.durationInFrames / FPS, 0);
  const isBilingual = deck.design.contentLayout === 'bilingual';
  const slideMarkup = slides
    .map((slide) => {
      const delay = slide.startFrame / FPS;
      const duration = slide.durationInFrames / FPS;
      const style = `--delay:${delay}s;--duration:${duration}s;`;

      if (slide.kind === 'content') {
        if (isBilingual) {
          return `<section class="slide content-slide content-slide-bilingual" style="${style}">
  <div class="content-mask">
    <div class="content-columns">
      <article class="content-wall" style="--duration:${duration}s;">
        ${renderParagraphs(slide.content ?? '')}
      </article>
      <article class="content-wall" style="--duration:${duration}s;">
        ${renderParagraphs(slide.contentSecondary ?? '')}
      </article>
    </div>
  </div>
</section>`;
        }

        return `<section class="slide content-slide" style="${style}">
  <div class="content-mask">
    <article class="content-wall" style="--duration:${duration}s;">
      ${renderParagraphs(slide.content ?? '')}
    </article>
  </div>
</section>`;
      }

      const isMain = slide.kind === 'title';
      return `<section class="slide title-slide" style="${style}">
  <div class="${isMain ? 'title-block title-block-main' : 'title-block'}">
    <h1>${escapeHtml(slide.title ?? '')}</h1>
  </div>
</section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(deck.title)} - Khutbah Deck</title>
  <style>
    :root {
      color-scheme: dark;
      --deck-bg: ${deck.design.backgroundColor};
      --deck-text: ${deck.design.fontColor};
      --deck-font: ${getFontFamily(deck.design.fontFamily)};
      --deck-bg-image: ${getBackgroundImageValue(deck.design.backgroundImage)};
      --deck-x-margin: ${deck.design.margin}px;
      --deck-y-margin: ${deck.design.verticalMargin}px;
      --deck-content-size: ${deck.design.fontSize}px;
      --deck-title-size: ${Math.round(deck.design.fontSize * 2.18)}px;
      --deck-main-title-size: ${Math.round(deck.design.fontSize * 2.82)}px;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--deck-bg);
      color: var(--deck-text);
      font-family: var(--deck-font);
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .stage {
      --scale: 1;
      width: calc(${VIDEO_WIDTH}px * var(--scale));
      height: calc(${VIDEO_HEIGHT}px * var(--scale));
      position: relative;
    }
    .deck {
      position: relative;
      width: ${VIDEO_WIDTH}px;
      height: ${VIDEO_HEIGHT}px;
      transform: scale(var(--scale));
      transform-origin: top left;
      background:
        linear-gradient(135deg, rgba(201, 173, 108, 0.12), transparent 36%),
        linear-gradient(315deg, rgba(28, 96, 91, 0.22), transparent 42%),
        var(--deck-bg-image),
        var(--deck-bg);
      background-position: center;
      background-size: auto, auto, cover, auto;
      overflow: hidden;
    }
    .ornament {
      position: absolute;
      width: 460px;
      height: 460px;
      border: 1px solid rgba(214, 184, 116, 0.25);
      transform: rotate(45deg);
    }
    .ornament-left {
      left: -250px;
      top: 120px;
    }
    .ornament-right {
      right: -250px;
      bottom: 120px;
    }
    .slide {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .title-slide {
      text-align: center;
      padding: 120px var(--deck-x-margin);
    }
    .title-block {
      max-width: 1180px;
      animation: titleTravel var(--duration) cubic-bezier(0.2, 0.84, 0.22, 1) var(--delay) both;
    }
    .title-block h1 {
      margin: 0;
      font-size: var(--deck-title-size);
      font-weight: 700;
      line-height: 1.05;
      text-wrap: balance;
    }
    .title-block-main h1 { font-size: var(--deck-main-title-size); }
    .content-slide {
      padding: var(--deck-y-margin) var(--deck-x-margin);
      align-items: stretch;
      opacity: 0;
      animation: contentFade var(--duration) linear var(--delay) both;
    }
    .content-mask {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    .content-columns {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 72px;
      height: 100%;
    }
    .content-wall {
      width: 100%;
      margin: 0 auto;
      padding: 0;
      font-size: var(--deck-content-size);
      line-height: 1.64;
      color: var(--deck-text);
      animation: contentScroll var(--duration) linear var(--delay) both;
    }
    .content-wall p {
      margin: 0 0 36px;
      white-space: pre-wrap;
    }
    .content-wall p[dir="rtl"],
    .content-wall p:dir(rtl) {
      font-size: calc(var(--deck-content-size) * 1.18);
      line-height: 1.9;
      text-align: right;
    }
    @keyframes titleTravel {
      0% { transform: translateY(160px); opacity: 0; }
      18%, 78% { transform: translateY(0); opacity: 1; }
      100% { transform: translateY(-160px); opacity: 0; }
    }
    @keyframes contentFade {
      0%, 100% { opacity: 0; }
      1%, 99% { opacity: 1; }
    }
    @keyframes contentScroll {
      from { transform: translateY(var(--content-start, ${VIDEO_HEIGHT}px)); }
      to { transform: translateY(var(--content-end, -100%)); }
    }
  </style>
</head>
<body>
  <div class="stage">
    <main class="deck" aria-label="${escapeHtml(deck.title)}">
      <div class="ornament ornament-left"></div>
      <div class="ornament ornament-right"></div>
      ${slideMarkup}
    </main>
  </div>
  <script>
    window.__KHUTBAH_DECK__ = ${JSON.stringify({
      title: deck.title,
      passageTitles: [PASSAGE_TITLES.passage1, PASSAGE_TITLES.passage2],
      totalSeconds,
    })};

    const deckHeight = ${VIDEO_HEIGHT};
    const stage = document.querySelector('.stage');
    const updateLayout = () => {
      if (stage) {
        const scale = Math.min(window.innerWidth / ${VIDEO_WIDTH}, window.innerHeight / ${VIDEO_HEIGHT});
        stage.style.setProperty('--scale', String(scale));
      }
      document.querySelectorAll('.content-wall').forEach((wall) => {
        const height = wall.scrollHeight;
        wall.style.setProperty('--content-start', \`\${deckHeight}px\`);
        wall.style.setProperty('--content-end', \`-\${height}px\`);
      });
    };

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(updateLayout);
    }
    window.addEventListener('load', updateLayout);
    window.addEventListener('resize', updateLayout);
    updateLayout();
  </script>
</body>
</html>`;
}
