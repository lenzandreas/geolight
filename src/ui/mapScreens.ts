/**
 * The constellation map: worlds as constellations on a tree, and each world as a
 * sky of level stars. Plain DOM + SVG, so it is accessible and costs nothing at rest.
 */
import { NIGHT } from '../render/theme';
import type { Campaign } from '../game/campaign';
import type { Progress } from '../game/progress';
import { loc, t } from '../i18n';
import type { LevelDef } from '../level/schema';
import { depths, featuredPieces, type WorldDef } from '../level/worlds';
import { constellation, skyLayout } from './constellation';
import { h, icon, iconButton } from './dom';
import { pieceIcon } from './pieceIcon';

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * Tidy tree layout: leaves get their own column, parents sit centred above their
 * children. Worlds with several parents (joins) are laid out afterwards, centred
 * under all their parents, one row below the deepest one.
 */
function treeLayout(worlds: WorldDef[]): { pos: Map<string, { col: number; row: number }>; cols: number; rows: number } {
  const depth = depths(worlds);
  const isJoin = (w: WorldDef) => w.parents.length > 1;
  const children = new Map<string, WorldDef[]>();
  for (const w of worlds) if (w.parents.length && !isJoin(w)) children.set(w.parents[0], [...(children.get(w.parents[0]) ?? []), w]);
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
  // Joins, in tree order so a join below another join finds its parents placed.
  for (const w of worlds.filter(isJoin)) {
    const cs = w.parents.map((p) => pos.get(p)!.col);
    const col = cs.reduce((a, b) => a + b, 0) / cs.length;
    const width = place(w, 0);
    // Shift the join's subtree so the join itself lands at `col`.
    const shift = col - pos.get(w.id)!.col;
    const moved = new Set<string>();
    const move = (id: string) => {
      if (moved.has(id)) return;
      moved.add(id);
      pos.get(id)!.col += shift;
      for (const k of children.get(id) ?? []) move(k.id);
    };
    move(w.id);
    cols = Math.max(cols, Math.ceil(col + width / 2));
  }
  // Joins with overlapping parents can land on top of each other: keep worlds in a row a column apart.
  const rows = new Map<number, { col: number; row: number }[]>();
  for (const p of pos.values()) rows.set(p.row, [...(rows.get(p.row) ?? []), p]);
  for (const row of rows.values()) {
    row.sort((a, b) => a.col - b.col);
    for (let i = 1; i < row.length; i++) row[i].col = Math.max(row[i].col, row[i - 1].col + 1);
    cols = Math.max(cols, Math.ceil(row[row.length - 1].col + 1));
  }
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

/** Narrowest column (px) before the map scrolls sideways instead of squeezing the boxes further. */
const MIN_COLUMN = 64;

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
  // Lay out in real pixels for the space available: on narrow screens the boxes get compact,
  // and only if even compact boxes don't fit does the map scroll sideways.
  const avail = Math.min(760, window.innerWidth - 24);
  const compact = avail / cols < 110;
  const colW = Math.max(MIN_COLUMN, avail / cols);
  const width = colW * cols;
  const nodeW = Math.min(128, colW - (compact ? 4 : 6));
  const nodeH = compact ? 96 : 118;
  const ROW = nodeH + (compact ? 44 : 50);
  const sky = h('div', { class: `sky-map ${compact ? 'compact' : ''}`, style: `width:${width}px;height:${rows * ROW}px` });
  const lines = svg('svg', { class: 'sky-lines', viewBox: `0 0 ${width} ${rows * ROW}`, 'aria-hidden': 'true' });
  sky.append(lines);
  const x = (id: string) => (pos.get(id)!.col + 0.5) * colW;
  const top = (id: string) => pos.get(id)!.row * ROW;
  for (const w of campaign.worlds) {
    for (const parent of w.parents) {
      // A soft S-curve from the bottom of the parent's box to the top of the child's.
      const a = { x: x(parent), y: top(parent) + nodeH };
      const b = { x: x(w.id), y: top(w.id) };
      const mid = (a.y + b.y) / 2;
      lines.append(svg('path', { d: `M${a.x},${a.y} C${a.x},${mid} ${b.x},${mid} ${b.x},${b.y}`, class: campaign.worldOpen(w) ? 'open' : '' }));
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
        style: `left:${(p.col + 0.5) * colW}px;top:${p.row * ROW}px;width:${nodeW}px;height:${nodeH}px`,
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
