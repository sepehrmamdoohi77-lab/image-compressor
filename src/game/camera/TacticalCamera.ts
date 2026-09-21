// Isometric tactical camera: fixed-angle 3/4 view, smooth follow, zoom, trauma shake.
import * as THREE from 'three';
import { CAMERA_CONFIG } from '../data/config';
import { clamp, dampFactor, finiteOr } from '../utils/math';

export class TacticalCamera {
  camera: THREE.PerspectiveCamera;
  target = new THREE.Vector3();
  distance: number;
  trauma = 0;
  private shakeOffset = new THREE.Vector3();
  private desiredTarget = new THREE.Vector3();
  private boundsHalf = 20;
  private time = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(
      CAMERA_CONFIG.fov,
      aspect,
      0.5,
      220,
    );
    this.distance = CAMERA_CONFIG.distance;
    this.updateProjection();
  }

  setBounds(half: number): void {
    this.boundsHalf = Math.max(4, half - CAMERA_CONFIG.boundaryMargin);
  }

  setTarget(x: number, y: number, z: number, snap = false): void {
    this.desiredTarget.set(
      clamp(x, -this.boundsHalf, this.boundsHalf),
      0,
      clamp(z, -this.boundsHalf, this.boundsHalf),
    );
    if (snap) this.target.copy(this.desiredTarget);
  }

  setDistance(d: number): void {
    this.distance = clamp(d, CAMERA_CONFIG.minDistance, CAMERA_CONFIG.maxDistance);
  }

  zoomBy(delta: number): void {
    this.setDistance(this.distance + delta * 0.01);
  }

  addTrauma(amount: number): void {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  /** Small positional kick (firing feedback). Direction: opposite of aim yaw. */
  kick(amount: number, yaw: number): void {
    this.shakeOffset.x += -Math.sin(yaw) * amount;
    this.shakeOffset.z += -Math.cos(yaw) * amount;
  }

  update(dt: number): void {
    dt = finiteOr(dt, 0.016);
    this.time += dt;
    const k = dampFactor(CAMERA_CONFIG.followSmoothing, dt);
    this.target.lerp(this.desiredTarget, k);

    // Trauma decay + shake noise.
    this.trauma = Math.max(0, this.trauma - CAMERA_CONFIG.shakeDecay * dt * this.trauma - 0.12 * dt);
    const sh = this.trauma * this.trauma * CAMERA_CONFIG.maxShakeOffset;
    const t = this.time * 34;
    const sx = (Math.sin(t * 1.1) + Math.sin(t * 2.3) * 0.5) * 0.5 * sh;
    const sy = (Math.cos(t * 1.7) + Math.sin(t * 2.9) * 0.5) * 0.35 * sh;
    const sz = (Math.cos(t * 1.3) + Math.cos(t * 2.1) * 0.5) * 0.5 * sh;

    const el = THREE.MathUtils.degToRad(CAMERA_CONFIG.elevationDeg);
    const az = THREE.MathUtils.degToRad(CAMERA_CONFIG.azimuthDeg);
    const d = this.distance;
    const ox = Math.cos(el) * Math.sin(az) * d;
    const oy = Math.sin(el) * d;
    const oz = Math.cos(el) * Math.cos(az) * d;

    // Kick offset decays fast.
    this.shakeOffset.multiplyScalar(Math.exp(-9 * dt));

    this.camera.position.set(
      finiteOr(this.target.x + ox + sx + this.shakeOffset.x, 0),
      finiteOr(oy + sy, 20),
      finiteOr(this.target.z + oz + sz + this.shakeOffset.z, 20),
    );
    this.camera.lookAt(this.target.x + sx * 0.5, 0.8, this.target.z + sz * 0.5);
    this.camera.updateMatrixWorld();
  }

  updateProjection(): void {
    this.camera.updateProjectionMatrix();
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.updateProjection();
  }

  /** Screen (px) -> ground-plane (y=0) world point for mouse aiming. */
  screenToGround(clientX: number, clientY: number, rect: DOMRect, out: THREE.Vector3): THREE.Vector3 {
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = TacticalCamera.sharedRaycaster;
    raycaster.setFromCamera(TacticalCamera.sharedNdc.set(nx, ny), this.camera);
    const ray = raycaster.ray;
    // Intersect y=0 plane.
    if (Math.abs(ray.direction.y) < 1e-6) {
      out.copy(this.target);
      return out;
    }
    const t = -ray.origin.y / ray.direction.y;
    if (t < 0) {
      out.copy(this.target);
      return out;
    }
    out.copy(ray.origin).addScaledVector(ray.direction, t);
    out.x = finiteOr(out.x, this.target.x);
    out.z = finiteOr(out.z, this.target.z);
    out.y = 0;
    return out;
  }

  private static sharedRaycaster = new THREE.Raycaster();
  private static sharedNdc = new THREE.Vector2();
}
