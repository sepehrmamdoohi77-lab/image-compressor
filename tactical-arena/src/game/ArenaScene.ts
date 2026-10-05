import * as THREE from 'three';
import type {
  CombatEvent,
  Snapshot,
  GameConfig,
  PlayerInfo,
  Transform,
} from '../multiplayer/protocol';
import type { Settings } from '../services/Settings';
import { Environment } from './Environment';
import { Soldier } from './Soldier';
import { TacticalCamera } from './TacticalCamera';
import { CombatEffects } from './Effects';
import { GrenadeAim, type GrenadePreview } from './GrenadeAim';

export class ArenaScene {
  private scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private environment: Environment;
  private actors = new Map<string, Soldier>();
  private light: THREE.DirectionalLight;
  private resizeObserver: ResizeObserver;
  private raf = 0;
  private last = 0;
  private lastRender = 0;
  private disposed = false;
  private localId: string;
  private raycaster = new THREE.Raycaster();
  private floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private aimPoint = new THREE.Vector3();
  private projection = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private intersections: THREE.Intersection[] = [];
  private width = 1;
  private height = 1;
  private settings: Settings;
  private effects: CombatEffects;
  private grenadeGuide: GrenadeAim;
  private visiblePlayers = new Set<string>();
  private destroyed: string[] = [];
  private combatEnabled = false;
  private serverNow = 0;
  private shake = 0;
  readonly camera = new TacticalCamera();

  constructor(
    private container: HTMLElement,
    private labels: HTMLElement,
    config: GameConfig,
    localId: string,
    settings: Settings,
    private frame: (dt: number) => void,
  ) {
    this.localId = localId;
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(config.map.theme?.sky ?? '#929b91');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.domElement.className = 'arena-canvas';
    this.renderer.domElement.setAttribute(
      'aria-label',
      `Live 3D ${config.map.name} multiplayer field`,
    );
    container.append(this.renderer.domElement);
    this.scene.fog = new THREE.Fog(config.map.theme?.sky ?? '#929b91', 66, 110);
    this.scene.add(new THREE.HemisphereLight('#dbe4df', '#656653', 2.1));
    this.light = new THREE.DirectionalLight('#ffedce', 2.8);
    this.light.position.set(-17, 28, 13);
    this.light.castShadow = true;
    const shadow = this.light.shadow.camera;
    shadow.left = shadow.bottom = -30;
    shadow.right = shadow.top = 30;
    shadow.near = 1;
    shadow.far = 90;
    this.light.shadow.bias = -0.0004;
    this.light.shadow.normalBias = 0.04;
    this.scene.add(this.light);
    this.grenadeGuide = new GrenadeAim(config);
    this.scene.add(this.grenadeGuide.group);
    this.effects = new CombatEffects(config);
    this.scene.add(this.effects.group);
    this.environment = new Environment(config);
    this.scene.add(this.environment.group);
    this.applySettings(settings);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.raf = requestAnimationFrame((time) => this.loop(time));
  }
  private resize(): void {
    this.width = Math.max(1, this.container.clientWidth);
    this.height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(this.width, this.height);
    this.camera.resize(this.width, this.height);
  }
  setPlayers(players: PlayerInfo[]): void {
    const live = new Set(players.filter((p) => p.connected).map((p) => p.id));
    for (const [id, actor] of this.actors)
      if (!live.has(id)) {
        actor.dispose();
        this.actors.delete(id);
      }
    const ownTeam = players.find((p) => p.id === this.localId)?.team ?? 'blue';
    for (const info of players) {
      this.actors.get(info.id)?.setInfo(info, ownTeam);
      if (info.connected && !this.actors.has(info.id)) {
        const actor = new Soldier(info, info.id === this.localId, this.labels, ownTeam);
        actor.setCombatEnabled(this.combatEnabled);
        this.actors.set(info.id, actor);
        this.scene.add(actor.group);
      }
    }
  }
  updatePoses(poses: Transform[], dt: number): void {
    for (const pose of poses)
      if (this.visiblePlayers.has(pose.id))
        this.actors.get(pose.id)?.update(pose, dt, this.serverNow);
  }
  setCombatEnabled(enabled: boolean): void {
    this.combatEnabled = enabled;
    this.actors.forEach((a) => a.setCombatEnabled(enabled));
  }
  snapshot(snapshot: Snapshot): void {
    this.serverNow = snapshot.serverTimeMs;
    this.visiblePlayers = new Set(snapshot.players.map((p) => p.id));
    this.destroyed = snapshot.destroyed;
    for (const [id, actor] of this.actors)
      if (!this.visiblePlayers.has(id)) {
        actor.group.visible = false;
        actor.label.hidden = true;
      }
    this.environment.setDestroyed(snapshot.destroyed);
    this.effects.updateGrenades(snapshot.grenades);
  }
  combatEvent(message: CombatEvent): void {
    this.effects.event(message);
    if (this.settings.cameraShake) {
      if (message.event.kind === 'shot' && message.event.playerId === this.localId)
        this.shake = 0.06;
      if (message.event.kind === 'explosion') this.shake = 0.16;
    }
  }
  setServerTime(now: number): void {
    this.serverNow = now;
  }
  get localPosition(): THREE.Vector3 | null {
    return this.actors.get(this.localId)?.position ?? null;
  }
  mousePoint(x: number, y: number): { x: number; z: number; y?: number } | null {
    this.raycaster.far = 150;
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera.camera);
    if (this.combatEnabled) {
      this.intersections.length = 0;
      const targets = [...this.actors.entries()]
        .filter(([id, a]) => id !== this.localId && a.hasPose && a.group.visible)
        .map(([, a]) => a.group);
      this.raycaster.intersectObjects(targets, true, this.intersections);
      const hit = this.intersections[0];
      if (hit && hit.point.y > 0.12) {
        let object: THREE.Object3D | null = hit.object;
        while (object && !object.userData.playerId) object = object.parent;
        const actor = object ? this.actors.get(object.userData.playerId) : null;
        // A picked helmet/goggle targets its real head zone, not an accessory
        // surface above the server's hit volume. Only an actual mesh pick qualifies.
        return actor?.aimTarget(hit) ?? { x: hit.point.x, y: hit.point.y, z: hit.point.z };
      }
    }
    return this.raycaster.ray.intersectPlane(this.floor, this.aimPoint)
      ? { x: this.aimPoint.x, z: this.aimPoint.z }
      : null;
  }
  grenadeTarget(
    pose: Transform | null,
    target: { x: number; z: number } | null,
    enabled: boolean,
  ): GrenadePreview | null {
    return this.grenadeGuide.update(pose, target, this.destroyed, enabled && this.combatEnabled);
  }
  applySettings(settings: Settings): void {
    this.settings = settings;
    this.effects.quality = settings.quality;
    this.camera.zoom = settings.zoom;
    this.renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio,
        settings.quality === 'high' ? 2 : settings.quality === 'balanced' ? 1.5 : 1,
      ),
    );
    this.renderer.shadowMap.enabled = settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const size = settings.quality === 'high' ? 2048 : 1024;
    if (this.light.shadow.mapSize.x !== size) {
      this.light.shadow.map?.dispose();
      this.light.shadow.map = null;
      this.light.shadow.mapSize.set(size, size);
    }
    this.renderer.shadowMap.needsUpdate = true;
  }
  private loop(time: number): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame((next) => this.loop(next));
    const dt = Math.min(0.1, this.last ? (time - this.last) / 1000 : 1 / 60);
    this.last = time;
    if (document.hidden) return;
    this.frame(dt);
    this.camera.update(this.localPosition, dt);
    this.effects.tick(dt);
    if (this.shake > 0) {
      this.camera.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.camera.position.z += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 0.5);
    }
    if (time - this.lastRender < 1000 / this.settings.fpsTarget - 0.6) return;
    this.lastRender = time;
    this.renderer.render(this.scene, this.camera.camera);
    this.updateLabels();
  }
  private updateLabels(): void {
    const camera = this.camera.camera;
    for (const actor of this.actors.values()) {
      if (
        !actor.hasPose ||
        !actor.group.visible ||
        !this.visiblePlayers.has(actor.group.userData.playerId)
      ) {
        actor.label.hidden = true;
        continue;
      }
      this.projection.copy(actor.position);
      this.projection.y = actor.labelHeight;
      this.direction.subVectors(this.projection, camera.position);
      const distance = this.direction.length();
      this.direction.normalize();
      this.raycaster.set(camera.position, this.direction);
      this.raycaster.far = distance - 0.15;
      this.intersections.length = 0;
      this.raycaster.intersectObjects(this.environment.activeColliders, false, this.intersections);
      this.projection.project(camera);
      const onScreen =
        Math.abs(this.projection.x) < 0.98 &&
        Math.abs(this.projection.y) < 0.95 &&
        this.projection.z < 1;
      // A camera-obscured marker is not a wallhack: this actor was explicitly
      // made relevant by the server's player-to-player visibility check.
      actor.label.hidden = !onScreen;
      actor.label.classList.toggle('is-occluded', this.intersections.length > 0);
      actor.label.style.transform = `translate(${((this.projection.x + 1) / 2) * this.width}px, ${((1 - this.projection.y) / 2) * this.height}px) translate(-50%, -100%)`;
    }
  }
  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.actors.forEach((a) => a.dispose());
    this.actors.clear();
    this.environment.dispose();
    this.effects.dispose();
    this.grenadeGuide.dispose();
    this.light.shadow.map?.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
