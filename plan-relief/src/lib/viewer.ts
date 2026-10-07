import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { floorFootprint, toMeters, type Box2 } from './footprints';
import { roleOf } from './drawing';
import { categoryOf, type Equipment, type EquipmentKind, type Fill, type Group, type PlanSettings } from './types';

export interface SceneInput {
  groups: Group[];
  settings: PlanSettings;
  factor: number;
  center: [number, number];
  showPlan: boolean;
}

export interface BuildStats { walls: number; windows: number; width: number; depth: number }

const KIND_COLORS: Record<EquipmentKind, number> = { bloc: 0x2b45c4, texte: 0x7b8794, manuel: 0xd9730d };

function boxGeometry(b: Box2) {
  const g = new THREE.BoxGeometry(b.len, b.y1 - b.y0, b.thick);
  g.rotateY(Math.atan2(b.uy, b.ux));
  g.translate(b.cx, (b.y0 + b.y1) / 2, -b.cy);
  return g.toNonIndexed();
}

function extrudeFill(fill: Fill, h: number) {
  const toV = (p: number[]) => { const v: THREE.Vector2[] = []; for (let i = 0; i < p.length; i += 2) v.push(new THREE.Vector2(p[i], p[i + 1])); return v; };
  const shape = new THREE.Shape(toV(fill.outer));
  for (const hole of fill.holes) shape.holes.push(new THREE.Path(toV(hole)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return g.index ? g.toNonIndexed() : g;
}

const lum = (c: number) => (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;

/** Construit les géométries 3D à partir des calques et de leur rôle (emprise : footprints.ts). */
export function buildGeometry({ groups, settings: P, factor: f, center, showPlan }: SceneInput) {
  const fp = floorFootprint(groups, P, f, center);
  const wallGeoms = [...fp.walls.map(boxGeometry), ...fp.fills.map((fill) => extrudeFill(fill, P.hWall))];
  const glassGeoms = fp.glass.map(boxGeometry);
  const lines: { segs: Float64Array; color: number; door: boolean; name: string }[] = [];
  for (const g of groups) {
    const role = roleOf(g, P);
    if (role === 'porte' || (role === 'plan' && showPlan)) {
      lines.push({ segs: toMeters(g.segs, f, center[0], center[1]), color: role === 'porte' ? 0xa3622a : lum(g.color) > 0.82 ? 0x6b7480 : g.color, door: role === 'porte', name: g.name });
    }
  }
  return { wallGeoms, glassGeoms, lines, walls: fp.wallCount, windows: fp.windowCount };
}

/**
 * Scène 3D d'un plan : maquette, repères d'équipements, sélection et placement à la souris,
 * exports. Classe impérative pilotée par le composant React PlanView.
 */
export class PlanViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.05, 5000);
  private controls: MapControls;
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private model = new THREE.Group();
  private markers = new THREE.Group();
  private landmarks = new THREE.Group();
  private route = new THREE.Group();
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
    ghost: new THREE.MeshStandardMaterial({ color: 0xc9cdd3, roughness: 0.9, transparent: true, opacity: 0.28, depthWrite: false }),
    ghostSlab: new THREE.MeshStandardMaterial({ color: 0xd6d0c4, roughness: 1, transparent: true, opacity: 0.35, depthWrite: false }),
    route: new THREE.MeshStandardMaterial({ color: 0xd9730d, emissive: 0x7a3300, roughness: 0.35 }),
  };

  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Maquette immobile : les ombres sont calculées une fois par construction, pas à chaque
    // image (sur un grand plan, c'est ce qui rendait la navigation saccadée).
    this.renderer.shadowMap.autoUpdate = false;
    container.appendChild(this.renderer.domElement);

    // Navigation « carte » : glisser déplace la vue sur le plan, clic droit (ou deux doigts)
    // la fait tourner, la molette zoome vers le pointeur et non vers le centre du plan :
    // on va là où l'on regarde. Flèches du clavier une fois la vue cliquée.
    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.zoomToCursor = true;
    this.controls.minDistance = 0.5;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.keyPanSpeed = 25;
    this.renderer.domElement.tabIndex = 0;
    this.controls.listenToKeyEvents(this.renderer.domElement);
    this.controls.addEventListener('change', () => { this.dirty = true; });

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.6));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target, this.model, this.markers, this.route, this.landmarks);

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
    this.dirty = true;
    this.scene.background = new THREE.Color(color);
  }

  private resize() {
    this.dirty = true;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Rendu à la demande : une image n'est calculée que si la vue a bougé ou si la scène a
   * changé. Sur un grand plan, redessiner en continu occupait le processeur même vue
   * immobile, au détriment du reste (lecture OCR d'une page, par exemple).
   */
  private dirty = true;
  private frame() {
    this.controls.update();
    if (!this.dirty) return;
    this.dirty = false;
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
  /** Murs, vitrages et traits au sol d'un étage, dans un groupe (coordonnées de l'étage). */
  private floorGroup(input: SceneInput, wallMat: THREE.Material, edges: boolean) {
    const built = buildGeometry(input);
    const group = new THREE.Group();
    if (built.wallGeoms.length) {
      const g = mergeGeometries(built.wallGeoms, false);
      built.wallGeoms.forEach((x) => x.dispose());
      const mesh = new THREE.Mesh(g, wallMat);
      mesh.name = 'Murs';
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      if (edges) {
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), this.materials.edges);
        e.userData.noExport = true;
        group.add(e);
      }
    }
    if (built.glassGeoms.length) {
      const g = mergeGeometries(built.glassGeoms, false);
      built.glassGeoms.forEach((x) => x.dispose());
      const mesh = new THREE.Mesh(g, this.materials.glass);
      mesh.name = 'Vitrages';
      group.add(mesh);
    }
    for (const l of built.lines) {
      const pos = new Float32Array((l.segs.length / 2) * 3);
      const y = l.door ? 0.008 : 0.004;
      for (let i = 0, k = 0; i < l.segs.length; i += 2, k += 3) { pos[k] = l.segs[i]; pos[k + 1] = y; pos[k + 2] = -l.segs[i + 1]; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: l.color }));
      line.name = l.name;
      group.add(line);
    }
    return { group, walls: built.walls, windows: built.windows };
  }

  private addSlab(target: THREE.Group, box: THREE.Box3, y: number, material: THREE.Material = this.materials.slab) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(box.max.x - box.min.x + 0.4, 0.12, box.max.z - box.min.z + 0.4), material);
    slab.name = 'Dalle';
    slab.position.set((box.min.x + box.max.x) / 2, y - 0.06, (box.min.z + box.max.z) / 2);
    slab.receiveShadow = true;
    target.add(slab);
  }

  /** Grille au sol, soleil et ombres dimensionnés sur la maquette. */
  private frameScene(box: THREE.Box3, gridY: number, gridColor: string) {
    const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 4);
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); (this.grid.material as THREE.Material).dispose(); }
    const gsize = Math.ceil(size * 1.6);
    this.grid = new THREE.GridHelper(gsize, gsize, new THREE.Color(gridColor), new THREE.Color(gridColor));
    this.grid.position.set((box.min.x + box.max.x) / 2, gridY, (box.min.z + box.max.z) / 2);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.7;
    this.scene.add(this.grid);
    const c = box.getCenter(new THREE.Vector3());
    const height = box.max.y - box.min.y;
    this.sun.position.set(c.x + size * 0.6, box.max.y + size * 1.2 + 5, c.z + size * 0.9);
    this.sun.target.position.copy(c);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -size - height; sc.right = sc.top = size + height; sc.near = 0.1; sc.far = size * 4 + height * 2 + 20;
    sc.updateProjectionMatrix();
    this.box = box;
    this.controls.maxDistance = Math.max(size, height, 10) * 6;
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Reconstruit la maquette d'un étage. Renvoie de quoi afficher les compteurs. */
  build(input: SceneInput, gridColor: string): BuildStats {
    this.dirty = true;
    const { settings: P } = input;
    this.factor = input.factor;
    this.center = input.center;
    this.hWall = P.hWall;
    this.disposeChildren(this.model);
    this.disposeChildren(this.route);
    const { group, walls, windows } = this.floorGroup(input, this.materials.wall, true);
    for (const o of [...group.children]) this.model.add(o);
    const box = new THREE.Box3().setFromObject(this.model);
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, P.hWall, 5));
    if (P.slab) this.addSlab(this.model, box, 0);
    this.frameScene(box, P.slab ? -0.121 : -0.001, gridColor);
    return { walls, windows, width: box.max.x - box.min.x, depth: box.max.z - box.min.z };
  }

  /**
   * Bâtiment : les étages empilés à leur altitude, décalés pour se superposer. Les murs
   * peuvent être rendus transparents pour laisser voir un tracé qui traverse les étages.
   */
  buildStack(floors: { input: SceneInput; elevation: number; offset: [number, number]; name: string }[], gridColor: string, transparent: boolean) {
    this.dirty = true;
    this.disposeChildren(this.model);
    this.disposeChildren(this.markers);
    this.pointsMesh = null;
    this.pin.visible = false;
    this.pinTarget = null;
    const wallMat = transparent ? this.materials.ghost : this.materials.wall;
    for (const f of floors) {
      const { group } = this.floorGroup(f.input, wallMat, !transparent);
      const box = new THREE.Box3().setFromObject(group);
      // En mode transparent, les dalles le sont aussi : un tracé à l'étage du dessous reste visible.
      if (!box.isEmpty()) this.addSlab(group, box, 0, transparent ? this.materials.ghostSlab : this.materials.slab);
      group.name = f.name;
      group.position.set(f.offset[0], f.elevation, -f.offset[1]);
      this.model.add(group);
    }
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
    const lowest = Math.min(...floors.map((f) => f.elevation), 0);
    this.frameScene(box, lowest - 0.121, gridColor);
  }

  /** Tracé : tube orange, sphère verte au départ, rouge à l'arrivée. Coordonnées de scène. */
  setRoute(points: THREE.Vector3[] | null) {
    this.dirty = true;
    this.disposeChildren(this.route);
    this.renderer.shadowMap.needsUpdate = true;
    if (!points || points.length < 2) return;
    const scale = Math.max(this.box.getSize(new THREE.Vector3()).length() / 400, 0.05);
    const r = Math.min(scale, 0.12);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const len = a.distanceTo(b);
      if (len < 1e-4) continue;
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), this.materials.route);
      cyl.position.copy(a).add(b).multiplyScalar(0.5);
      cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      cyl.name = 'Tracé';
      this.route.add(cyl);
      const joint = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), this.materials.route);
      joint.position.copy(b);
      this.route.add(joint);
    }
    const end = (p: THREE.Vector3, color: number) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r * 3.5, 20, 14), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
      m.position.copy(p);
      this.route.add(m);
    };
    end(points[0], 0x2e9e5b);
    end(points[points.length - 1], 0xd23c32);
  }

  private toScene(e: Equipment, y = 0.05) {
    return new THREE.Vector3((e.x - this.center[0]) * this.factor, y, -(e.y - this.center[1]) * this.factor);
  }

  /**
   * Escaliers et ascenseurs : volume coloré semi-transparent sur leur emprise, un peu plus
   * haut que les murs pour se voir de loin (vert : escalier, bleu : ascenseur).
   */
  setLandmarks(list: Equipment[], visible: boolean) {
    this.dirty = true;
    this.disposeChildren(this.landmarks);
    this.landmarks.visible = visible;
    const h = this.hWall * 1.25;
    for (const e of list) {
      if (!e.footprint) continue;
      const color = categoryOf(e.category)?.color ?? 0xd9730d;
      const w = Math.max(e.footprint.w * this.factor, 0.3), d = Math.max(e.footprint.d * this.factor, 0.3);
      const geo = new THREE.BoxGeometry(w, h, d);
      const box = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false }));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color }));
      const item = new THREE.Group();
      item.add(box, edges);
      item.position.copy(this.toScene(e, h / 2));
      // Repère du dessin (x, y) → scène (x, -z) : l'angle du plan devient une rotation autour de y.
      item.rotation.y = e.footprint.angle;
      item.name = e.label;
      item.userData.noExport = true;
      this.landmarks.add(item);
    }
  }

  /** Repères des équipements (un point par équipement, couleur de sa catégorie, à défaut de son origine). */
  setMarkers(list: Equipment[], visible: boolean) {
    this.dirty = true;
    this.disposeChildren(this.markers);
    this.pointsMesh = null;
    this.pointIds = list.map((e) => e.id);
    if (!list.length) return;
    const pos = new Float32Array(list.length * 3), col = new Float32Array(list.length * 3);
    const c = new THREE.Color();
    list.forEach((e, i) => {
      const v = this.toScene(e, 0.06);
      pos.set([v.x, v.y, v.z], i * 3);
      c.setHex(categoryOf(e.category)?.color ?? KIND_COLORS[e.kind]);
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
    this.dirty = true;
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
    this.dirty = true;
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
    // Le tracé est exporté avec la maquette : utile pour le dossier de câblage.
    for (const top of [this.model, this.route]) top.updateMatrixWorld(true);
    const visit = (o: THREE.Object3D) => {
      if (o.userData.noExport || o === this.model || o === this.route) return;
      let c: THREE.Object3D | null = null;
      if ((o as THREE.Mesh).isMesh) c = new THREE.Mesh((o as THREE.Mesh).geometry, (o as THREE.Mesh).material);
      else if ((o as THREE.LineSegments).isLineSegments && !zUp) c = new THREE.LineSegments((o as THREE.LineSegments).geometry, (o as THREE.LineSegments).material);
      if (!c) return;
      c.name = o.name;
      c.applyMatrix4(o.matrixWorld);
      root.add(c);
    };
    this.model.traverse(visit);
    this.route.traverse(visit);
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
    this.disposeChildren(this.landmarks);
    this.disposeChildren(this.model);
    this.disposeChildren(this.markers);
    this.disposeChildren(this.route);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
