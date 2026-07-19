import { BUILDINGS } from './config.js';
import {
  axialToPixel, getHexCorners, parseKey, HEX_SIZE, pixelToAxial,
  axialKey, hexNeighbors,
} from './hex.js';

const COLORS = {
  grass: ['#9fd48a', '#a8db96', '#94cc82'],
  grassDark: ['#6fa878', '#7ab684', '#85c08e'],
  edge: '#7aab7e',
  shadow: 'rgba(90, 70, 100, 0.18)',
};

// Sprites pixel-art suavizado: o=contorno, h=brillo, c=pelaje,
// l=claro (hocico/pecho), e=ojo, n=nariz, b=blush, .=vacío
const CAT_SPRITES = {
  stand: [
    '..oo......oo..',
    '.oco......oco.',
    '.occoooooocco.',
    'ohhhhhhhhhhhho',
    'ohhhhhhhhhhhho',
    'occcecccceccco',
    'occcccnnccccco',
    'obcccllllcccbo',
    '.oooooooooooo.',
    '...ocllllco...',
    '...ocllllco...',
    '...ocllllco...',
    '...ooo..ooo...',
  ],
  loaf: [
    '...oo......oo...',
    '..oco......oco..',
    '..occoooooocco..',
    '.ohhhhhhhhhhhho.',
    '.occcecccceccco.',
    '.obcccllllcccbo.',
    'oclcccccccccclco',
    'occcccccccccccco',
    '.oooooooooooooo.',
  ],
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.offsetX = 0;
    this.offsetY = 0;
    this.scale = 1;
    this.dragging = false;
    this.lastTouch = null;
    this.highlightKey = null;
    this.expandableKeys = new Set();
    this.selectedBuild = null;
    this.catAnimations = new Map();

    this._bindEvents();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = rect.width;
    this.viewH = rect.height;
  }

  centerOnHexes(hexes) {
    if (!hexes.size) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    hexes.forEach((hex) => {
      const p = axialToPixel(hex.q, hex.r);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    });
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.offsetX = this.viewW / 2 - cx * this.scale;
    this.offsetY = this.viewH / 2 - cy * this.scale;
  }

  _bindEvents() {
    const c = this.canvas;

    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastTouch = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.dragging || !this.lastTouch) return;
      const dx = e.clientX - this.lastTouch.x;
      const dy = e.clientY - this.lastTouch.y;
      this.offsetX += dx;
      this.offsetY += dy;
      this.lastTouch = { x: e.clientX, y: e.clientY };
    });

    c.addEventListener('pointerup', (e) => {
      if (this.lastTouch) {
        const dx = e.clientX - this.lastTouch.x;
        const dy = e.clientY - this.lastTouch.y;
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
          this._onTap(e.clientX, e.clientY);
        }
      }
      this.dragging = false;
      this.lastTouch = null;
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 0.92 : 1.08);
    }, { passive: false });

    c.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        this._pinchStart = this._pinchDistance(e.touches);
        this._scaleStart = this.scale;
      }
    }, { passive: true });

    c.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && this._pinchStart) {
        e.preventDefault();
        const dist = this._pinchDistance(e.touches);
        const factor = dist / this._pinchStart;
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const newScale = Math.max(0.5, Math.min(2.5, this._scaleStart * factor));
        const rect = c.getBoundingClientRect();
        const mx = cx - rect.left;
        const my = cy - rect.top;
        const ratio = newScale / this.scale;
        this.offsetX = mx - (mx - this.offsetX) * ratio;
        this.offsetY = my - (my - this.offsetY) * ratio;
        this.scale = newScale;
      }
    }, { passive: false });

    c.addEventListener('touchend', () => {
      this._pinchStart = null;
    });
  }

  _pinchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  _zoomAt(clientX, clientY, factor) {
    const rect = this.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const newScale = Math.max(0.5, Math.min(2.5, this.scale * factor));
    const ratio = newScale / this.scale;
    this.offsetX = mx - (mx - this.offsetX) * ratio;
    this.offsetY = my - (my - this.offsetY) * ratio;
    this.scale = newScale;
  }

  _onTap(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.offsetX) / this.scale;
    const y = (clientY - rect.top - this.offsetY) / this.scale;
    const { q, r } = pixelToAxial(x, y);
    const key = axialKey(q, r);
    if (this.onHexClick) this.onHexClick(key);
  }

  screenToHex(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.offsetX) / this.scale;
    const y = (clientY - rect.top - this.offsetY) / this.scale;
    return { x, y };
  }

  draw(state, hexes, cats) {
    const ctx = this.ctx;
    const now = performance.now();
    const delta = Math.min(.05, (now - (this._lastDraw || now)) / 1000);
    this._lastDraw = now;
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    this._drawBackground();

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    if (this.selectedBuild === 'hex_tile') {
      this.expandableKeys.forEach((key) => {
        if (hexes.has(key)) return;
        const { q, r } = parseKey(key);
        this._drawGhostHex(q, r);
      });
    }

    const sorted = [...hexes.entries()].sort((a, b) => {
      const pa = axialToPixel(a[1].q, a[1].r);
      const pb = axialToPixel(b[1].q, b[1].r);
      return pa.y - pb.y;
    });

    sorted.forEach(([key, hex]) => {
      const isExpand = this.expandableKeys.has(key);
      const isHighlight = this.highlightKey === key;
      this._drawHex(hex, key, isExpand, isHighlight);
    });

    this._drawBoundaryFences(hexes);

    cats.forEach((cat) => {
      if (!hexes.has(cat.hexKey)) return;
      this._drawCat(cat, hexes.get(cat.hexKey), delta);
    });

    ctx.restore();
  }

  _drawBackground() {
    const ctx = this.ctx;
    const grd = ctx.createLinearGradient(0, 0, 0, this.viewH);
    grd.addColorStop(0, '#c8d8f0');
    grd.addColorStop(0.35, '#e8d0e4');
    grd.addColorStop(0.7, '#f5dcc8');
    grd.addColorStop(1, '#f0e4c8');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    const glow = ctx.createRadialGradient(
      this.viewW * .55, this.viewH * .12, 0,
      this.viewW * .55, this.viewH * .12, this.viewW * .55,
    );
    glow.addColorStop(0, 'rgba(255, 245, 200, .55)');
    glow.addColorStop(1, 'rgba(255, 245, 200, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    // Soft cloud blobs (flat depth layers)
    ctx.save();
    const t = Date.now() / 18000;
    for (let i = 0; i < 6; i++) {
      const x = ((i * 160 + t * (12 + i * 3)) % (this.viewW + 120)) - 60;
      const y = 28 + (i % 3) * 36;
      ctx.globalAlpha = .22 + (i % 3) * .04;
      ctx.fillStyle = '#fff8f0';
      this._softBlob(ctx, x, y, 38 + (i % 3) * 10, 14);
      this._softBlob(ctx, x + 22, y - 4, 28, 12);
    }
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = .14;
    ctx.fillStyle = '#fff8e8';
    for (let i = 0; i < 22; i++) {
      const x = (i * 137 + t * (6 + i % 3) * 14) % (this.viewW + 40) - 20;
      const y = (i * 83) % Math.max(this.viewH, 1);
      ctx.beginPath();
      ctx.arc(x, y, 1.2 + (i % 3) * .5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _softBlob(ctx, x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawHex(hex, key, isExpandable, isHighlight) {
    const { q, r } = hex;
    const { x, y } = axialToPixel(q, r);
    const size = HEX_SIZE;
    const corners = getHexCorners(x, y, size - 1);

    const hash = Math.abs(q * 7 + r * 13) % 3;
    const baseColor = COLORS.grass[hash];

    this._drawHexPrism(corners, baseColor, 0.12, isHighlight, isExpandable);
    this._drawGroundDetails(x, y, q, r, Boolean(hex.building));

    if (hex.building && BUILDINGS[hex.building]) {
      this._drawBuilding(x, y, hex);
    }

    if (isExpandable && this.selectedBuild === 'hex_tile') {
      this._drawExpandHint(corners);
    }
  }

  _drawHexPrism(corners, topColor, depth, highlight, expandable) {
    const ctx = this.ctx;
    const depthPx = depth * HEX_SIZE * 2.6;

    // Soft ground shadow under hex (flat depth)
    const cx = corners.reduce((s, c) => s + c.x, 0) / 6;
    const cy = corners.reduce((s, c) => s + c.y, 0) / 6;
    const softShadow = ctx.createRadialGradient(cx + 2, cy + depthPx + 4, 2, cx + 2, cy + depthPx + 4, HEX_SIZE * .95);
    softShadow.addColorStop(0, 'rgba(100, 80, 110, .16)');
    softShadow.addColorStop(1, 'rgba(100, 80, 110, 0)');
    ctx.fillStyle = softShadow;
    ctx.beginPath();
    ctx.ellipse(cx + 2, cy + depthPx + 5, HEX_SIZE * .9, HEX_SIZE * .42, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    corners.forEach((c, i) => {
      if (i === 0) ctx.moveTo(c.x, c.y + depthPx);
      else ctx.lineTo(c.x, c.y + depthPx);
    });
    ctx.closePath();
    ctx.fillStyle = COLORS.grassDark[1];
    ctx.fill();

    for (let i = 0; i < 6; i++) {
      const c1 = corners[i];
      const c2 = corners[(i + 1) % 6];
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.lineTo(c2.x, c2.y);
      ctx.lineTo(c2.x, c2.y + depthPx);
      ctx.lineTo(c1.x, c1.y + depthPx);
      ctx.closePath();
      const sideGrad = ctx.createLinearGradient(c1.x, c1.y, c1.x, c1.y + depthPx);
      const mid = i % 2 === 0 ? COLORS.grassDark[0] : COLORS.grassDark[2];
      sideGrad.addColorStop(0, this._lighten(mid, .08));
      sideGrad.addColorStop(1, mid);
      ctx.fillStyle = sideGrad;
      ctx.fill();
    }

    ctx.beginPath();
    corners.forEach((c, i) => {
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.closePath();

    if (expandable) {
      ctx.fillStyle = 'rgba(255, 210, 140, 0.4)';
    } else if (highlight) {
      ctx.fillStyle = 'rgba(255, 210, 140, 0.58)';
    } else {
      const topGradient = ctx.createLinearGradient(
        corners[0].x, corners[2].y,
        corners[3].x, corners[5].y,
      );
      topGradient.addColorStop(0, this._lighten(topColor, .18));
      topGradient.addColorStop(.55, topColor);
      topGradient.addColorStop(1, this._darken(topColor, .06));
      ctx.fillStyle = topGradient;
    }
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 170, 130, .55)';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.save();
    ctx.clip();
    const shine = ctx.createLinearGradient(0, corners[2].y, 0, corners[5].y);
    shine.addColorStop(0, 'rgba(255,255,240,.22)');
    shine.addColorStop(.45, 'rgba(255,255,240,0)');
    ctx.fillStyle = shine;
    ctx.fillRect(corners[4].x, corners[2].y, corners[1].x - corners[4].x, corners[5].y - corners[2].y);
    ctx.restore();
  }

  _drawGhostHex(q, r) {
    const { x, y } = axialToPixel(q, r);
    const corners = getHexCorners(x, y, HEX_SIZE - 3);
    const ctx = this.ctx;
    const pulse = .3 + Math.sin(Date.now() / 320) * .08;
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    corners.forEach((corner, i) => i ? ctx.lineTo(corner.x, corner.y) : ctx.moveTo(corner.x, corner.y));
    ctx.closePath();
    ctx.fillStyle = `rgba(255,225,146,${pulse})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,239,188,.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `700 ${HEX_SIZE * .38}px Nunito, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff1bc';
    ctx.fillText('+', x, y);
    ctx.restore();
  }

  _drawGroundDetails(x, y, q, r, occupied) {
    if (occupied) return;
    const hash = Math.abs(q * 31 + r * 17);
    if (hash % 3 !== 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = .8;
    const ox = ((hash % 19) - 9) * 1.15;
    const oy = (((hash * 7) % 15) - 7) * .75;
    if (hash % 2 === 0) {
      // Soft pastel flower
      const petal = hash % 4 === 0 ? '#f8d890' : '#f8b0b8';
      ctx.fillStyle = petal;
      for (let i = 0; i < 5; i++) {
        const a = i * Math.PI * 2 / 5 - Math.PI / 2;
        ctx.beginPath();
        ctx.ellipse(
          x + ox + Math.cos(a) * 2.6,
          y + oy + Math.sin(a) * 2.6,
          2.2, 1.6, a, 0, Math.PI * 2,
        );
        ctx.fill();
      }
      const center = ctx.createRadialGradient(x + ox, y + oy, .2, x + ox, y + oy, 2);
      center.addColorStop(0, '#fff8c8');
      center.addColorStop(1, '#f0d070');
      ctx.fillStyle = center;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, 1.6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#78b888';
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy + 4);
      ctx.quadraticCurveTo(x + ox - 2, y + oy, x + ox - 4, y + oy - 3);
      ctx.moveTo(x + ox, y + oy + 4);
      ctx.quadraticCurveTo(x + ox + 2, y + oy, x + ox + 4, y + oy - 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawExpandHint(corners) {
    const ctx = this.ctx;
    const cx = corners.reduce((s, c) => s + c.x, 0) / 6;
    const cy = corners.reduce((s, c) => s + c.y, 0) / 6;
    ctx.font = `${HEX_SIZE * 0.5}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⬡', cx, cy);
  }

  _drawBuilding(x, y, hex) {
    const b = BUILDINGS[hex.building];
    if (!b) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    this._drawCastShadow(ctx, b.height || .3);

    const painters = {
      food_bowl: () => this._drawFoodBowl(ctx),
      water_fountain: () => this._drawWaterFountain(ctx),
      bed: () => this._drawBed(ctx, false),
      double_bed: () => this._drawBed(ctx, true),
      scratcher: () => this._drawScratcher(ctx),
      toy_ball: () => this._drawToyBall(ctx),
      litter_box: () => this._drawLitterBox(ctx),
      lamp: () => this._drawLamp(ctx, hex.level || 1),
      catnip_plant: () => this._drawPlant(ctx, hex.level || 1),
      garden: () => this._drawGarden(ctx, hex.level || 1),
      shelter: () => this._drawShelter(ctx),
      tree: () => this._drawTree(ctx),
    };
    (painters[hex.building] || (() => this._drawCrate(ctx, b.color)))();

    if (hex.level > 1) {
      ctx.fillStyle = 'rgba(90, 70, 100, .15)';
      ctx.beginPath();
      ctx.arc(14, -24, 8, 0, Math.PI * 2);
      ctx.fill();
      const badge = ctx.createRadialGradient(11, -27, 1, 13, -25, 8);
      badge.addColorStop(0, '#fff8e0');
      badge.addColorStop(1, '#f0c878');
      ctx.fillStyle = badge;
      ctx.strokeStyle = '#e8b070';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(13, -25, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = `800 7px Nunito, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#8a6050';
      ctx.fillText(`${hex.level}★`, 13, -25);
    }

    ctx.restore();
  }

  _drawCastShadow(ctx, height) {
    const shadow = ctx.createRadialGradient(2, 10, 1, 2, 10, 20 + height * 4);
    shadow.addColorStop(0, 'rgba(90, 70, 100, .22)');
    shadow.addColorStop(.55, 'rgba(90, 70, 100, .1)');
    shadow.addColorStop(1, 'rgba(90, 70, 100, 0)');
    ctx.fillStyle = shadow;
    ctx.save();
    ctx.transform(1, .06, -.4, .42, 0, 0);
    ctx.beginPath();
    ctx.arc(6, 12, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawFoodBowl(ctx) {
    // Soft shadow layer already cast; pastel rounded bowl
    const base = ctx.createLinearGradient(0, -2, 0, 10);
    base.addColorStop(0, '#e8b898');
    base.addColorStop(1, '#c88868');
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.ellipse(0, 4, 14, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    const rim = ctx.createLinearGradient(0, -4, 0, 6);
    rim.addColorStop(0, '#ffe0c0');
    rim.addColorStop(1, '#e8a878');
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.ellipse(0, 1, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c88870';
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fillStyle = '#a87858';
    ctx.beginPath();
    ctx.ellipse(0, 1, 10.5, 3.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ['-6,-1', '-2,2', '3,-1', '7,1', '0,-2'].forEach((value) => {
      const [px, py] = value.split(',').map(Number);
      const crumb = ctx.createRadialGradient(px, py, .2, px, py, 1.8);
      crumb.addColorStop(0, '#f0c890');
      crumb.addColorStop(1, '#d09860');
      ctx.fillStyle = crumb;
      ctx.beginPath();
      ctx.arc(px, py, 1.7, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.strokeStyle = 'rgba(255,240,210,.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(-3, -1, 7, 2, 0, Math.PI, Math.PI * 1.8);
    ctx.stroke();
  }

  _drawWaterFountain(ctx) {
    ctx.fillStyle = '#567481';
    ctx.beginPath();
    ctx.ellipse(0, 5, 15, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8cb5bd';
    ctx.beginPath();
    ctx.ellipse(0, 2, 15, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#405d68';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    const water = ctx.createRadialGradient(-3, 0, 1, 0, 2, 11);
    water.addColorStop(0, '#d8f5ed');
    water.addColorStop(1, '#65b7cc');
    ctx.fillStyle = water;
    ctx.beginPath();
    ctx.ellipse(0, 1, 11, 3.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#527782';
    ctx.fillRect(-2.5, -13, 5, 14);
    ctx.beginPath();
    ctx.ellipse(0, -13, 7, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(218,250,245,.9)';
    ctx.lineWidth = 1.4;
    const stream = Math.sin(Date.now() / 220) * .5;
    ctx.beginPath();
    ctx.moveTo(-4, -12);
    ctx.quadraticCurveTo(-6 + stream, -5, -5, 0);
    ctx.moveTo(4, -12);
    ctx.quadraticCurveTo(6 - stream, -5, 5, 0);
    ctx.stroke();
  }

  _drawBed(ctx, double) {
    const width = double ? 29 : 22;
    ctx.fillStyle = '#b898c0';
    ctx.beginPath();
    ctx.roundRect(-width / 2, -2, width, 12, 6);
    ctx.fill();
    const cushion = ctx.createLinearGradient(0, -8, 0, 7);
    cushion.addColorStop(0, '#ffe0e8');
    cushion.addColorStop(1, '#e8b0c0');
    ctx.fillStyle = cushion;
    ctx.beginPath();
    ctx.ellipse(0, -1, width / 2 - 1, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c898b0';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.fillStyle = '#fff0f4';
    const pillows = double ? [-7, 7] : [0];
    pillows.forEach((px) => {
      ctx.beginPath();
      ctx.ellipse(px, -4, double ? 6 : 8, 3.6, -.08, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.strokeStyle = 'rgba(255,245,250,.65)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-width / 2 + 4, 3);
    ctx.quadraticCurveTo(0, 8, width / 2 - 4, 3);
    ctx.stroke();
  }

  _drawScratcher(ctx) {
    ctx.fillStyle = '#6c4e43';
    ctx.beginPath();
    ctx.ellipse(0, 7, 13, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9b7355';
    ctx.beginPath();
    ctx.ellipse(0, 5, 13, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#85613f';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.lineTo(0, -22);
    ctx.stroke();
    ctx.strokeStyle = '#c69a62';
    ctx.lineWidth = 1;
    for (let y = -19; y < 3; y += 3) {
      ctx.beginPath();
      ctx.moveTo(-3, y);
      ctx.lineTo(3, y + 1);
      ctx.stroke();
    }
    ctx.fillStyle = '#795765';
    ctx.beginPath();
    ctx.ellipse(0, -23, 10, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b9879d';
    ctx.beginPath();
    ctx.ellipse(0, -25, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#886675';
    ctx.stroke();
    ctx.strokeStyle = '#73533f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(6, -23);
    ctx.lineTo(8, -12);
    ctx.stroke();
    ctx.fillStyle = '#e2aa5d';
    ctx.beginPath();
    ctx.arc(8, -10, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawToyBall(ctx) {
    const ball = ctx.createRadialGradient(-4, -6, 1, 0, 0, 11);
    ball.addColorStop(0, '#ffd59b');
    ball.addColorStop(.35, '#ed826e');
    ball.addColorStop(1, '#9b4455');
    ctx.fillStyle = ball;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#75394b';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,170,.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 6, -.8, 1.7);
    ctx.stroke();
  }

  _drawLitterBox(ctx) {
    ctx.fillStyle = '#5e6b73';
    ctx.beginPath();
    ctx.moveTo(-15, -4);
    ctx.lineTo(15, -4);
    ctx.lineTo(12, 8);
    ctx.quadraticCurveTo(0, 12, -12, 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8b9ba0';
    ctx.beginPath();
    ctx.ellipse(0, -3, 15, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#49575f';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#d7c39c';
    ctx.beginPath();
    ctx.ellipse(0, -3, 11.5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b79e73';
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.arc(-8 + i * 2, -3 + (i % 2), .65, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawLamp(ctx, level) {
    const radius = 16 + level * 2;
    const glow = ctx.createRadialGradient(0, -19, 0, 0, -19, radius);
    glow.addColorStop(0, 'rgba(255,232,143,.55)');
    glow.addColorStop(1, 'rgba(255,211,111,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -19, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#574454';
    ctx.beginPath();
    ctx.ellipse(0, 7, 8, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-2, -18, 4, 25);
    const shade = ctx.createLinearGradient(-8, -28, 8, -12);
    shade.addColorStop(0, '#fff0ac');
    shade.addColorStop(1, '#d49a50');
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.moveTo(-5, -27);
    ctx.lineTo(5, -27);
    ctx.lineTo(10, -14);
    ctx.quadraticCurveTo(0, -10, -10, -14);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#8a6044';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#fff4bd';
    ctx.beginPath();
    ctx.ellipse(0, -14, 7, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawPlant(ctx, level) {
    ctx.fillStyle = '#744c45';
    ctx.beginPath();
    ctx.moveTo(-8, -2);
    ctx.lineTo(8, -2);
    ctx.lineTo(6, 9);
    ctx.quadraticCurveTo(0, 12, -6, 9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#b16e55';
    ctx.beginPath();
    ctx.ellipse(0, -2, 9, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#39734d';
    ctx.lineWidth = 1.5;
    const leaves = 6 + level * 2;
    for (let i = 0; i < leaves; i++) {
      const angle = (i / leaves) * Math.PI * 2;
      const length = 11 + (i % 3) * 3;
      const ex = Math.cos(angle) * length;
      const ey = -5 + Math.sin(angle) * length * .55;
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.quadraticCurveTo(ex * .45, ey - 4, ex, ey);
      ctx.stroke();
      ctx.fillStyle = i % 2 ? '#68a665' : '#8ac279';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 4.5, 2.3, angle, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawGarden(ctx, level) {
    ctx.strokeStyle = '#8a7058';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 4, 17, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#426f4d';
    ctx.beginPath();
    ctx.ellipse(0, 3, 15, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    const colors = ['#f2a3ac', '#f4ce75', '#bca1db', '#f1eee2'];
    const count = 5 + level * 2;
    for (let i = 0; i < count; i++) {
      const angle = i * 2.4;
      const radius = 3 + (i % 3) * 4;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius * .45;
      ctx.strokeStyle = '#4d8355';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py + 3);
      ctx.lineTo(px, py - 4);
      ctx.stroke();
      ctx.fillStyle = colors[i % colors.length];
      for (let petal = 0; petal < 4; petal++) {
        const a = petal * Math.PI / 2;
        ctx.beginPath();
        ctx.arc(px + Math.cos(a) * 2, py - 4 + Math.sin(a) * 2, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#f9dd79';
      ctx.beginPath();
      ctx.arc(px, py - 4, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawShelter(ctx) {
    ctx.fillStyle = '#7b4c3d';
    ctx.beginPath();
    ctx.moveTo(-15, -13);
    ctx.lineTo(15, -13);
    ctx.lineTo(15, 8);
    ctx.lineTo(-15, 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#a9684c';
    for (let x = -12; x < 14; x += 5) ctx.fillRect(x, -11, 2, 18);
    ctx.fillStyle = '#54384a';
    ctx.beginPath();
    ctx.arc(0, 2, 7, Math.PI, 0);
    ctx.lineTo(7, 8);
    ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    const roof = ctx.createLinearGradient(0, -28, 0, -10);
    roof.addColorStop(0, '#d68d66');
    roof.addColorStop(1, '#934f46');
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(-19, -12);
    ctx.lineTo(0, -29);
    ctx.lineTo(19, -12);
    ctx.lineTo(14, -8);
    ctx.lineTo(0, -22);
    ctx.lineTo(-14, -8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#6f4040';
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  _drawTree(ctx) {
    const trunk = ctx.createLinearGradient(-5, 0, 6, 0);
    trunk.addColorStop(0, '#5d3d35');
    trunk.addColorStop(.5, '#9b6a46');
    trunk.addColorStop(1, '#4c3532');
    ctx.fillStyle = trunk;
    ctx.beginPath();
    ctx.moveTo(-5, 7);
    ctx.lineTo(-3, -19);
    ctx.lineTo(5, -19);
    ctx.lineTo(7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#5b4034';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -10); ctx.lineTo(-10, -23);
    ctx.moveTo(2, -13); ctx.lineTo(12, -27);
    ctx.stroke();
    const clusters = [
      [-10, -25, 11, '#5c9462'], [8, -28, 13, '#4f8858'],
      [0, -37, 14, '#74a86b'], [16, -19, 9, '#659b62'], [-16, -15, 9, '#6ca168'],
    ];
    clusters.forEach(([px, py, size, color]) => {
      const leaf = ctx.createRadialGradient(px - 3, py - 4, 1, px, py, size);
      leaf.addColorStop(0, this._lighten(color, .14));
      leaf.addColorStop(1, color);
      ctx.fillStyle = leaf;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  _drawCrate(ctx, color = '#8d684c') {
    ctx.fillStyle = this._darken(color, .18);
    ctx.fillRect(-11, -11, 22, 19);
    ctx.fillStyle = color;
    ctx.fillRect(-10, -12, 20, 17);
    ctx.strokeStyle = this._darken(color, .32);
    ctx.lineWidth = 2;
    ctx.strokeRect(-10, -12, 20, 17);
    ctx.beginPath();
    ctx.moveTo(-9, -11); ctx.lineTo(9, 4);
    ctx.moveTo(9, -11); ctx.lineTo(-9, 4);
    ctx.stroke();
  }

  _drawBoundaryFences(hexes) {
    const edgeByDirection = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];
    const ctx = this.ctx;
    ctx.save();
    hexes.forEach((hex) => {
      const { x, y } = axialToPixel(hex.q, hex.r);
      const corners = getHexCorners(x, y, HEX_SIZE - 1);
      hexNeighbors(hex.q, hex.r).forEach((neighbor, direction) => {
        if (hexes.has(axialKey(neighbor.q, neighbor.r))) return;
        const [aIndex, bIndex] = edgeByDirection[direction];
        const a = corners[aIndex];
        const b = corners[bIndex];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        const nx = -dy / length;
        const ny = dx / length;

        ctx.strokeStyle = '#c89878';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.x + nx * 2, a.y + ny * 2 - 5);
        ctx.lineTo(b.x + nx * 2, b.y + ny * 2 - 5);
        ctx.stroke();
        ctx.strokeStyle = '#e8c8a8';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(a.x + nx * 2, a.y + ny * 2 - 6.5);
        ctx.lineTo(b.x + nx * 2, b.y + ny * 2 - 6.5);
        ctx.stroke();

        [a, b].forEach((point) => {
          const postGrad = ctx.createLinearGradient(point.x - 2, point.y - 9, point.x + 2, point.y + 2);
          postGrad.addColorStop(0, '#e0b890');
          postGrad.addColorStop(1, '#b88868');
          ctx.fillStyle = postGrad;
          ctx.beginPath();
          ctx.roundRect(point.x - 2.2, point.y - 9, 4.4, 11, 2);
          ctx.fill();
        });
      });
    });
    ctx.restore();
  }

  _getCatRenderState(cat, hex, delta) {
    const destination = axialToPixel(hex.q, hex.r);
    let state = this.catAnimations.get(cat.id);
    if (!state) {
      state = { x: destination.x, y: destination.y, facing: 1, moving: false, bob: 0 };
      this.catAnimations.set(cat.id, state);
    }

    const dx = destination.x - state.x;
    const dy = destination.y - state.y;
    const distance = Math.hypot(dx, dy);
    state.moving = distance > 1.2;
    if (state.moving) {
      const step = Math.min(distance, 78 * delta);
      state.x += (dx / distance) * step;
      state.y += (dy / distance) * step;
      if (Math.abs(dx) > .5) state.facing = dx < 0 ? -1 : 1;
    } else {
      state.x = destination.x;
      state.y = destination.y;
    }
    return state;
  }

  _drawCat(cat, hex, delta) {
    const render = this._getCatRenderState(cat, hex, delta);
    const { x, y, facing, moving } = render;
    const ctx = this.ctx;
    const t = Date.now() / 1000;
    const seed = [...cat.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const phase = t * (moving ? 9 : 2.2) + seed;
    const appearance = cat.appearance || {
      coat: '#f0c4a0', dark: '#d49a72', light: '#fff0dc', pattern: 'tabby',
      eyes: '#8ecf7a', blush: '#f5a8b0',
    };
    if (!appearance.blush) appearance.blush = '#f5a8b0';
    const activity = moving ? 'walk' : (cat.activity || 'explore');

    ctx.save();
    ctx.translate(x, y - 4);
    ctx.scale(facing, 1);

    // Soft flat shadow
    const shadow = ctx.createRadialGradient(0, 11, 1, 0, 11, 16);
    shadow.addColorStop(0, 'rgba(90, 70, 100, .2)');
    shadow.addColorStop(1, 'rgba(90, 70, 100, 0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(0, 11, 15, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();

    this._drawPixelCat(ctx, appearance, activity, phase, t, seed);
    ctx.restore();

    if (!moving) this._drawActivityBubble(ctx, cat, x, y, t, seed);
    this._drawCatName(ctx, cat, x, y);
  }

  _drawPixelCat(ctx, appearance, activity, phase, t, seed) {
    const lying = activity === 'sleep' || activity === 'loaf' || activity === 'roll';
    const sleeping = activity === 'sleep';
    const walking = activity === 'walk';
    const playing = activity === 'play' || activity === 'pounce';
    const eating = activity === 'eat' || activity === 'drink';
    const stretching = activity === 'stretch';
    const licking = activity === 'lick' || activity === 'groom';
    const yawning = activity === 'yawn';

    const bounce = walking
      ? Math.abs(Math.sin(phase)) * 1.8
      : playing ? Math.abs(Math.sin(phase * .9)) * 4.5 : 0;

    ctx.save();
    if (activity === 'roll') ctx.rotate(Math.sin(phase * 1.3) * .5);
    if (stretching) ctx.scale(1.14 + Math.sin(phase * .5) * .04, .9);
    if (sleeping) {
      const breathe = Math.sin(phase) * .025;
      ctx.scale(1 + breathe, 1 - breathe);
    }
    ctx.translate(0, -bounce + (eating ? 2 : 0));

    const rows = lying ? CAT_SPRITES.loaf : CAT_SPRITES.stand;
    const p = lying ? 2.2 : 2.3;
    const cols = rows[0].length;
    const ox = -cols * p / 2;
    const oy = -rows.length * p + 10;

    this._drawPixelTail(ctx, appearance, p, ox, oy, cols, lying, phase, activity === 'tail_flick');
    const info = this._paintCatSprite(ctx, rows, appearance, p, ox, oy);
    this._paintCatPattern(ctx, appearance, p, ox, oy, lying);

    // Orejas alerta: pixel extra que salta sobre una oreja
    if (activity === 'ear_twitch' && Math.sin(phase * 5) > 0) {
      ctx.fillStyle = appearance.coat;
      ctx.beginPath();
      ctx.roundRect(ox + (lying ? 4 : 2) * p, oy - p * .7, p * 1.3, p, p * .3);
      ctx.fill();
    }

    this._paintCatFace(ctx, appearance, info, p, {
      sleeping, eating, licking, yawning, phase, t, seed,
    });

    // Patita levantada al lamerse
    if (licking && !lying) {
      const lift = Math.abs(Math.sin(phase * 2.2)) * 2.6;
      ctx.fillStyle = appearance.light;
      ctx.strokeStyle = this._darken(appearance.dark, .1);
      ctx.lineWidth = .8;
      ctx.beginPath();
      ctx.roundRect(ox + 9.6 * p, oy + 7.3 * p - lift, p * 1.5, p * 2, p * .45);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  _paintCatSprite(ctx, rows, appearance, p, ox, oy) {
    const outline = this._darken(appearance.dark, .1);
    const highlight = this._lighten(appearance.coat, .18);
    const total = rows.length;
    const eyes = [];
    const noses = [];
    ctx.save();
    for (let r = 0; r < total; r++) {
      const line = rows[r];
      // Gradiente suave: filas superiores más claras
      const shaded = this._lighten(appearance.coat, .12 * (1 - r / total));
      for (let c = 0; c < line.length; c++) {
        const ch = line[c];
        if (ch === '.') continue;
        let fill = shaded;
        if (ch === 'o') fill = outline;
        else if (ch === 'h') fill = highlight;
        else if (ch === 'l') fill = appearance.light;
        else if (ch === 'e') eyes.push([c, r]);
        else if (ch === 'n') noses.push([c, r]);
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.roundRect(ox + c * p - .25, oy + r * p - .25, p + .5, p + .5, p * .32);
        ctx.fill();
        if (ch === 'b') {
          ctx.fillStyle = appearance.blush || '#f5a8b0';
          ctx.globalAlpha = .75;
          ctx.beginPath();
          ctx.roundRect(ox + c * p, oy + r * p + p * .12, p, p * .8, p * .3);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
    ctx.restore();
    return { eyes, noses, ox, oy };
  }

  _paintCatPattern(ctx, appearance, p, ox, oy, lying) {
    const bx = lying ? 1 : 0;
    ctx.save();
    ctx.fillStyle = appearance.dark;
    const cell = (c, r, w, h, alpha) => {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.roundRect(ox + (c + bx) * p, oy + r * p, w * p, h * p, p * .3);
      ctx.fill();
    };
    if (appearance.pattern === 'tabby') {
      cell(5, 3, 1, 2, .4);
      cell(7, 3, 1, 2, .4);
      cell(9, 3, 1, 2, .4);
    } else if (appearance.pattern === 'patches') {
      cell(8, 3, 3, 2, .35);
    } else if (appearance.pattern === 'tuxedo') {
      cell(1, 3, 12, 2, .3);
    } else if (appearance.pattern === 'points') {
      cell(1, 0, 3, 2.4, .5);
      cell(10, 0, 3, 2.4, .5);
    }
    ctx.restore();
  }

  _drawPixelTail(ctx, appearance, p, ox, oy, cols, lying, phase, flick) {
    const speed = flick ? 5 : 1.8;
    const up = Math.sin(phase * speed) > 0;
    const cells = lying
      ? (up
        ? [[cols - 2.4, 6.4], [cols - 1.6, 5.6], [cols - 1.2, 4.5]]
        : [[cols - 2.4, 6.8], [cols - 1.6, 6.2], [cols - 1.2, 5.3]])
      : (up
        ? [[cols - 1.8, 9.1], [cols - 1, 8.1], [cols - .5, 6.9]]
        : [[cols - 1.8, 9.8], [cols - 1, 9.1], [cols - .5, 8.2]]);
    const outline = this._darken(appearance.dark, .1);
    cells.forEach(([c, r], i) => {
      ctx.fillStyle = outline;
      ctx.beginPath();
      ctx.roundRect(ox + c * p - .6, oy + r * p - .6, p + 1.2, p + 1.2, p * .35);
      ctx.fill();
      ctx.fillStyle = i === cells.length - 1
        ? this._lighten(appearance.coat, .12)
        : appearance.coat;
      ctx.beginPath();
      ctx.roundRect(ox + c * p, oy + r * p, p, p, p * .3);
      ctx.fill();
    });
  }

  _paintCatFace(ctx, appearance, info, p, opts) {
    const { sleeping, eating, licking, yawning, phase, t, seed } = opts;
    const outline = this._darken(appearance.dark, .1);
    const blink = !sleeping && ((t * .9 + seed) % 4.2) < .14;
    const closed = sleeping || blink || yawning || (licking && Math.sin(phase) > 0);

    info.eyes.forEach(([c, r]) => {
      const ex = info.ox + c * p;
      const ey = info.oy + r * p;
      if (closed) {
        ctx.fillStyle = outline;
        ctx.beginPath();
        ctx.roundRect(ex - p * .1, ey + p * .4, p * 1.2, p * .34, p * .17);
        ctx.fill();
      } else {
        ctx.fillStyle = appearance.eyes;
        ctx.beginPath();
        ctx.roundRect(ex - p * .1, ey - p * .1, p * 1.2, p * 1.2, p * .35);
        ctx.fill();
        if (eating) {
          ctx.fillStyle = appearance.coat;
          ctx.beginPath();
          ctx.roundRect(ex - p * .1, ey - p * .1, p * 1.2, p * .55, p * .2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,.95)';
        ctx.beginPath();
        ctx.arc(ex + p * .28, ey + p * .24, p * .18, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    if (info.noses.length) {
      const [nc, nr] = info.noses[0];
      const nx = info.ox + nc * p;
      const ny = info.oy + nr * p;
      ctx.fillStyle = '#e89098';
      ctx.beginPath();
      ctx.roundRect(nx + p * .1, ny + p * .1, p * 1.8, p * .75, p * .3);
      ctx.fill();

      if (yawning) {
        const open = .9 + Math.abs(Math.sin(phase)) * 1.1;
        ctx.fillStyle = '#5a4050';
        ctx.beginPath();
        ctx.roundRect(nx + p * .35, ny + p, p * 1.3, p * open, p * .5);
        ctx.fill();
      } else {
        ctx.strokeStyle = outline;
        ctx.lineWidth = .7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(nx + p, ny + p * .95);
        ctx.lineTo(nx + p, ny + p * 1.3);
        ctx.stroke();
      }
    }
  }

  _drawActivityBubble(ctx, cat, x, y, t, seed) {
    const activityIcons = {
      eat: '🍽', drink: '💧', sleep: 'z', play: '✦', litter: '◌',
      warm: '☀', groom: '♥', watch: '…', explore: '',
      stretch: '∿', yawn: '◡', lick: '👅', loaf: '▮',
      ear_twitch: '♪', tail_flick: '~', pounce: '✧', roll: '↻',
    };
    const icon = activityIcons[cat.activity];
    if (!icon) return;
    const bubbleY = y - 36 + Math.sin(t * 2 + seed) * 1.2;
    ctx.save();
    // Soft layered bubble (flat depth)
    ctx.fillStyle = 'rgba(90, 70, 100, .12)';
    ctx.beginPath();
    ctx.arc(x + 14, bubbleY + 1.5, 8.5, 0, Math.PI * 2);
    ctx.fill();
    const bubbleGrad = ctx.createRadialGradient(x + 12, bubbleY - 2, 1, x + 13, bubbleY, 8);
    bubbleGrad.addColorStop(0, '#fffef8');
    bubbleGrad.addColorStop(1, '#ffe8f0');
    ctx.fillStyle = bubbleGrad;
    ctx.strokeStyle = 'rgba(200, 160, 180, .45)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x + 13, bubbleY, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#7a5a70';
    ctx.font = `800 ${icon === 'z' ? 9 : 8}px Nunito, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, x + 13, bubbleY);
    ctx.restore();
  }

  _drawCatName(ctx, cat, x, y) {
    ctx.save();
    ctx.font = `800 ${HEX_SIZE * 0.17}px Nunito, sans-serif`;
    const width = ctx.measureText(cat.name).width + 12;
    // Soft shadow layer
    ctx.fillStyle = 'rgba(90, 70, 100, .18)';
    ctx.beginPath();
    ctx.roundRect(x - width / 2 + 1, y + 13, width, 13, 8);
    ctx.fill();
    const tagGrad = ctx.createLinearGradient(0, y + 12, 0, y + 25);
    tagGrad.addColorStop(0, 'rgba(255, 248, 240, .92)');
    tagGrad.addColorStop(1, 'rgba(255, 230, 235, .9)');
    ctx.fillStyle = tagGrad;
    ctx.beginPath();
    ctx.roundRect(x - width / 2, y + 12, width, 13, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220, 180, 190, .5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#7a5a68';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cat.name, x, y + 18.5);
    ctx.restore();
  }

  _darken(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.max(0, (num >> 16) - Math.floor(255 * amount));
    const g = Math.max(0, ((num >> 8) & 0xff) - Math.floor(255 * amount));
    const b = Math.max(0, (num & 0xff) - Math.floor(255 * amount));
    return `rgb(${r},${g},${b})`;
  }

  _lighten(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.min(255, (num >> 16) + Math.floor(255 * amount));
    const g = Math.min(255, ((num >> 8) & 0xff) + Math.floor(255 * amount));
    const b = Math.min(255, (num & 0xff) + Math.floor(255 * amount));
    return `rgb(${r},${g},${b})`;
  }
}
