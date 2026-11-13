/**
 * The constellation map: worlds as constellations spread over a sky, and each world as a
 * sky of level stars. Plain DOM + SVG, so it is accessible and costs nothing at rest.
 */
import { NIGHT } from '../render/theme';
import type { Campaign } from '../game/campaign';
import type { Progress } from '../game/progress';
import { loc, t } from '../i18n';
import type { LevelDef } from '../level/schema';
import { featuredPieces, type WorldDef } from '../level/worlds';
import { constellation, skyLayout } from './constellation';
import { h, icon, iconButton } from './dom';
import { layoutMap } from './mapLayout';
import { pieceIcon } from './pieceIcon';

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Small constellation drawing for a world on the map. */
function miniSky(world: WorldDef, solved: (id: string) => boolean): SVGSVGElement {
  const pts = constellation(world.id, world.levels.length, 0.7);
  const W = 84;
  const H = 52;
  const P = 7;
  const at = (i: number) => ({ x: P + pts[i].x * (W - 2 * P), y: P + pts[i].y * (H - 2 * P) });
  const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'mini-sky', 'aria-hidden': 'true' });
  for (let i = 1; i < pts.length; i++) {
    const a = at(i - 1);
    const b = at(i);
    el.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: solved(world.levels[i - 1]) && solved(world.levels[i]) ? 'lit' : '' }));
  }
  world.levels.forEach((id, i) => {
    const p = at(i);
    el.append(svg('circle', { cx: p.x, cy: p.y, r: solved(id) ? 2.6 : 1.8, class: solved(id) ? 'lit' : '' }));
  });
  return el;
}

export interface MapScreenOptions {
  campaign: Campaign;
  progress: Progress;
  onBack(): void;
  onSettings(): void;
  onWorld(world: WorldDef): void;
}

export function mapScreen(o: MapScreenOptions): HTMLElement {
  const { campaign } = o;
  const solved = (id: string) => !!o.progress.level(id);
  // Lay out in real pixels for the space available: on narrow screens the boxes get compact,
  // and only if even compact boxes don't fit does the map scroll sideways.
  const { at, width, height, nodeW, nodeH, compact } = layoutMap(campaign.worlds, Math.min(760, window.innerWidth - 24));
  const sky = h('div', { class: `sky-map ${compact ? 'compact' : ''}`, style: `width:${width}px;height:${height}px` });
  const lines = svg('svg', { class: 'sky-lines', viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' });
  sky.append(lines);
  for (const w of campaign.worlds) {
    for (const parent of w.parents) {
      // Straight lines between the boxes' centres, like the lines of a constellation; the boxes cover their ends.
      const a = at.get(parent)!;
      const b = at.get(w.id)!;
      lines.append(svg('line', { x1: a.x, y1: a.y + nodeH / 2, x2: b.x, y2: b.y + nodeH / 2, class: campaign.worldOpen(w) ? 'open' : '' }));
    }
  }
  for (const w of campaign.worlds) {
    const p = at.get(w.id)!;
    const open = campaign.worldOpen(w);
    const done = campaign.solvedCount(w);
    const status = open ? `${done}/${w.levels.length}` : t('locked');
    const parentNames = w.parents.map((id) => loc(campaign.world(id)!.name)).join(', ');
    const label = `${loc(w.name)}: ${status}${open ? '' : `. ${t('worldLockedHint', { n: campaign.needed(campaign.world(w.parents[0])!), world: parentNames })}`}`;
    const node = h(
      'button',
      {
        class: `world-node ${open ? 'open' : 'locked'} ${done === w.levels.length ? 'complete' : ''}`,
        type: 'button',
        style: `left:${p.x}px;top:${p.y}px;width:${nodeW}px;height:${nodeH}px`,
        'aria-label': label,
        title: label,
      },
      miniSky(w, solved),
      h('span', { class: 'world-name' }, loc(w.name)),
      h('span', { class: 'world-status' }, open ? status : '', open ? null : icon('lock')),
    );
    if (open) node.addEventListener('click', () => o.onWorld(w));
    else node.setAttribute('aria-disabled', 'true');
    sky.append(node);
  }
  return h(
    'section',
    { class: 'screen map-screen' },
    h('header', { class: 'page-header' }, iconButton('back', t('back'), o.onBack), h('h1', {}, t('starMap')), iconButton('settings', t('settings'), o.onSettings)),
    h('div', { class: 'sky-scroll' }, sky),
  );
}

export interface WorldScreenOptions {
  world: WorldDef;
  levels: LevelDef[];
  campaign: Campaign;
  progress: Progress;
  onBack(): void;
  onSettings(): void;
  onLevel(level: LevelDef): void;
}

export function worldScreen(o: WorldScreenOptions): HTMLElement {
  const { world, campaign } = o;
  const solved = (id: string) => !!o.progress.level(id);
  // Lay the stars out for the space actually available below the header.
  const availW = Math.min(820, window.innerWidth - 28);
  const availH = Math.max(320, window.innerHeight - 150);
  const layout = skyLayout(world.id, world.levels.length, availW, availH, window.innerWidth < 520 ? { w: 104, h: 112 } : { w: 132, h: 124 });
  const at = (i: number) => layout.points[i];

  const sky = h('div', { class: 'world-sky', style: `width:${layout.width}px;height:${layout.height}px` });
  const lines = svg('svg', { class: 'sky-lines', viewBox: `0 0 ${layout.width} ${layout.height}`, 'aria-hidden': 'true' });
  for (let i = 1; i < layout.points.length; i++) {
    const a = at(i - 1);
    const b = at(i);
    lines.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: solved(world.levels[i - 1]) && solved(world.levels[i]) ? 'lit' : campaign.levelOpen(world.levels[i]) ? 'open' : '' }));
  }
  sky.append(lines);

  const nextId = campaign.next(world)?.world === world ? campaign.next(world)!.level.id : null;
  world.levels.forEach((id, i) => {
    const level = o.levels.find((l) => l.id === id)!;
    const p = at(i);
    const done = o.progress.level(id);
    const open = campaign.levelOpen(id);
    const stars = h('span', { class: 'mini-stars' });
    if (done) for (let s = 0; s < 3; s++) stars.append(h('span', { class: s < done.stars ? 'on' : '' }, '★'));
    const btn = h(
      'button',
      {
        class: `star-btn ${done ? 'solved' : open ? 'open' : 'locked'} ${id === nextId ? 'next' : ''}`,
        type: 'button',
        style: `left:${p.x}px;top:${p.y}px`,
        disabled: !open,
        'aria-label': `${i + 1}. ${loc(level.name)}${open ? '' : ` (${t('locked')})`}`,
      },
      h('span', { class: 'star-dot' }, String(i + 1)),
      h('span', { class: 'star-label' }, loc(level.name)),
      stars,
    );
    btn.addEventListener('click', () => o.onLevel(level));
    sky.append(btn);
  });

  const pieces = featuredPieces(campaign.worlds, world);
  const names = pieces.map((p) => t(`piece_${p}` as Parameters<typeof t>[0]));
  const intro = h(
    'p',
    { class: 'world-intro' },
    ...pieces.map((p) => pieceIcon(p === 'divergingLens' ? 'lens' : p, p === 'divergingLens' ? { f: -1 } : {}, NIGHT, 28)),
    h(
      'span',
      {},
      world.object
        ? t('worldIntroduces', { piece: names[0] })
        : t('worldCombines', { pieces: names.slice(0, -1).join(', '), last: names[names.length - 1] }),
    ),
  );
  return h(
    'section',
    { class: 'screen world-screen' },
    h(
      'header',
      { class: 'page-header' },
      iconButton('back', t('starMap'), o.onBack),
      h('h1', {}, loc(world.name), h('small', {}, `${campaign.solvedCount(world)}/${world.levels.length}`)),
      iconButton('settings', t('settings'), o.onSettings),
    ),
    h('div', { class: 'world-body' }, intro, sky),
  );
}
