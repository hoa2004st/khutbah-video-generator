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
  const slideMarkup = slides
    .map((slide) => {
      const delay = slide.startFrame / FPS;
      const duration = slide.durationInFrames / FPS;
      const style = `--delay:${delay}s;--duration:${duration}s;`;

      if (slide.kind === 'content') {
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
      --bg: ${deck.design.backgroundColor};
      --paper: ${deck.design.fontColor};
      --gold: #d6b874;
      --teal: #1c605b;
      --deck-font: ${getFontFamily(deck.design.fontFamily)};
      --deck-bg-image: ${getBackgroundImageValue(deck.design.backgroundImage)};
      --deck-x-margin: ${(deck.design.margin / VIDEO_WIDTH) * 100}vw;
      --deck-content-size: ${(deck.design.fontSize / VIDEO_HEIGHT) * 100}vh;
      --deck-title-size: ${((deck.design.fontSize * 2.18) / VIDEO_HEIGHT) * 100}vh;
      --deck-main-title-size: ${((deck.design.fontSize * 2.82) / VIDEO_HEIGHT) * 100}vh;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: var(--bg);
      color: var(--paper);
      font-family: var(--deck-font);
    }
    .deck {
      position: relative;
      width: 100vw;
      height: 100vh;
      aspect-ratio: ${VIDEO_WIDTH} / ${VIDEO_HEIGHT};
      background:
        linear-gradient(135deg, rgba(201, 173, 108, 0.12), transparent 36%),
        linear-gradient(315deg, rgba(28, 96, 91, 0.22), transparent 42%),
        var(--deck-bg-image),
        var(--bg);
      background-position: center;
      background-size: auto, auto, cover, auto;
      overflow: hidden;
    }
    .deck::before {
      content: "";
      position: absolute;
      inset: 5.37vh;
      border: 2px solid rgba(214, 184, 116, 0.45);
      box-shadow: inset 0 0 0 1px rgba(246, 239, 225, 0.08);
      z-index: 8;
      pointer-events: none;
    }
    .slide {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      animation: slideVisible var(--duration) linear var(--delay) both;
    }
    .title-slide { text-align: center; padding: 11vh var(--deck-x-margin); }
    .title-block {
      max-width: 62vw;
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
      padding: 10.9vh var(--deck-x-margin);
      align-items: stretch;
    }
    .content-mask {
      position: relative;
      width: 100%;
      overflow: hidden;
    }
    .content-mask::before,
    .content-mask::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      z-index: 2;
      height: 14vh;
      pointer-events: none;
    }
    .content-mask::before {
      top: 0;
      background: linear-gradient(var(--bg), transparent);
    }
    .content-mask::after {
      bottom: 0;
      background: linear-gradient(transparent, var(--bg));
    }
    .content-wall {
      width: min(68.75vw, 100%);
      margin: 0 auto;
      padding: 11vh 0 22vh;
      font-size: var(--deck-content-size);
      line-height: 1.64;
      color: var(--paper);
      animation: contentScroll var(--duration) linear var(--delay) both;
    }
    .content-wall p {
      margin: 0 0 6.6vh;
      white-space: pre-wrap;
    }
    .content-wall p[dir="rtl"],
    .content-wall p:dir(rtl) {
      font-size: calc(var(--deck-content-size) * 1.18);
      line-height: 1.9;
      text-align: right;
    }
    @keyframes slideVisible {
      0%, 100% { opacity: 0; }
      7%, 86% { opacity: 1; }
    }
    @keyframes titleTravel {
      0% { transform: translateY(15vh); opacity: 0; }
      18%, 78% { transform: translateY(0); opacity: 1; }
      100% { transform: translateY(-15vh); opacity: 0; }
    }
    @keyframes contentScroll {
      from { transform: translateY(8%); }
      to { transform: translateY(-78%); }
    }
  </style>
</head>
<body>
  <main class="deck" aria-label="${escapeHtml(deck.title)}">
    ${slideMarkup}
  </main>
  <script>
    window.__KHUTBAH_DECK__ = ${JSON.stringify({
      title: deck.title,
      passageTitles: [PASSAGE_TITLES.passage1, PASSAGE_TITLES.passage2],
      totalSeconds,
    })};
  </script>
</body>
</html>`;
}
