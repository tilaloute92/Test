import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clusterSegments, minAreaRect, pairWalls } from './geometry';
import { roleOf } from './drawing';
import type { Equipment, EquipmentKind, Fill, Group, PlanSettings } from './types';

export interface SceneInput {
  groups: Group[];
  settings: PlanSettings;
  factor: number;
  center: [number, number];
  showPlan: boolean;
}

export interface BuildStats { walls: number; windows: number; width: number; depth: number }

const KIND_COLORS: Record<EquipmentKind, number> = { bloc: 0x2b45c4, texte: 0x7b8794, manuel: 0xd9730d };

function boxGeometry(cx: number, cy: number, ux: number, uy: number, len: number, thick: number, y0: number, y1: number) {
  const g = new THREE.BoxGeometry(len, y1 - y0, thick);
  g.rotateY(Math.atan2(uy, ux));
  g.translate(cx, (y0 + y1) / 2, -cy);
  return g.toNonIndexed();
}

function extrudeFill(fill: Fill, f: number, cx: number, cy: number, h: number) {
  const toV = (p: number[]) => { const v: THREE.Vector2[] = []; for (let i = 0; i < p.length; i += 2) v.push(new THREE.Vector2((p[i] - cx) * f, (p[i + 1] - cy) * f)); return v; };
  const shape = new THREE.Shape(toV(fill.outer));
  for (const hole of fill.holes) shape.holes.push(new THREE.Path(toV(hole)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return g.index ? g.toNonIndexed() : g;
}

function toMeters(segs: number[], f: number, cx: number, cy: number) {
  const out = new Float64Array(segs.length);
  for (let i = 0; i < segs.length; i += 2) { out[i] = (segs[i] - cx) * f; out[i + 1] = (segs[i + 1] - cy) * f; }
  return out;
}

const lum = (c: number) => (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;

/** Construit les géométries 3D à partir des calques et de leur rôle. */
export function buildGeometry({ groups, settings: P, factor: f, center: [cx, cy], showPlan }: SceneInput) {
  const wallGeoms: THREE.BufferGeometry[] = [], glassGeoms: THREE.BufferGeometry[] = [];
  const lines: { segs: Float64Array; color: number; door: boolean; name: string }[] = [];
  let walls = 0, windows = 0;

  const wallLines: number[] = [];
  for (const g of groups) {
    if (roleOf(g, P) !== 'mur') continue;
    if (g.kind === 'fill') for (const fill of g.fills) { wallGeoms.push(extrudeFill(fill, f, cx, cy, P.hWall)); walls++; }
    else for (const v of g.segs) wallLines.push(v);
  }
  if (wallLines.length) {
    const s = toMeters(wallLines, f, cx, cy);
    const { boxes, leftovers } = pairWalls(s, 0.03, P.tMax);
    for (const b of boxes) wallGeoms.push(boxGeometry(b.x, b.y, b.ux, b.uy, b.len, b.thick, 0, P.hWall));
    // Dans un plan en double trait, les petits restes (retours, angles) sont déjà couverts par les murs voisins.
    const minLeft = boxes.length ? P.tMax : 0.02;
    for (const l of leftovers) {
      if (l.len <= minLeft) continue;
      wallGeoms.push(boxGeometry(l.x, l.y, l.ux, l.uy, l.len + (boxes.length ? 0 : P.tWall), P.tWall, 0, P.hWall));
      walls++;
    }
    walls += boxes.length;
  }

  for (const g of groups) {
    if (roleOf(g, P) !== 'fenetre') continue;
    for (const cl of clusterSegments(toMeters(g.segs, f, cx, cy), 0.08)) {
      const r = minAreaRect(cl);
      if (!r || r.L < 0.25) continue;
      const W = r.W < 0.04 ? P.tWall : r.W;
      const top = Math.min(P.sill + P.hWin, P.hWall);
      if (P.sill > 0) wallGeoms.push(boxGeometry(r.cx, r.cy, r.ux, r.uy, r.L, W, 0, Math.min(P.sill, P.hWall)));
      if (P.hWall > top) wallGeoms.push(boxGeometry(r.cx, r.cy, r.ux, r.uy, r.L, W, top, P.hWall));
      if (top > P.sill) glassGeoms.push(boxGeometry(r.cx, r.cy, r.ux, r.uy, r.L, Math.min(0.03, W), P.sill, top));
      windows++;
    }
  }

  for (const g of groups) {
    const role = roleOf(g, P);
    if (role === 'porte' || (role === 'plan' && showPlan)) {
      lines.push({ segs: toMeters(g.segs, f, cx, cy), color: role === 'porte' ? 0xa3622a : lum(g.color) > 0.82 ? 0x6b7480 : g.color, door: role === 'porte', name: g.name });
    }
  }
  return { wallGeoms, glassGeoms, lines, walls, windows };
}

/**
 * Scène 3D d'un plan : maquette, repères d'équipements, sélection et placement à la souris,
 * exports. Classe impérative pilotée par le composant React PlanView.
 */
export class PlanViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.05, 5000);
  private controls: OrbitControls;
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private model = new THREE.Group();
  private markers = new THREE.Group();
  private grid: THREE.GridHelper | null = null;
  private box = new THREE.Box3();
  private resizeObs: ResizeObserver;
  private pointsMesh: THREE.Points | null = null;
  private pointIds: string[] = [];
  private pin: THREE.Group;
  private pinTarget: THREE.Vector3 | null = null;
  private raycaster = new THREE.Raycaster();
  private down: { x: number; y: number } | null = null;
  private factor = 1;
  private center: [number, number] = [0, 0];
  private hWall = 2.5;
  private viewMode: '3d' | 'top' = '3d';

  /** Clic sur un repère d'équipement. */
  onPick: (id: string | null) => void = () => {};
  /** Clic au sol en mode placement : coordonnées dans le repère du dessin. */
  onPlace: ((x: number, y: number) => void) | null = null;
  /** Position écran de l'équipement sélectionné, pour son étiquette HTML. */
  onLabelMove: (pos: { x: number; y: number } | null) => void = () => {};

  private materials = {
    wall: new THREE.MeshStandardMaterial({ color: 0xeceae6, roughness: 0.92, metalness: 0 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x8ec3ea, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.45 }),
    slab: new THREE.MeshStandardMaterial({ color: 0xd6d0c4, roughness: 1, metalness: 0 }),
    edges: new THREE.LineBasicMaterial({ color: 0x2c3138, transparent: true, opacity: 0.55 }),
  };

  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.6));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target, this.model, this.markers);

    // Épingle de l'équipement sélectionné : tige + tête, dimensionnées à chaque sélection.
    this.pin = new THREE.Group();
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshStandardMaterial({ color: 0xd9730d, emissive: 0x6a2f00, roughness: 0.4 }));
    head.name = 'tete';
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 10), new THREE.MeshStandardMaterial({ color: 0xd9730d }));
    stem.name = 'tige';
    this.pin.add(head, stem);
    this.pin.visible = false;
    this.scene.add(this.pin);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!this.down || Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return;
      this.handleClick(e);
    });
    this.renderer.setAnimationLoop(() => this.frame());
  }

  setBackground(color: string) {
    this.scene.background = new THREE.Color(color);
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this.pinTarget) {
      const p = this.pinTarget.clone().project(this.camera);
      const visible = p.z < 1 && Math.abs(p.x) <= 1.1 && Math.abs(p.y) <= 1.1;
      this.onLabelMove(visible ? { x: (p.x + 1) / 2 * this.container.clientWidth, y: (1 - p.y) / 2 * this.container.clientHeight } : null);
    }
  }

  private disposeChildren(group: THREE.Group) {
    for (const o of [...group.children]) {
      group.remove(o);
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | undefined;
        if (mat && !Object.values(this.materials).includes(mat as never)) mat.dispose();
      });
    }
  }

  /** Reconstruit la maquette. Renvoie de quoi afficher les compteurs. */
  build(input: SceneInput, gridColor: string): BuildStats {
    const { settings: P } = input;
    this.factor = input.factor;
    this.center = input.center;
    this.hWall = P.hWall;
    const built = buildGeometry(input);
    this.disposeChildren(this.model);

    if (built.wallGeoms.length) {
      const g = mergeGeometries(built.wallGeoms, false);
      built.wallGeoms.forEach((x) => x.dispose());
      const mesh = new THREE.Mesh(g, this.materials.wall);
      mesh.name = 'Murs';
      mesh.castShadow = mesh.receiveShadow = true;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), this.materials.edges);
      edges.userData.noExport = true;
      this.model.add(mesh, edges);
    }
    if (built.glassGeoms.length) {
      const g = mergeGeometries(built.glassGeoms, false);
      built.glassGeoms.forEach((x) => x.dispose());
      const mesh = new THREE.Mesh(g, this.materials.glass);
      mesh.name = 'Vitrages';
      this.model.add(mesh);
    }
    for (const l of built.lines) {
      const pos = new Float32Array((l.segs.length / 2) * 3);
      const y = l.door ? 0.008 : 0.004;
      for (let i = 0, k = 0; i < l.segs.length; i += 2, k += 3) { pos[k] = l.segs[i]; pos[k + 1] = y; pos[k + 2] = -l.segs[i + 1]; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: l.color }));
      line.name = l.name;
      this.model.add(line);
    }

    const box = new THREE.Box3().setFromObject(this.model);
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, P.hWall, 5));
    if (P.slab) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(box.max.x - box.min.x + 0.4, 0.12, box.max.z - box.min.z + 0.4), this.materials.slab);
      slab.name = 'Dalle';
      slab.position.set((box.min.x + box.max.x) / 2, -0.06, (box.min.z + box.max.z) / 2);
      slab.receiveShadow = true;
      this.model.add(slab);
    }

    const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 4);
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); (this.grid.material as THREE.Material).dispose(); }
    const gsize = Math.ceil(size * 1.6);
    this.grid = new THREE.GridHelper(gsize, gsize, new THREE.Color(gridColor), new THREE.Color(gridColor));
    this.grid.position.set((box.min.x + box.max.x) / 2, P.slab ? -0.121 : -0.001, (box.min.z + box.max.z) / 2);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.7;
    this.scene.add(this.grid);

    const c = box.getCenter(new THREE.Vector3());
    this.sun.position.set(c.x + size * 0.6, size * 1.2 + 5, c.z + size * 0.9);
    this.sun.target.position.copy(c);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -size; sc.right = sc.top = size; sc.near = 0.1; sc.far = size * 4 + 20;
    sc.updateProjectionMatrix();
    this.box = box;
    return { walls: built.walls, windows: built.windows, width: box.max.x - box.min.x, depth: box.max.z - box.min.z };
  }

  private toScene(e: Equipment, y = 0.05) {
    return new THREE.Vector3((e.x - this.center[0]) * this.factor, y, -(e.y - this.center[1]) * this.factor);
  }

  /** Repères des équipements (un point par équipement, couleur selon l'origine). */
  setMarkers(list: Equipment[], visible: boolean) {
    this.disposeChildren(this.markers);
    this.pointsMesh = null;
    this.pointIds = list.map((e) => e.id);
    if (!list.length) return;
    const pos = new Float32Array(list.length * 3), col = new Float32Array(list.length * 3);
    const c = new THREE.Color();
    list.forEach((e, i) => {
      const v = this.toScene(e, 0.06);
      pos.set([v.x, v.y, v.z], i * 3);
      c.setHex(KIND_COLORS[e.kind]);
      col.set([c.r, c.g, c.b], i * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.pointsMesh = new THREE.Points(geo, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }));
    this.pointsMesh.renderOrder = 10;
    this.pointsMesh.userData.noExport = true;
    this.pointsMesh.visible = visible;
    this.markers.add(this.pointsMesh);
  }

  /** Met en évidence un équipement (épingle + étiquette) et, si demandé, centre la vue dessus. */
  select(e: Equipment | null, focus: boolean) {
    if (!e) { this.pin.visible = false; this.pinTarget = null; this.onLabelMove(null); return; }
    const base = this.toScene(e, 0);
    const scale = Math.max(this.box.getSize(new THREE.Vector3()).length() / 120, 0.08);
    const h = this.hWall + scale * 6;
    const head = this.pin.getObjectByName('tete')!, stem = this.pin.getObjectByName('tige')!;
    head.scale.setScalar(scale * 1.6);
    head.position.set(0, h, 0);
    stem.scale.set(scale, h, scale);
    stem.position.set(0, h / 2, 0);
    this.pin.position.copy(base);
    this.pin.visible = true;
    this.pinTarget = base.clone().setY(h + scale * 2);
    if (focus) {
      // Vise le milieu de l'épingle, d'assez loin pour voir l'équipement dans son local.
      const target = base.clone().setY(h / 2);
      const dist = Math.max(this.box.getSize(new THREE.Vector3()).length() * 0.55, h * 3, 8);
      const dir = this.viewMode === 'top' ? new THREE.Vector3(0, 1, 0.0001) : new THREE.Vector3(0.55, 0.75, 0.9).normalize();
      this.controls.target.copy(target);
      this.camera.position.copy(target).addScaledVector(dir, dist);
      this.camera.near = Math.max(0.01, dist / 500);
      this.camera.far = Math.max(this.camera.far, dist * 20);
      this.camera.updateProjectionMatrix();
      this.controls.update();
    }
  }

  fit(mode: '3d' | 'top' = this.viewMode) {
    this.viewMode = mode;
    const c = this.box.getCenter(new THREE.Vector3());
    const r = Math.max(this.box.getSize(new THREE.Vector3()).length() / 2, 2);
    const dist = r / Math.sin((this.camera.fov * Math.PI / 180) / 2) * 1.05;
    const dir = mode === 'top' ? new THREE.Vector3(0, 1, 0.0001) : new THREE.Vector3(0.75, 0.85, 1.1);
    dir.normalize();
    this.camera.position.copy(c).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.01, dist / 500);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(c);
    this.controls.update();
  }

  private handleClick(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    if (this.onPlace) {
      const hit = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) {
        this.onPlace(hit.x / this.factor + this.center[0], -hit.z / this.factor + this.center[1]);
      }
      return;
    }
    if (this.pointsMesh?.visible) {
      // Tolérance de sélection en pixels convertie en distance à la profondeur visée.
      const dist = this.camera.position.distanceTo(this.controls.target);
      this.raycaster.params.Points = { threshold: (dist * Math.tan((this.camera.fov * Math.PI) / 360) * 2 / rect.height) * 8 };
      const hits = this.raycaster.intersectObject(this.pointsMesh);
      if (hits.length && hits[0].index !== undefined) { this.onPick(this.pointIds[hits[0].index]); return; }
    }
    this.onPick(null);
  }

  setPlacing(on: boolean) {
    this.renderer.domElement.style.cursor = on ? 'crosshair' : '';
  }

  private exportRoot(zUp: boolean) {
    const root = new THREE.Group();
    this.model.updateMatrixWorld(true);
    this.model.traverse((o) => {
      if (o.userData.noExport || o === this.model) return;
      let c: THREE.Object3D | null = null;
      if ((o as THREE.Mesh).isMesh) c = new THREE.Mesh((o as THREE.Mesh).geometry, (o as THREE.Mesh).material);
      else if ((o as THREE.LineSegments).isLineSegments && !zUp) c = new THREE.LineSegments((o as THREE.LineSegments).geometry, (o as THREE.LineSegments).material);
      if (!c) return;
      c.name = o.name;
      c.applyMatrix4(o.matrixWorld);
      root.add(c);
    });
    // Impression 3D : Z vers le haut (convention des logiciels de découpe).
    if (zUp) root.rotation.x = Math.PI / 2;
    root.updateMatrixWorld(true);
    return root;
  }

  async export(format: 'glb' | 'obj' | 'stl'): Promise<Blob> {
    if (format === 'glb') {
      const data = await new GLTFExporter().parseAsync(this.exportRoot(false), { binary: true }) as ArrayBuffer;
      return new Blob([data], { type: 'model/gltf-binary' });
    }
    if (format === 'obj') return new Blob([new OBJExporter().parse(this.exportRoot(false))], { type: 'text/plain' });
    const dv = new STLExporter().parse(this.exportRoot(true), { binary: true }) as unknown as DataView;
    return new Blob([dv.buffer as ArrayBuffer], { type: 'model/stl' });
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObs.disconnect();
    this.disposeChildren(this.model);
    this.disposeChildren(this.markers);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
