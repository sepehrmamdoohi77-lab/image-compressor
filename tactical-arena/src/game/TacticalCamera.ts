import * as THREE from 'three';

export class TacticalCamera {
  readonly camera = new THREE.OrthographicCamera(-24, 24, 16, -16, 0.1, 130);
  private target = new THREE.Vector3();
  private desiredYaw = 0.6;
  yaw = 0.6;
  zoom = 16;
  overview = true;
  private aspect = 1;
  private initialized = false;
  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    this.projection();
  }
  rotate(delta: number): void {
    this.desiredYaw += delta;
  }
  update(own: THREE.Vector3 | null, dt: number): void {
    this.yaw += (this.desiredYaw - this.yaw) * (1 - Math.exp(-dt * 12));
    const x = this.overview ? 0 : (own?.x ?? 0),
      z = this.overview ? 0 : (own?.z ?? 0);
    const alpha = this.initialized ? 1 - Math.exp(-dt * 8) : 1;
    this.target.x += (x - this.target.x) * alpha;
    this.target.z += (z - this.target.z) * alpha;
    this.target.y = 0.6;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * 34,
      31,
      this.target.z + Math.cos(this.yaw) * 34,
    );
    this.camera.lookAt(this.target);
    this.initialized = true;
    this.projection();
  }
  private projection(): void {
    const height = this.overview ? 24 : this.zoom;
    this.camera.left = -height * this.aspect;
    this.camera.right = height * this.aspect;
    this.camera.top = height;
    this.camera.bottom = -height;
    this.camera.updateProjectionMatrix();
  }
}
