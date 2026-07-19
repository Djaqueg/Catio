import * as THREE from './vendor/three.module.min.js';
import { BUILDINGS } from './config.js';
import {
  axialToPixel, getHexCorners, HEX_SIZE, hexNeighbors, axialKey,
} from './hex.js';

// Escala: 1 unidad de mundo = HEX_SIZE px del grid axial.
const W = (px) => px / HEX_SIZE;

const PALETTE = {
  grass: [0x9fd48a, 0xa8db96, 0x94cc82],
  grassSide: 0x7ab684,
  ghost: 0xffd28c,
  fence: 0xc89878,
  fenceLight: 0xe0b890,
};

const ACTIVITY_ICONS = {
  eat: '🍽', drink: '💧', sleep: 'z', play: '✦', litter: '◌',
  warm: '☀', groom: '♥', watch: '…', explore: '',
  stretch: '∿', yawn: '◡', lick: '👅', loaf: '▮',
  ear_twitch: '♪', tail_flick: '~', pounce: '✧', roll: '↻',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.highlightKey = null;
    this.expandableKeys = new Set();
    this.selectedBuild = null;
    this.onHexClick = null;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xe8d4e4, 30, 70);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camTarget = new THREE.Vector3(0, 0, 0);
    this.camDist = 14;
    this.camDir = new THREE.Vector3(0, 1.5, 1.12).normalize();

    this._setupLights();
    this._setupSky();

    this.tilesGroup = new THREE.Group();
    this.ghostGroup = new THREE.Group();
    this.fenceGroup = new THREE.Group();
    this.catsGroup = new THREE.Group();
    this.scene.add(this.tilesGroup, this.ghostGroup, this.fenceGroup, this.catsGroup);

    this._highlightMesh = this._buildHighlightMesh();
    this.scene.add(this._highlightMesh);

    this._matCache = new Map();
    this._spriteTexCache = new Map();
    this._tileSignature = '';
    this._ghostSignature = '';
    this._catObjects = new Map();
    this._pickMeshes = [];
    this._raycaster = new THREE.Raycaster();
    this._lastDraw = 0;

    this.dragging = false;
    this.lastTouch = null;
    this._bindEvents();
  }

  /* ── Escena base ── */

  _setupLights() {
    const hemi = new THREE.HemisphereLight(0xfff4e2, 0xb8d8c0, 1.15);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2dc, 1.6);
    sun.position.set(9, 16, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    sun.shadow.camera.far = 50;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  _setupSky() {
    // Nubes low-poly que derivan lentamente
    this.clouds = new THREE.Group();
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xfffaf2, flatShading: true, roughness: 1,
      transparent: true, opacity: 0.85,
    });
    for (let i = 0; i < 6; i++) {
      const cloud = new THREE.Group();
      const blobs = 2 + (i % 3);
      for (let b = 0; b < blobs; b++) {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7 + (b % 2) * 0.4, 0), cloudMat);
        m.position.set(b * 0.9 - blobs * 0.4, (b % 2) * 0.2, (b % 2) * 0.3);
        m.scale.y = 0.45;
        cloud.add(m);
      }
      cloud.position.set((i - 3) * 6 + (i % 2) * 3, 7 + (i % 3), -6 - (i % 4) * 3);
      cloud.userData.speed = 0.12 + (i % 3) * 0.05;
      this.clouds.add(cloud);
    }
    this.scene.add(this.clouds);
  }

  _buildHighlightMesh() {
    const geo = new THREE.CylinderGeometry(0.99, 0.99, 0.05, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd28c, transparent: true, opacity: 0.5,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    return mesh;
  }

  _mat(color, opts = {}) {
    const key = `${color}|${opts.roughness ?? 0.85}|${opts.emissive ?? 0}`;
    if (!this._matCache.has(key)) {
      this._matCache.set(key, new THREE.MeshStandardMaterial({
        color, flatShading: true, roughness: opts.roughness ?? 0.85,
        emissive: opts.emissive ?? 0x000000,
        emissiveIntensity: opts.emissiveIntensity ?? 0.35,
      }));
    }
    return this._matCache.get(key);
  }

  /* ── Cámara y controles ── */

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.viewW = rect.width;
    this.viewH = rect.height;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / Math.max(1, rect.height);
    this.camera.updateProjectionMatrix();
  }

  centerOnHexes(hexes) {
    if (!hexes.size) return;
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    hexes.forEach((hex) => {
      const p = axialToPixel(hex.q, hex.r);
      minX = Math.min(minX, W(p.x));
      maxX = Math.max(maxX, W(p.x));
      minZ = Math.min(minZ, W(p.y));
      maxZ = Math.max(maxZ, W(p.y));
    });
    this.camTarget.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2 + 0.5);
    const radius = Math.max(3, Math.hypot(maxX - minX, maxZ - minZ) / 2);
    this.camDist = Math.min(26, Math.max(9, radius * 3.1));
  }

  _updateCamera() {
    const pos = this.camDir.clone().multiplyScalar(this.camDist).add(this.camTarget);
    this.camera.position.copy(pos);
    this.camera.lookAt(this.camTarget);
  }

  _bindEvents() {
    const c = this.canvas;

    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastTouch = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
      c.setPointerCapture(e.pointerId);
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.dragging || !this.lastTouch) return;
      const dx = e.clientX - this.lastTouch.x;
      const dy = e.clientY - this.lastTouch.y;
      const wpp = (2 * this.camDist * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, this.viewH);
      this.camTarget.x -= dx * wpp;
      this.camTarget.z -= dy * wpp * 1.25;
      this.lastTouch.x = e.clientX;
      this.lastTouch.y = e.clientY;
    });

    c.addEventListener('pointerup', (e) => {
      if (this.lastTouch) {
        const dx = e.clientX - this.lastTouch.sx;
        const dy = e.clientY - this.lastTouch.sy;
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
          this._onTap(e.clientX, e.clientY);
        }
      }
      this.dragging = false;
      this.lastTouch = null;
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist = Math.max(6, Math.min(30, this.camDist * (e.deltaY > 0 ? 1.08 : 0.92)));
    }, { passive: false });

    c.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        this._pinchStart = this._pinchDistance(e.touches);
        this._distStart = this.camDist;
      }
    }, { passive: true });

    c.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && this._pinchStart) {
        e.preventDefault();
        const dist = this._pinchDistance(e.touches);
        this.camDist = Math.max(6, Math.min(30, this._distStart * (this._pinchStart / dist)));
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

  _onTap(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObjects(this._pickMeshes, false);
    if (hits.length && this.onHexClick) {
      this.onHexClick(hits[0].object.userData.hexKey);
    }
  }

  /* ── Casillas ── */

  _syncTiles(hexes) {
    const sig = [...hexes.entries()]
      .map(([key, hex]) => `${key}:${hex.building || ''}:${hex.level || 1}`)
      .sort()
      .join('|');
    if (sig === this._tileSignature) return;
    this._tileSignature = sig;

    this._disposeGroup(this.tilesGroup);
    this._disposeGroup(this.fenceGroup);
    this._pickMeshes = this._pickMeshes.filter((m) => m.userData.ghost);

    hexes.forEach((hex, key) => {
      const { x, y } = axialToPixel(hex.q, hex.r);
      const tile = this._buildTile(hex, key);
      tile.position.set(W(x), 0, W(y));
      this.tilesGroup.add(tile);
    });

    this._buildFences(hexes);
  }

  _buildTile(hex, key) {
    const group = new THREE.Group();
    const hash = Math.abs(hex.q * 7 + hex.r * 13) % 3;

    const top = this._mat(PALETTE.grass[hash]);
    const side = this._mat(PALETTE.grassSide);
    const geo = new THREE.CylinderGeometry(0.995, 1.0, 0.4, 6);
    const prism = new THREE.Mesh(geo, [side, top, side]);
    prism.position.y = -0.2;
    prism.receiveShadow = true;
    prism.userData.hexKey = key;
    group.add(prism);
    this._pickMeshes.push(prism);

    if (hex.building && BUILDINGS[hex.building]) {
      const building = this._buildBuilding(hex);
      group.add(building);
      if ((hex.level || 1) > 1) {
        const badge = this._makeTextSprite(`★${hex.level}`, {
          bg: 'rgba(255,244,214,.95)', fg: '#8a6050', size: 42,
        });
        badge.position.set(0.45, 1.35, 0);
        group.add(badge);
      }
    } else {
      this._addGroundDetails(group, hex);
    }
    return group;
  }

  _addGroundDetails(group, hex) {
    const hash = Math.abs(hex.q * 31 + hex.r * 17);
    if (hash % 3 !== 0) return;
    const ox = ((hash % 19) - 9) * 0.045;
    const oz = (((hash * 7) % 15) - 7) * 0.045;
    if (hash % 2 === 0) {
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.018, 0.16, 5),
        this._mat(0x78b888),
      );
      stem.position.set(ox, 0.08, oz);
      group.add(stem);
      const bloom = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.07, 0),
        this._mat(hash % 4 === 0 ? 0xf8d890 : 0xf8b0b8),
      );
      bloom.position.set(ox, 0.19, oz);
      bloom.castShadow = true;
      group.add(bloom);
    } else {
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(
          new THREE.ConeGeometry(0.03, 0.16, 4),
          this._mat(0x84c08c),
        );
        blade.position.set(ox + (i - 1) * 0.08, 0.08, oz + (i % 2) * 0.05);
        blade.rotation.z = (i - 1) * 0.2;
        group.add(blade);
      }
    }
  }

  _syncGhosts(hexes) {
    const active = this.selectedBuild === 'hex_tile';
    const sig = active ? [...this.expandableKeys].sort().join('|') : '';
    if (sig === this._ghostSignature) return;
    this._ghostSignature = sig;

    this._disposeGroup(this.ghostGroup);
    this._pickMeshes = this._pickMeshes.filter((m) => !m.userData.ghost);

    if (!active) return;
    if (!this._ghostMat) {
      this._ghostMat = new THREE.MeshBasicMaterial({
        color: PALETTE.ghost, transparent: true, opacity: 0.35,
      });
    }
    this.expandableKeys.forEach((key) => {
      if (hexes.has(key)) return;
      const [q, r] = key.split(',').map(Number);
      const { x, y } = axialToPixel(q, r);
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.92, 0.92, 0.06, 6),
        this._ghostMat,
      );
      mesh.position.set(W(x), 0.03, W(y));
      mesh.userData.hexKey = key;
      mesh.userData.ghost = true;
      this.ghostGroup.add(mesh);
      this._pickMeshes.push(mesh);
    });
  }

  _buildFences(hexes) {
    const edgeByDirection = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];
    const postMat = this._mat(PALETTE.fence);
    const railMat = this._mat(PALETTE.fenceLight);
    const postGeo = new THREE.BoxGeometry(0.09, 0.34, 0.09);
    const posts = new Set();

    hexes.forEach((hex) => {
      const { x, y } = axialToPixel(hex.q, hex.r);
      const corners = getHexCorners(W(x) * HEX_SIZE, W(y) * HEX_SIZE, HEX_SIZE - 2);
      hexNeighbors(hex.q, hex.r).forEach((neighbor, direction) => {
        if (hexes.has(axialKey(neighbor.q, neighbor.r))) return;
        const [aIdx, bIdx] = edgeByDirection[direction];
        const a = { x: W(corners[aIdx].x), z: W(corners[aIdx].y) };
        const b = { x: W(corners[bIdx].x), z: W(corners[bIdx].y) };

        [a, b].forEach((pt) => {
          const pk = `${pt.x.toFixed(2)},${pt.z.toFixed(2)}`;
          if (posts.has(pk)) return;
          posts.add(pk);
          const post = new THREE.Mesh(postGeo, postMat);
          post.position.set(pt.x, 0.17, pt.z);
          post.castShadow = true;
          this.fenceGroup.add(post);
        });

        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.05), railMat);
        rail.position.set((a.x + b.x) / 2, 0.24, (a.z + b.z) / 2);
        rail.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
        rail.castShadow = true;
        this.fenceGroup.add(rail);
      });
    });
  }

  /* ── Edificios low-poly ── */

  _buildBuilding(hex) {
    const g = new THREE.Group();
    const level = hex.level || 1;
    const add = (mesh, x, y, z) => {
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    const M = (geo, color) => new THREE.Mesh(geo, this._mat(color));

    switch (hex.building) {
      case 'food_bowl': {
        add(M(new THREE.CylinderGeometry(0.34, 0.26, 0.14, 8), 0xe8a878), 0, 0.07, 0);
        add(M(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 8), 0xa87858), 0, 0.15, 0);
        for (let i = 0; i < 5; i++) {
          add(M(new THREE.IcosahedronGeometry(0.045, 0), 0xd09860),
            Math.cos(i * 2.4) * 0.13, 0.19, Math.sin(i * 2.4) * 0.13);
        }
        break;
      }
      case 'water_fountain': {
        add(M(new THREE.CylinderGeometry(0.38, 0.32, 0.16, 8), 0x8cb5bd), 0, 0.08, 0);
        add(M(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 8), 0x9adcf0), 0, 0.17, 0);
        add(M(new THREE.CylinderGeometry(0.06, 0.08, 0.42, 6), 0x7898a8), 0, 0.35, 0);
        add(M(new THREE.CylinderGeometry(0.14, 0.1, 0.08, 6), 0x8cb5bd), 0, 0.58, 0);
        break;
      }
      case 'bed':
      case 'double_bed': {
        const wide = hex.building === 'double_bed' ? 0.85 : 0.6;
        add(M(new THREE.BoxGeometry(wide, 0.12, 0.5), 0xb898c0), 0, 0.06, 0);
        const cushion = add(M(new THREE.CylinderGeometry(0.26, 0.28, 0.12, 8), 0xf0c8d4), 0, 0.15, 0);
        cushion.scale.x = wide / 0.56;
        break;
      }
      case 'scratcher': {
        add(M(new THREE.CylinderGeometry(0.3, 0.34, 0.1, 8), 0xc9a06a), 0, 0.05, 0);
        add(M(new THREE.CylinderGeometry(0.08, 0.08, 0.75, 6), 0xd0a878), 0, 0.47, 0);
        add(M(new THREE.CylinderGeometry(0.24, 0.24, 0.08, 8), 0xe0b8c8), 0, 0.88, 0);
        break;
      }
      case 'toy_ball': {
        add(M(new THREE.IcosahedronGeometry(0.2, 0), 0xf08080), 0, 0.2, 0);
        break;
      }
      case 'litter_box': {
        add(M(new THREE.BoxGeometry(0.62, 0.2, 0.5), 0xb0b8c0), 0, 0.1, 0);
        add(M(new THREE.BoxGeometry(0.5, 0.06, 0.38), 0xe0d0a8), 0, 0.2, 0);
        break;
      }
      case 'lamp': {
        add(M(new THREE.CylinderGeometry(0.16, 0.2, 0.08, 6), 0x8a7890), 0, 0.04, 0);
        add(M(new THREE.CylinderGeometry(0.04, 0.05, 0.7, 6), 0x8a7890), 0, 0.43, 0);
        const shade = new THREE.Mesh(
          new THREE.ConeGeometry(0.26, 0.3, 6),
          this._mat(0xf8dc90, { emissive: 0xf8d070, emissiveIntensity: 0.5 + level * 0.15 }),
        );
        add(shade, 0, 0.88, 0);
        break;
      }
      case 'catnip_plant': {
        add(M(new THREE.CylinderGeometry(0.18, 0.13, 0.22, 6), 0xc08868), 0, 0.11, 0);
        const leaves = 3 + level;
        for (let i = 0; i < leaves; i++) {
          const a = (i / leaves) * Math.PI * 2;
          const leaf = add(M(new THREE.ConeGeometry(0.09, 0.3, 4), i % 2 ? 0x78c078 : 0x9ad088),
            Math.cos(a) * 0.12, 0.36, Math.sin(a) * 0.12);
          leaf.rotation.z = Math.cos(a) * 0.5;
          leaf.rotation.x = -Math.sin(a) * 0.5;
        }
        break;
      }
      case 'garden': {
        add(M(new THREE.CylinderGeometry(0.44, 0.48, 0.1, 8), 0x88c878), 0, 0.05, 0);
        const colors = [0xf2a3ac, 0xf4ce75, 0xbca1db, 0xf8f0e0];
        const count = 4 + level * 2;
        for (let i = 0; i < count; i++) {
          const a = i * 2.4;
          const radius = 0.1 + (i % 3) * 0.12;
          add(M(new THREE.IcosahedronGeometry(0.06, 0), colors[i % colors.length]),
            Math.cos(a) * radius, 0.16, Math.sin(a) * radius);
        }
        break;
      }
      case 'shelter': {
        add(M(new THREE.BoxGeometry(0.72, 0.5, 0.62), 0xc98868), 0, 0.25, 0);
        const roof = add(M(new THREE.ConeGeometry(0.62, 0.4, 4), 0xd89078), 0, 0.68, 0);
        roof.rotation.y = Math.PI / 4;
        add(M(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 8), 0x6a4a48), 0, 0.26, 0.32);
        break;
      }
      case 'tree': {
        add(M(new THREE.CylinderGeometry(0.09, 0.13, 0.6, 6), 0xa87858), 0, 0.3, 0);
        add(M(new THREE.IcosahedronGeometry(0.42, 0), 0x78b478), 0, 0.85, 0);
        add(M(new THREE.IcosahedronGeometry(0.3, 0), 0x8cc484), 0.25, 0.62, 0.12);
        add(M(new THREE.IcosahedronGeometry(0.26, 0), 0x6aa870), -0.24, 0.68, -0.1);
        break;
      }
      default: {
        add(M(new THREE.BoxGeometry(0.5, 0.4, 0.5), 0xb09878), 0, 0.2, 0);
      }
    }
    return g;
  }

  /* ── Gato low-poly ── */

  _catMaterials(appearance) {
    return {
      coat: this._mat(new THREE.Color(appearance.coat).getHex()),
      light: this._mat(new THREE.Color(appearance.light).getHex()),
      dark: this._mat(new THREE.Color(appearance.dark).getHex()),
      pink: this._mat(0xe89098),
      eye: this._mat(0x3a3040, { roughness: 0.4 }),
    };
  }

  _buildCat(cat) {
    const appearance = cat.appearance || {
      coat: '#f0c4a0', dark: '#d49a72', light: '#fff0dc', eyes: '#8ecf7a',
    };
    const mats = this._catMaterials(appearance);
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    const torso = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), mats.coat);
    torso.scale.set(1.5, 0.95, 1.0);
    torso.position.y = 0.46;
    torso.castShadow = true;
    body.add(torso);

    const rump = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), mats.coat);
    rump.position.set(-0.32, 0.48, 0);
    rump.castShadow = true;
    body.add(rump);

    // Cabeza
    const headG = new THREE.Group();
    headG.position.set(0.46, 0.74, 0);
    body.add(headG);

    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), mats.coat);
    head.scale.set(1.0, 0.95, 0.92);
    head.castShadow = true;
    headG.add(head);

    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.16), mats.light);
    muzzle.position.set(0.17, -0.06, 0);
    headG.add(muzzle);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.04, 0.05), mats.pink);
    nose.position.set(0.245, -0.03, 0);
    headG.add(nose);

    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.08), mats.eye);
    mouth.position.set(0.19, -0.15, 0);
    mouth.visible = false;
    headG.add(mouth);

    const earGeo = new THREE.ConeGeometry(0.095, 0.22, 4);
    const ears = [0.12, -0.12].map((z) => {
      const ear = new THREE.Mesh(earGeo, mats.coat);
      ear.position.set(-0.02, 0.22, z);
      ear.rotation.x = z > 0 ? 0.18 : -0.18;
      ear.castShadow = true;
      headG.add(ear);
      return ear;
    });

    const eyeGeo = new THREE.IcosahedronGeometry(0.035, 0);
    const eyeMat = this._mat(new THREE.Color(appearance.eyes || '#8ecf7a').getHex(), { roughness: 0.35 });
    const eyes = [0.1, -0.1].map((z) => {
      const eyeG = new THREE.Group();
      eyeG.position.set(0.17, 0.05, z);
      const ball = new THREE.Mesh(eyeGeo, eyeMat);
      const pupil = new THREE.Mesh(new THREE.IcosahedronGeometry(0.018, 0), mats.eye);
      pupil.position.x = 0.024;
      eyeG.add(ball, pupil);
      headG.add(eyeG);
      return eyeG;
    });

    // Patas: pivote en la cadera, punta blanca como la referencia
    const legGeo = new THREE.BoxGeometry(0.1, 0.3, 0.1);
    const pawGeo = new THREE.BoxGeometry(0.12, 0.1, 0.11);
    const legs = [
      [0.32, 0.16], [0.32, -0.16], [-0.34, 0.16], [-0.34, -0.16],
    ].map(([x, z]) => {
      const legG = new THREE.Group();
      legG.position.set(x, 0.4, z);
      const leg = new THREE.Mesh(legGeo, mats.coat);
      leg.position.y = -0.16;
      leg.castShadow = true;
      const paw = new THREE.Mesh(pawGeo, mats.light);
      paw.position.set(0.015, -0.33, 0);
      legG.add(leg, paw);
      body.add(legG);
      return legG;
    });

    // Cola: cadena articulada con punta blanca
    const tail1 = new THREE.Group();
    tail1.position.set(-0.55, 0.6, 0);
    body.add(tail1);
    const t1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.34, 5), mats.coat);
    t1.position.y = 0.16;
    t1.castShadow = true;
    tail1.add(t1);
    const tail2 = new THREE.Group();
    tail2.position.y = 0.33;
    tail1.add(tail2);
    const t2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.3, 5), mats.coat);
    t2.position.y = 0.14;
    t2.castShadow = true;
    tail2.add(t2);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.04, 0.16, 5), mats.light);
    tip.position.y = 0.36;
    tail2.add(tip);

    // Etiqueta con nombre y burbuja de actividad
    const nameSprite = this._makeTextSprite(cat.name, {
      bg: 'rgba(255,248,240,.94)', fg: '#7a5a68', size: 44,
    });
    nameSprite.position.set(0, 1.45, 0);
    root.add(nameSprite);

    const bubble = new THREE.Group();
    bubble.position.set(0.35, 1.85, 0);
    root.add(bubble);

    root.scale.setScalar(0.82);
    root.userData = {
      body, headG, ears, eyes, mouth, legs, tail1, tail2,
      nameSprite, bubble, bubbleIcon: null, name: cat.name,
      anim: { x: 0, z: 0, angle: 0, moving: false, init: false },
    };
    return root;
  }

  _syncCats(cats, hexes) {
    const alive = new Set();
    cats.forEach((cat) => {
      alive.add(cat.id);
      if (!this._catObjects.has(cat.id)) {
        const obj = this._buildCat(cat);
        this._catObjects.set(cat.id, obj);
        this.catsGroup.add(obj);
      }
    });
    this._catObjects.forEach((obj, id) => {
      if (!alive.has(id)) {
        this.catsGroup.remove(obj);
        this._disposeObject(obj);
        this._catObjects.delete(id);
      }
    });
  }

  _updateCat(cat, hexes, delta, t) {
    const obj = this._catObjects.get(cat.id);
    if (!obj || !hexes.has(cat.hexKey)) {
      if (obj) obj.visible = false;
      return;
    }
    obj.visible = true;
    const ud = obj.userData;
    const hex = hexes.get(cat.hexKey);
    const dest = axialToPixel(hex.q, hex.r);
    const dx3 = W(dest.x);
    const dz3 = W(dest.y);

    const anim = ud.anim;
    if (!anim.init) {
      anim.x = dx3;
      anim.z = dz3;
      anim.init = true;
    }
    const ddx = dx3 - anim.x;
    const ddz = dz3 - anim.z;
    const distance = Math.hypot(ddx, ddz);
    anim.moving = distance > 0.04;
    if (anim.moving) {
      const step = Math.min(distance, 1.9 * delta);
      anim.x += (ddx / distance) * step;
      anim.z += (ddz / distance) * step;
      const targetAngle = Math.atan2(-ddz, ddx);
      let diff = targetAngle - anim.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      anim.angle += diff * Math.min(1, delta * 8);
    } else {
      anim.x = dx3;
      anim.z = dz3;
    }
    obj.position.set(anim.x, 0, anim.z);
    obj.rotation.y = anim.angle;

    const seed = cat.id.charCodeAt(cat.id.length - 1);
    const activity = anim.moving ? 'walk' : (cat.activity || 'explore');
    const phase = t * (anim.moving ? 8 : 2.2) + seed;
    this._poseCat(ud, activity, phase, t, seed);

    // Nombre actualizado (renombres) y burbuja de actividad
    if (ud.name !== cat.name) {
      ud.name = cat.name;
      obj.remove(ud.nameSprite);
      ud.nameSprite = this._makeTextSprite(cat.name, {
        bg: 'rgba(255,248,240,.94)', fg: '#7a5a68', size: 44,
      });
      ud.nameSprite.position.set(0, 1.45, 0);
      obj.add(ud.nameSprite);
    }
    const icon = anim.moving ? '' : (ACTIVITY_ICONS[cat.activity] || '');
    if (icon !== ud.bubbleIcon) {
      ud.bubbleIcon = icon;
      ud.bubble.clear();
      if (icon) {
        const sprite = this._makeTextSprite(icon, {
          bg: 'rgba(255,252,246,.95)', fg: '#7a5a70', size: 52, round: true,
        });
        ud.bubble.add(sprite);
      }
    }
    ud.bubble.position.y = 1.85 + Math.sin(t * 2 + seed) * 0.04;
    // Las etiquetas no giran con el gato
    ud.nameSprite.rotation.y = -obj.rotation.y;
  }

  _poseCat(ud, activity, phase, t, seed) {
    const { body, headG, ears, eyes, mouth, legs, tail1, tail2 } = ud;

    // Base
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
    body.scale.set(1, 1, 1);
    headG.position.set(0.46, 0.74, 0);
    headG.rotation.set(0, 0, 0);
    legs.forEach((leg) => {
      leg.rotation.set(0, 0, 0);
      leg.scale.set(1, 1, 1);
    });
    tail1.rotation.set(0, 0, 0.55);
    tail2.rotation.set(0, 0, -0.5);
    eyes.forEach((eye) => eye.scale.set(1, 1, 1));
    ears.forEach((ear, i) => { ear.rotation.z = 0; ear.rotation.x = i === 0 ? 0.18 : -0.18; });
    mouth.visible = false;

    const swing = Math.sin(phase);
    switch (activity) {
      case 'walk': {
        body.position.y = Math.abs(swing) * 0.05;
        legs[0].rotation.z = swing * 0.55;
        legs[3].rotation.z = swing * 0.55;
        legs[1].rotation.z = -swing * 0.55;
        legs[2].rotation.z = -swing * 0.55;
        tail1.rotation.z = 0.75;
        tail1.rotation.x = Math.sin(phase * 0.7) * 0.25;
        headG.rotation.z = Math.abs(swing) * 0.04;
        break;
      }
      case 'sleep': {
        const breathe = Math.sin(phase) * 0.02;
        body.position.y = -0.26;
        body.scale.set(1.05 + breathe, 0.72 - breathe, 1.12);
        legs.forEach((leg) => { leg.scale.y = 0.25; });
        headG.position.set(0.4, 0.5, 0.05);
        headG.rotation.z = -0.35;
        eyes.forEach((eye) => eye.scale.set(1, 0.12, 1));
        tail1.rotation.set(0.9, 0, 1.4);
        tail2.rotation.set(0.7, 0, -0.4);
        break;
      }
      case 'loaf': {
        body.position.y = -0.24;
        body.scale.set(1.02, 0.78, 1.1);
        legs.forEach((leg) => { leg.scale.y = 0.22; });
        headG.position.set(0.44, 0.66, 0);
        tail1.rotation.set(1.1, 0, 1.3);
        tail2.rotation.set(0.6, 0, -0.3);
        break;
      }
      case 'roll': {
        body.rotation.x = Math.sin(phase * 1.2) * 1.1;
        body.position.y = 0.08;
        legs.forEach((leg, i) => { leg.rotation.z = Math.sin(phase * 2 + i) * 0.4; });
        tail1.rotation.z = 0.9;
        break;
      }
      case 'stretch': {
        body.scale.x = 1.14 + Math.sin(phase * 0.5) * 0.03;
        body.rotation.z = -0.16;
        body.position.y = 0.05;
        legs[0].rotation.z = 0.8;
        legs[1].rotation.z = 0.8;
        headG.rotation.z = 0.3;
        tail1.rotation.z = 1.0;
        break;
      }
      case 'yawn': {
        headG.rotation.z = 0.32;
        mouth.visible = true;
        mouth.scale.y = 0.6 + Math.abs(Math.sin(phase)) * 0.8;
        eyes.forEach((eye) => eye.scale.set(1, 0.15, 1));
        tail1.rotation.z = 0.62;
        break;
      }
      case 'lick':
      case 'groom': {
        headG.rotation.y = 0.55;
        headG.rotation.z = -0.18;
        legs[0].rotation.z = 1.15 + Math.sin(phase * 2.4) * 0.18;
        if (Math.sin(phase) > 0) eyes.forEach((eye) => eye.scale.set(1, 0.15, 1));
        break;
      }
      case 'play':
      case 'pounce': {
        const hop = Math.abs(Math.sin(phase * 0.9));
        body.position.y = hop * 0.22;
        body.rotation.z = -hop * 0.12;
        legs[0].rotation.z = hop * 0.9;
        legs[1].rotation.z = hop * 0.9;
        tail1.rotation.z = 0.9;
        tail1.rotation.x = Math.sin(phase * 2) * 0.35;
        break;
      }
      case 'eat':
      case 'drink': {
        headG.rotation.z = -0.55 + Math.sin(phase * 0.45) * 0.06;
        headG.position.y = 0.6;
        eyes.forEach((eye) => eye.scale.set(1, 0.4, 1));
        break;
      }
      case 'litter': {
        body.position.y = -0.06;
        legs[2].rotation.z = Math.sin(phase * 1.7) * 0.3;
        legs[3].rotation.z = -Math.sin(phase * 1.7) * 0.3;
        break;
      }
      case 'warm':
      case 'watch': {
        // Sentado: pecho arriba, patas traseras plegadas
        body.rotation.z = 0.35;
        body.position.y = -0.08;
        legs[0].rotation.z = -0.35;
        legs[1].rotation.z = -0.35;
        legs[2].scale.y = 0.4;
        legs[3].scale.y = 0.4;
        headG.rotation.z = -0.3;
        headG.rotation.y = Math.sin(t * 0.6 + seed) * 0.3;
        tail1.rotation.set(0.8, 0, 1.2);
        break;
      }
      case 'ear_twitch': {
        ears[0].rotation.z = Math.sin(phase * 5) > 0 ? 0.35 : 0;
        ears[1].rotation.z = Math.sin(phase * 5 + 1) > 0 ? -0.3 : 0;
        headG.rotation.y = Math.sin(phase * 0.8) * 0.2;
        break;
      }
      case 'tail_flick': {
        tail1.rotation.x = Math.sin(phase * 4) * 0.5;
        tail2.rotation.x = Math.sin(phase * 4 + 0.6) * 0.45;
        break;
      }
      default: {
        // explore de pie: cola y cabeza con vida
        headG.rotation.y = Math.sin(t * 0.7 + seed) * 0.35;
        tail1.rotation.x = Math.sin(phase * 0.6) * 0.18;
        tail2.rotation.x = Math.sin(phase * 0.6 + 0.5) * 0.15;
      }
    }

    // Parpadeo
    if (activity !== 'sleep' && activity !== 'yawn' && ((t * 0.9 + seed) % 4.2) < 0.12) {
      eyes.forEach((eye) => eye.scale.set(1, 0.1, 1));
    }
  }

  /* ── Sprites de texto (nombres, burbujas, insignias) ── */

  _makeTextSprite(text, { bg, fg, size = 44, round = false }) {
    const key = `${text}|${bg}|${fg}|${size}|${round}`;
    let tex = this._spriteTexCache.get(key);
    if (!tex) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.font = `800 ${size}px Nunito, sans-serif`;
      const w = round ? size * 1.9 : Math.ceil(ctx.measureText(text).width) + size * 1.1;
      const h = size * 1.9;
      canvas.width = w;
      canvas.height = h;
      ctx.font = `800 ${size}px Nunito, sans-serif`;
      ctx.fillStyle = bg;
      ctx.beginPath();
      if (round) {
        ctx.arc(w / 2, h / 2, h / 2 - 4, 0, Math.PI * 2);
      } else {
        ctx.roundRect(2, h * 0.14, w - 4, h * 0.72, h * 0.36);
      }
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,160,180,.5)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2 + 2);
      tex = new THREE.CanvasTexture(canvas);
      tex.userData = { aspect: w / h };
      this._spriteTexCache.set(key, tex);
    }
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    const height = round ? 0.34 : 0.3;
    sprite.scale.set(height * tex.userData.aspect, height, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  /* ── Limpieza ── */

  _disposeGroup(group) {
    [...group.children].forEach((child) => {
      group.remove(child);
      this._disposeObject(child);
    });
  }

  _disposeObject(obj) {
    obj.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material?.map && node.isSprite) node.material.dispose();
    });
  }

  /* ── Bucle principal ── */

  draw(state, hexes, cats) {
    const now = performance.now();
    const delta = Math.min(0.05, (now - (this._lastDraw || now)) / 1000);
    this._lastDraw = now;
    const t = now / 1000;

    this._syncTiles(hexes);
    this._syncGhosts(hexes);
    this._syncCats(cats, hexes);

    cats.forEach((cat) => this._updateCat(cat, hexes, delta, t));

    // Resaltado de casilla
    if (this.highlightKey && hexes.has(this.highlightKey)) {
      const hex = hexes.get(this.highlightKey);
      const p = axialToPixel(hex.q, hex.r);
      this._highlightMesh.position.set(W(p.x), 0.03, W(p.y));
      this._highlightMesh.visible = true;
    } else {
      this._highlightMesh.visible = false;
    }

    // Pulso de casillas fantasma
    if (this._ghostMat) {
      this._ghostMat.opacity = 0.28 + Math.sin(t * 3.2) * 0.1;
    }

    // Nubes a la deriva
    this.clouds.children.forEach((cloud) => {
      cloud.position.x += cloud.userData.speed * delta;
      if (cloud.position.x > 22) cloud.position.x = -22;
    });

    this._updateCamera();
    this.renderer.render(this.scene, this.camera);
  }
}
