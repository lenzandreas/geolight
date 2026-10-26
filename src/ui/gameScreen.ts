/**
 * The play screen: wires a headless Session to the renderer, pointer/keyboard
 * input, the tray and the HUD. Rendering happens only while something moves.
 */
import { sound } from '../audio/sound';
import { centre } from '../core/entities/shapes';
import { angleDelta, wrapAngle } from '../core/math';
import { evaluate, type TargetStatus } from '../core/rules';
import { trace, type TraceResult } from '../core/tracer';
import type { Entity } from '../core/types';
import type { Progress } from '../game/progress';
import { Session, starsFor, type Piece } from '../game/session';
import { loc, t } from '../i18n';
import type { LevelDef } from '../level/schema';
import { Renderer } from '../render/renderer';
import { NIGHT } from '../render/theme';
import { h, icon, iconButton } from './dom';
import { DEFAULT_ANGLE, pieceIcon, pieceNameKey } from './pieceIcon';

export interface GameScreenOptions {
  level: LevelDef;
  /** Resume an existing session (e.g. after switching language). */
  session?: Session;
  /** Small label above the level name, e.g. "Level 3" or "Daily puzzle". */
  kicker: string;
  progress: Progress;
  /** Win card contents, asked for after the solve has been recorded (so unlocks are known). */
  winCard(): WinCard;
  onExit(): void;
  onReplay(): void;
  onSettings(): void;
}

export interface WinCard {
  text: string;
  /** Extra highlighted line, e.g. a newly opened world. */
  news?: string;
  nextLabel: string;
  next(): void;
}

type Gesture =
  | { kind: 'piece'; id: string; pointerId: number; sx: number; sy: number; moved: boolean; button: number }
  | { kind: 'rotate'; id: string; pointerId: number; angle: number }
  | { kind: 'tray'; key: string; pointerId: number; sx: number; sy: number; moved: boolean };

const DRAG_THRESHOLD = 6;
const TOUCH_DRAG_THRESHOLD = 10;
/** On touch, the dragged piece floats this far (CSS px) above the finger so it stays visible. */
const TOUCH_LIFT = 56;

export class GameScreen {
  readonly el: HTMLElement;
  private session: Session;
  private renderer: Renderer;
  private canvas: HTMLCanvasElement;
  private board: HTMLElement;
  private trayList: HTMLElement;
  private trayEl: HTMLElement;
  /** A tray piece is being dragged over the tray: dropping returns it. */
  private overTray = false;
  private selBar: HTMLElement;
  private toast: HTMLElement;
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private overlay: HTMLElement | null = null;

  private displayAngles = new Map<string, number>();
  private meters = new Map<string, number>();
  private displayTrace!: TraceResult;
  private displayStatus = new Map<string, TargetStatus>();
  private displayDirty = true;
  private gesture: Gesture | null = null;
  /** Pointer position in world units during drags. */
  private pointerWorld: { x: number; y: number } | null = null;
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private hint: Entity | null = null;
  /** The level's text tip has been shown (it is the first, free hint). */
  private tipShown = false;
  private hintUntil = 0;
  private wonAt: number | null = null;
  private prevStatus = new Map<string, boolean>();
  private raf = 0;
  private lastFrame = 0;
  /** Time of the last visible change; idle animations run briefly after it. */
  private lastChange = 0;
  private readonly t0 = performance.now();
  private ro: ResizeObserver;
  private toastTimer = 0;
  private cleanup: (() => void)[] = [];

  constructor(private opts: GameScreenOptions) {
    const { level } = opts;
    this.session = opts.session ?? new Session(level);
    // Dev aid for scripted browser tests.
    if (import.meta.env.DEV) (window as unknown as { __session: Session }).__session = this.session;

    this.canvas = h('canvas', { class: 'board-canvas', tabindex: 0, 'aria-label': loc(level.name) });
    this.board = h('div', { class: 'board' }, this.canvas);
    this.toast = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    this.board.append(this.toast);
    this.renderer = new Renderer(this.canvas, NIGHT);
    this.renderer.quality = opts.progress.data.settings.quality;

    this.undoBtn = iconButton('undo', t('undo'), () => this.session.undo());
    this.redoBtn = iconButton('redo', t('redo'), () => this.session.redo());
    const header = h(
      'header',
      { class: 'game-header' },
      iconButton('back', t('back'), () => opts.onExit()),
      h('div', { class: 'level-title' }, h('span', { class: 'level-num' }, opts.kicker), h('span', { class: 'level-name' }, loc(level.name))),
      h('div', { class: 'header-actions' }, this.undoBtn, this.redoBtn, iconButton('reset', t('reset'), () => this.session.reset()), iconButton('hint', t('hint'), () => this.showHint()), iconButton('settings', t('settings'), () => opts.onSettings())),
    );

    this.trayList = h('div', { class: 'tray-list', role: 'toolbar', 'aria-label': t('tray') });
    this.selBar = h(
      'div',
      { class: 'sel-bar' },
      iconButton('rotl', t('rotateLeft'), () => this.rotateSelected(-1)),
      iconButton('rotr', t('rotateRight'), () => this.rotateSelected(1)),
      iconButton('tray', t('removePiece'), () => this.removeSelected()),
    );
    const dropLabel = h('div', { class: 'tray-drop-label', 'aria-hidden': 'true' }, icon('tray'), h('span', {}, t('removePiece')));
    this.trayEl = h('footer', { class: 'tray' }, this.trayList, this.selBar, dropLabel);
    this.el = h('section', { class: 'screen game-screen' }, header, this.board, this.trayEl);

    this.session.onChange(() => this.onModelChange());
    this.buildTray();
    this.bindInput();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.board);

    const { evaluation } = this.session.result();
    for (const s of evaluation.targets) this.prevStatus.set(s.id, s.ok);
    this.updateButtons();
    if (this.session.won) {
      this.wonAt = performance.now() - 10000;
      this.refreshTray();
      this.updateButtons();
      this.showWinOverlay(starsFor(this.session));
    } else if (level.intro && level.introOnStart && !this.session.canUndo) {
      this.showToast(loc(level.intro), 0);
      this.tipShown = true;
    }
  }

  /** Re-read settings that affect rendering. */
  applySettings(): void {
    this.renderer.quality = this.opts.progress.data.settings.quality;
    this.resize();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    clearTimeout(this.toastTimer);
    for (const fn of this.cleanup) fn();
  }

  /* ---------- Layout & frame loop ---------- */

  private resize(): void {
    const r = this.board.getBoundingClientRect();
    this.renderer.resize(r.width, r.height, this.session.level.grid.w, this.session.level.grid.h);
    this.requestFrame();
  }

  private requestFrame(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private get reducedMotion(): boolean {
    return this.opts.progress.data.settings.reducedMotion;
  }

  private targetAngle(p: Piece): number {
    const g = this.gesture;
    if (g?.kind === 'rotate' && g.id === p.id) return g.angle;
    return p.angle;
  }

  /** Cell under the pointer while dragging, with drop validity. */
  private dropCell(): { x: number; y: number; valid: boolean } | null {
    const g = this.gesture;
    if (!this.pointerWorld || !g || g.kind === 'rotate' || !g.moved) return null;
    const x = Math.floor(this.pointerWorld.x);
    const y = Math.floor(this.pointerWorld.y);
    if (!this.session.inGrid(x, y)) return null;
    const ignore = g.kind === 'piece' ? g.id : undefined;
    return { x, y, valid: this.session.canPlaceAt(x, y, ignore) };
  }

  /** Entities as currently shown (tweened angles, piece being dragged). */
  private displayEntities(): { optics: Entity[]; floating: { entity: Entity; valid: boolean } | null } {
    const g = this.gesture;
    const drop = this.dropCell();
    const optics: Entity[] = [];
    let floating: { entity: Entity; valid: boolean } | null = null;
    for (const p of this.session.pieces) {
      const angle = this.displayAngles.get(p.id) ?? p.angle;
      if (g?.kind === 'piece' && g.moved && g.id === p.id && this.overTray) continue;
      if (g?.kind === 'piece' && g.moved && g.id === p.id && this.pointerWorld) {
        if (drop?.valid) optics.push({ ...p, x: drop.x, y: drop.y, angle });
        else floating = { entity: { ...p, x: this.pointerWorld.x - 0.5, y: this.pointerWorld.y - 0.5, angle }, valid: false };
        continue;
      }
      optics.push(angle === p.angle ? p : { ...p, angle });
    }
    if (g?.kind === 'tray' && g.moved && this.pointerWorld) {
      const slot = this.session.slots.find((s) => s.key === g.key)!;
      const angle = DEFAULT_ANGLE[slot.type] ?? 0;
      const e: Entity = { id: '__tray', type: slot.type, x: 0, y: 0, angle, params: slot.params };
      if (drop?.valid) optics.push({ ...e, x: drop.x, y: drop.y });
      else floating = { entity: { ...e, x: this.pointerWorld.x - 0.5, y: this.pointerWorld.y - 0.5 }, valid: false };
    }
    return { optics, floating };
  }

  private frame = (now: number): void => {
    this.raf = 0;
    const dt = Math.min(0.05, (now - (this.lastFrame || now)) / 1000);
    this.lastFrame = now;
    let active = false;

    // Tween displayed angles towards their targets.
    const k = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 20);
    for (const p of this.session.pieces) {
      const target = this.targetAngle(p);
      const cur = this.displayAngles.get(p.id) ?? p.angle;
      const d = angleDelta(cur, target);
      if (Math.abs(d) > 0.25) {
        this.displayAngles.set(p.id, wrapAngle(cur + d * k));
        this.displayDirty = true;
        active = true;
      } else if (cur !== target) {
        this.displayAngles.set(p.id, target);
        this.displayDirty = true;
      }
    }

    const { optics, floating } = this.displayEntities();
    if (this.displayDirty || !this.displayTrace) {
      const grid = this.session.level.grid;
      this.displayTrace = trace(optics, { width: grid.w, height: grid.h });
      this.displayStatus = new Map(evaluate(optics, this.displayTrace).targets.map((s) => [s.id, s]));
      this.displayDirty = false;
    }

    // Smooth the meters.
    const shown = new Map<string, TargetStatus>();
    const km = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 9);
    for (const [id, s] of this.displayStatus) {
      const cur = this.meters.get(id) ?? 0;
      let m = s.progress;
      if (Math.abs(m - cur) > 0.003) {
        m = cur + (m - cur) * km;
        active = true;
      }
      this.meters.set(id, m);
      // Sinks light up once their meter has filled; sensors react immediately.
      shown.set(id, { ...s, progress: m, ok: s.kind === 'sink' ? s.ok && m > 0.995 : s.ok });
    }

    const wonFor = this.wonAt === null ? -1 : (now - this.wonAt) / 1000;
    if (wonFor >= 0 && wonFor < 4 && !this.reducedMotion) active = true;
    if (this.hint && now < this.hintUntil && !this.reducedMotion) active = true;
    // Pulse while something is alarmed or a bulb glows, but only briefly after a change.
    if (now - this.lastChange < 2500 && !this.reducedMotion) active = true;

    const lockOf = (id: string) => (id === '__tray' ? 'tray' : this.session.get(id)?.lock ?? 'fixed');
    this.renderer.draw({
      gridW: this.session.level.grid.w,
      gridH: this.session.level.grid.h,
      pieces: optics,
      trace: this.displayTrace,
      statuses: shown,
      lockOf,
      selectedId: this.gesture?.kind === 'piece' && this.gesture.moved ? null : this.selectedId,
      hoverId: this.hoverId,
      floating,
      hint: this.hint,
      dropCell: this.dropCell(),
      time: this.reducedMotion ? 0 : (now - this.t0) / 1000,
      wonFor: this.reducedMotion && wonFor >= 0 ? 0.6 : wonFor,
    });
    if (active) this.requestFrame();
  };

  private touch(): void {
    this.lastChange = performance.now();
    this.displayDirty = true;
    this.requestFrame();
  }

  /* ---------- Model changes ---------- */

  private onModelChange(): void {
    this.touch();
    this.updateButtons();
    this.refreshTray();
    if (this.selectedId && !this.session.get(this.selectedId)) this.select(null);
    if (this.hint && this.session.nextHint() === null) this.hint = null;
    else if (this.hint) this.updateHintGhost();

    const { evaluation } = this.session.result();
    let i = 0;
    for (const s of evaluation.targets) {
      const was = this.prevStatus.get(s.id);
      if (s.kind === 'sink' && s.ok && !was) sound.play('lit', i++);
      if (s.kind === 'sink' && !s.ok && was) sound.play('unlit');
      if (s.kind === 'sensor' && !s.ok && was !== false) {
        sound.play('alarm');
        this.showToast(t('sensorTripped'), 2500);
      }
      if (s.contaminated) this.showToast(t('wrongColor'), 2500);
      this.prevStatus.set(s.id, s.ok);
    }
    if (evaluation.won && this.wonAt === null) this.win();
  }

  private win(): void {
    this.wonAt = performance.now();
    this.select(null);
    this.hint = null;
    const stars = starsFor(this.session);
    this.opts.progress.complete(this.session.level.id, stars, this.session.placedCount);
    setTimeout(() => sound.play('win'), 250);
    setTimeout(() => this.showWinOverlay(stars), this.reducedMotion ? 300 : 1300);
    this.requestFrame();
  }

  private showWinOverlay(stars: number): void {
    const starRow = h('div', { class: 'stars', 'aria-label': `${stars} / 3` });
    for (let i = 0; i < 3; i++) {
      const s = h('span', { class: `star ${i < stars ? 'on' : ''}`, style: `animation-delay:${0.15 + i * 0.15}s` });
      s.append(icon('star', i < stars));
      starRow.append(s);
    }
    const info = this.opts.winCard();
    // Tell players why a star is missing when they used more pieces than needed (decoys in the tray make this common).
    const { par, placedCount } = this.session;
    const parNote = par > 0 && placedCount > par ? (par === 1 ? t('parMissedOne') : t('parMissed', { n: par })) : null;
    const next = h('button', { class: 'btn primary', type: 'button' }, info.nextLabel);
    next.addEventListener('click', () => info.next());
    const card = h(
      'div',
      { class: 'card win-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'win-title' },
      h('h2', { id: 'win-title' }, t('solved')),
      starRow,
      h('p', {}, info.text),
      parNote ? h('p', { class: 'win-par' }, parNote) : null,
      info.news ? h('p', { class: 'win-news' }, info.news) : null,
      h('div', { class: 'card-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => this.opts.onReplay() }, t('replay')), next),
    );
    this.overlay = h('div', { class: 'overlay' }, card);
    this.el.append(this.overlay);
    next.focus();
  }

  /* ---------- HUD ---------- */

  private updateButtons(): void {
    this.undoBtn.disabled = !this.session.canUndo || this.wonAt !== null;
    this.redoBtn.disabled = !this.session.canRedo || this.wonAt !== null;
    const sel = this.selectedId ? this.session.get(this.selectedId) : null;
    this.selBar.classList.toggle('visible', !!sel);
    const [l, r, rm] = this.selBar.querySelectorAll('button');
    if (sel) {
      l.disabled = r.disabled = !this.session.canRotate(sel);
      rm.disabled = sel.lock !== 'tray';
    }
  }

  private buildTray(): void {
    this.trayList.replaceChildren();
    if (!this.session.slots.length) {
      this.trayList.append(h('p', { class: 'tray-empty' }, t('trayEmpty')));
      return;
    }
    for (const slot of this.session.slots) {
      const name = t(pieceNameKey(slot.type, slot.params) as Parameters<typeof t>[0]);
      const btn = h('button', { class: 'tray-item', type: 'button', 'data-key': slot.key, 'aria-label': name, title: name });
      btn.append(pieceIcon(slot.type, slot.params, NIGHT), h('span', { class: 'count' }));
      btn.addEventListener('pointerdown', (ev) => this.onTrayDown(ev, slot.key));
      btn.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          this.autoPlace(slot.key);
          // Continue with arrows/Q/E on the board.
          this.canvas.focus({ preventScroll: true });
        }
      });
      this.trayList.append(btn);
    }
    this.refreshTray();
  }

  private refreshTray(): void {
    for (const btn of this.trayList.querySelectorAll<HTMLButtonElement>('.tray-item')) {
      const n = this.session.remaining(btn.dataset.key!);
      btn.querySelector('.count')!.textContent = `×${n}`;
      btn.disabled = n <= 0 || this.wonAt !== null;
    }
  }

  private showToast(text: string, ms: number): void {
    this.toast.textContent = text;
    this.toast.classList.add('visible');
    clearTimeout(this.toastTimer);
    if (ms > 0) this.toastTimer = window.setTimeout(() => this.toast.classList.remove('visible'), ms);
  }

  private hideIntro(): void {
    if (!this.toastTimer) this.toast.classList.remove('visible');
  }

  private showHint(): void {
    // The level's text comes first and is free; later hints show where pieces go.
    const intro = this.session.level.intro;
    if (intro && !this.tipShown) {
      this.tipShown = true;
      this.showToast(loc(intro), 0);
      return;
    }
    const step = this.session.nextHint();
    if (!step) {
      this.showToast(t('noHint'), 2500);
      return;
    }
    this.session.hintsUsed++;
    this.updateHintGhost();
    this.hintUntil = performance.now() + 4000;
    this.showToast(t('hintShown'), 3000);
    this.touch();
  }

  private updateHintGhost(): void {
    const step = this.session.nextHint();
    if (!step) {
      this.hint = null;
      return;
    }
    const base = step.id ? this.session.get(step.id) : null;
    this.hint = { id: '__hint', type: base?.type ?? step.type!, x: step.x, y: step.y, angle: step.angle, params: base?.params ?? step.params ?? {} };
  }

  /* ---------- Actions ---------- */

  private select(id: string | null): void {
    this.selectedId = this.wonAt === null ? id : null;
    this.updateButtons();
    this.requestFrame();
  }

  private rotateSelected(steps: number): void {
    if (this.selectedId && this.session.rotate(this.selectedId, steps)) sound.play('rotate', steps > 0 ? 1 : 0);
  }

  private removeSelected(): void {
    if (this.selectedId && this.session.remove(this.selectedId)) sound.play('remove');
  }

  /** Place a tray piece without dragging: nearest free cell to the board centre. */
  private autoPlace(key: string): void {
    const { w, h: gh } = this.session.level.grid;
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let x = 0; x < w; x++)
      for (let y = 0; y < gh; y++) {
        if (!this.session.canPlaceAt(x, y)) continue;
        const d = Math.hypot(x + 0.5 - w / 2, y + 0.5 - gh / 2);
        if (d < bestD) {
          bestD = d;
          best = [x, y];
        }
      }
    if (!best) return;
    this.placeFromTray(key, best[0], best[1]);
  }

  private placeFromTray(key: string, x: number, y: number): void {
    const slot = this.session.slots.find((s) => s.key === key);
    if (!slot) return;
    const p = this.session.place(key, x, y, DEFAULT_ANGLE[slot.type] ?? 0);
    if (p) {
      this.displayAngles.set(p.id, p.angle);
      sound.play('place');
      this.select(p.id);
    }
  }

  /* ---------- Input ---------- */

  private toWorld(ev: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return this.renderer.view.toWorld({ x: ev.clientX - r.left, y: ev.clientY - r.top });
  }

  /** Where a dragged piece is: lifted above the finger on touch screens. */
  private dragWorld(ev: PointerEvent): { x: number; y: number } {
    const lift = ev.pointerType === 'touch' ? TOUCH_LIFT : 0;
    const r = this.canvas.getBoundingClientRect();
    return this.renderer.view.toWorld({ x: ev.clientX - r.left, y: ev.clientY - lift - r.top });
  }

  private isOverTray(ev: PointerEvent): boolean {
    const r = this.trayEl.getBoundingClientRect();
    return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
  }

  /** Track the drag position and the tray drop zone. */
  private updateDrag(ev: PointerEvent, canReturn: boolean): void {
    this.overTray = canReturn && this.isOverTray(ev);
    this.pointerWorld = this.overTray ? null : this.dragWorld(ev);
    this.trayEl.classList.toggle('drop-ready', canReturn);
    this.trayEl.classList.toggle('drop-hover', this.overTray);
    this.touch();
  }

  private endDrag(): void {
    this.overTray = false;
    this.pointerWorld = null;
    this.trayEl.classList.remove('drop-ready', 'drop-hover');
  }

  private pickPiece(w: { x: number; y: number }): Piece | undefined {
    let best: Piece | undefined;
    let bestD = 0.62;
    for (const p of this.session.pieces) {
      if (p.type === 'wall' || p.lock === 'fixed') continue;
      const c = centre(p);
      const d = Math.hypot(w.x - c.x, w.y - c.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private onHandle(w: { x: number; y: number }): boolean {
    const sel = this.selectedId ? this.session.get(this.selectedId) : null;
    if (!sel || !this.session.canRotate(sel)) return false;
    const c = centre(sel);
    const a = ((this.displayAngles.get(sel.id) ?? sel.angle) * Math.PI) / 180;
    const hx = c.x + Math.cos(a) * Renderer.HANDLE_R;
    const hy = c.y + Math.sin(a) * Renderer.HANDLE_R;
    return Math.hypot(w.x - hx, w.y - hy) < 0.3;
  }

  private snapAngleTowards(id: string, w: { x: number; y: number }): number {
    const p = this.session.get(id)!;
    const c = centre(p);
    const raw = (Math.atan2(w.y - c.y, w.x - c.x) * 180) / Math.PI;
    const step = this.session.rotationStep;
    return wrapAngle(Math.round(raw / step) * step);
  }

  private bindInput(): void {
    const cv = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Window, type: K, fn: (ev: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    on(cv, 'contextmenu', (ev) => ev.preventDefault());

    on(cv, 'pointerdown', (ev) => {
      if (this.wonAt !== null) return;
      sound.unlock();
      this.hideIntro();
      const w = this.toWorld(ev);
      if (this.onHandle(w)) {
        this.gesture = { kind: 'rotate', id: this.selectedId!, pointerId: ev.pointerId, angle: this.session.get(this.selectedId!)!.angle };
        cv.setPointerCapture(ev.pointerId);
        return;
      }
      const p = this.pickPiece(w);
      if (!p) {
        this.select(null);
        return;
      }
      this.gesture = { kind: 'piece', id: p.id, pointerId: ev.pointerId, sx: ev.clientX, sy: ev.clientY, moved: false, button: ev.button };
      cv.setPointerCapture(ev.pointerId);
    });

    on(cv, 'pointermove', (ev) => {
      const w = this.toWorld(ev);
      const g = this.gesture;
      if (!g) {
        if (ev.pointerType === 'mouse') {
          const id = this.pickPiece(w)?.id ?? null;
          const handle = this.onHandle(w);
          cv.style.cursor = handle ? 'grab' : id ? 'pointer' : 'default';
          if (id !== this.hoverId) {
            this.hoverId = id;
            this.requestFrame();
          }
        }
        return;
      }
      if (g.pointerId !== ev.pointerId) return;
      if (g.kind === 'rotate') {
        const a = this.snapAngleTowards(g.id, w);
        if (a !== g.angle) {
          g.angle = a;
          sound.play('rotate');
          this.touch();
        }
        return;
      }
      if (g.kind === 'piece') {
        const threshold = ev.pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD : DRAG_THRESHOLD;
        if (!g.moved && Math.hypot(ev.clientX - g.sx, ev.clientY - g.sy) > threshold) {
          const p = this.session.get(g.id)!;
          if (this.session.canMove(p)) {
            g.moved = true;
            sound.play('pick');
          } else if (this.session.canRotate(p)) {
            // Rotate-only pieces: dragging turns them towards the pointer.
            this.select(p.id);
            this.gesture = { kind: 'rotate', id: p.id, pointerId: g.pointerId, angle: p.angle };
            return;
          }
        }
        if (g.moved) this.updateDrag(ev, this.session.get(g.id)?.lock === 'tray');
      }
    });

    const endPointer = (ev: PointerEvent) => {
      const g = this.gesture;
      if (!g || g.pointerId !== ev.pointerId || g.kind === 'tray') return;
      // Read the drop target while the gesture is still active.
      const drop = this.dropCell();
      this.gesture = null;
      if (g.kind === 'rotate') {
        if (this.session.setAngle(g.id, g.angle)) sound.play('click');
        this.touch();
        return;
      }
      const p = this.session.get(g.id);
      if (!p) return;
      if (!g.moved) {
        if (ev.type === 'pointercancel') return;
        const dir = g.button === 2 || ev.shiftKey ? -1 : 1;
        if (this.selectedId === p.id || g.button === 2) this.rotateSelectedPiece(p.id, dir);
        this.select(p.id);
        return;
      }
      const returning = this.overTray;
      this.endDrag();
      if (ev.type === 'pointercancel') {
        // Interrupted (e.g. a system gesture): leave the piece where it was.
      } else if (returning) {
        this.session.remove(p.id);
        sound.play('remove');
      } else if (drop?.valid) {
        this.session.move(p.id, drop.x, drop.y);
        sound.play('place');
        this.select(p.id);
      } else {
        // Anywhere else (off the board, an occupied cell): snap back.
        this.select(p.id);
      }
      this.touch();
    };
    on(cv, 'pointerup', endPointer);
    on(cv, 'pointercancel', endPointer);
    on(cv, 'pointerleave', () => {
      if (this.hoverId) {
        this.hoverId = null;
        this.requestFrame();
      }
    });

    on(
      cv,
      'wheel',
      (ev) => {
        const w = this.toWorld(ev);
        const p = this.pickPiece(w) ?? (this.selectedId ? this.session.get(this.selectedId) : undefined);
        if (!p || !this.session.canRotate(p)) return;
        ev.preventDefault();
        this.rotateSelectedPiece(p.id, ev.deltaY > 0 ? 1 : -1);
        this.select(p.id);
      },
      { passive: false },
    );

    on(window, 'keydown', (ev) => this.onKey(ev));
  }

  private rotateSelectedPiece(id: string, dir: number): void {
    if (this.session.rotate(id, dir)) sound.play('rotate', dir > 0 ? 1 : 0);
  }

  private onTrayDown(ev: PointerEvent, key: string): void {
    if (this.wonAt !== null || this.session.remaining(key) <= 0) return;
    sound.unlock();
    this.hideIntro();
    const btn = ev.currentTarget as HTMLElement;
    btn.setPointerCapture(ev.pointerId);
    this.gesture = { kind: 'tray', key, pointerId: ev.pointerId, sx: ev.clientX, sy: ev.clientY, moved: false };
    const move = (e: PointerEvent) => {
      const g = this.gesture;
      if (!g || g.kind !== 'tray' || e.pointerId !== g.pointerId) return;
      const threshold = e.pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD : DRAG_THRESHOLD;
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > threshold) {
        g.moved = true;
        sound.play('pick');
      }
      if (g.moved) this.updateDrag(e, false);
    };
    const up = (e: PointerEvent) => {
      const g = this.gesture;
      btn.removeEventListener('pointermove', move);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointercancel', up);
      if (!g || g.kind !== 'tray') return;
      const drop = this.dropCell();
      this.gesture = null;
      this.endDrag();
      if (e.type === 'pointercancel') {
        this.touch();
        return;
      }
      if (!g.moved) this.autoPlace(key);
      else if (drop?.valid) this.placeFromTray(key, drop.x, drop.y);
      this.touch();
    };
    btn.addEventListener('pointermove', move);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
  }

  private onKey(ev: KeyboardEvent): void {
    if (this.overlay || document.querySelector('.modal-root .overlay')) return;
    const target = ev.target as HTMLElement;
    if (target && target !== this.canvas && target !== document.body && !this.el.contains(target)) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) this.session.redo();
      else this.session.undo();
      return;
    }
    if (mod && ev.key.toLowerCase() === 'y') {
      ev.preventDefault();
      this.session.redo();
      return;
    }
    if (ev.key === 'Escape') {
      if (this.selectedId) this.select(null);
      else this.opts.onExit();
      return;
    }
    if (ev.key.toLowerCase() === 'h' && !mod) {
      this.showHint();
      return;
    }
    // The remaining keys act on the board when it has focus.
    if (target !== this.canvas) return;
    if (ev.key === 'Tab') {
      const ids = this.session.pieces.filter((p) => p.lock !== 'fixed').map((p) => p.id);
      if (!ids.length) return;
      ev.preventDefault();
      const i = this.selectedId ? ids.indexOf(this.selectedId) : -1;
      this.select(ids[(i + (ev.shiftKey ? -1 : 1) + ids.length) % ids.length]);
      return;
    }
    const sel = this.selectedId ? this.session.get(this.selectedId) : null;
    if (!sel) return;
    const k = ev.key.toLowerCase();
    if (k === 'q' || k === '[') this.rotateSelected(-1);
    else if (k === 'e' || k === ']' || k === 'r') this.rotateSelected(1);
    else if (k === 'delete' || k === 'backspace') this.removeSelected();
    else if (k.startsWith('arrow') && this.session.canMove(sel)) {
      ev.preventDefault();
      // Arrow keys follow the screen, so map them through the view rotation.
      let [dx, dy] = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k] as [number, number];
      if (this.renderer.view.rotated) [dx, dy] = [dy, -dx];
      for (let x = sel.x + dx, y = sel.y + dy; this.session.inGrid(x, y); x += dx, y += dy) {
        if (this.session.canPlaceAt(x, y, sel.id)) {
          this.session.move(sel.id, x, y);
          sound.play('click');
          break;
        }
      }
    } else return;
    ev.preventDefault();
  }
}
