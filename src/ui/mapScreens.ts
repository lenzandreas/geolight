/**
 * The constellation map: worlds as constellations on a tree, and each world as a
 * sky of level stars. Plain DOM + SVG, so it is accessible and costs nothing at rest.
 */
import { NIGHT } from '../render/theme';
import type { Campaign } from '../game/campaign';
import type { Progress } from '../game/progress';
import { loc, t } from '../i18n';
import type { LevelDef } from '../level/schema';
import { depths, type WorldDef } from '../level/worlds';
import { constellation } from './constellation';
import { h, icon, iconButton } from './dom';
import { pieceIcon } from './pieceIcon';

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Tidy tree layout: leaves get their own column, parents sit centred above their children. */
function treeLayout(worlds: WorldDef[]): { pos: Map<string, { col: number; row: number }>; cols: number; rows: number } {
  const depth = depths(worlds);
  const children = new Map<string, WorldDef[]>();
  for (const w of worlds) if (w.parents.length) children.set(w.parents[0], [...(children.get(w.parents[0]) ?? []), w]);
  const pos = new Map<string, { col: number; row: number }>();
  const place = (w: WorldDef, start: number): number => {
    const kids = children.get(w.id) ?? [];
    if (!kids.length) {
      pos.set(w.id, { col: start, row: depth.get(w.id)! });
      return 1;
    }
    let width = 0;
    for (const k of kids) width += place(k, start + width);
    pos.set(w.id, { col: start + (width - 1) / 2, row: depth.get(w.id)! });
    return width;
  };
  let cols = 0;
  for (const root of worlds.filter((w) => !w.parents.length)) cols += place(root, cols);
  return { pos, cols, rows: Math.max(...depth.values()) + 1 };
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
  const { pos, cols, rows } = treeLayout(campaign.worlds);
  const ROW = 168;
  const sky = h('div', { class: 'sky-map', style: `height:${rows * ROW}px` });
  const lines = svg('svg', { class: 'sky-lines', viewBox: `0 0 ${cols * 100} ${rows * ROW}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  sky.append(lines);
  const centre = (id: string) => {
    const p = pos.get(id)!;
    return { x: (p.col + 0.5) * 100, y: p.row * ROW + 46 };
  };
  for (const w of campaign.worlds) {
    for (const parent of w.parents) {
      const a = centre(parent);
      const b = centre(w.id);
      lines.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: campaign.worldOpen(w) ? 'open' : '' }));
    }
  }
  for (const w of campaign.worlds) {
    const p = pos.get(w.id)!;
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
        style: `left:${((p.col + 0.5) / cols) * 100}%;top:${p.row * ROW}px;width:${Math.min(160, 100 / cols * 3.6)}px`,
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
  const portrait = window.innerHeight > window.innerWidth;
  const aspect = portrait ? 1.45 : 0.62;
  const pts = constellation(world.id + (portrait ? ':p' : ':l'), world.levels.length, aspect);
  const pad = 9;
  const at = (i: number) => ({ x: pad + pts[i].x * (100 - 2 * pad), y: pad + pts[i].y * (100 - 2 * pad) });

  const sky = h('div', { class: 'world-sky', style: `aspect-ratio:${1 / aspect}` });
  const lines = svg('svg', { class: 'sky-lines', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  for (let i = 1; i < pts.length; i++) {
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
        style: `left:${p.x}%;top:${p.y}%`,
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

  const intro = h(
    'p',
    { class: 'world-intro' },
    pieceIcon(world.object === 'divergingLens' ? 'lens' : world.object, world.object === 'divergingLens' ? { f: -1 } : {}, NIGHT, 28),
    h('span', {}, t('worldIntroduces', { piece: t(`piece_${world.object}` as Parameters<typeof t>[0]) })),
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
