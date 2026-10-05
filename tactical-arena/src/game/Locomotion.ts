import * as THREE from 'three';

const up = new THREE.Vector3(0, 1, 0);
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Analytic two-bone IK. Degenerate/unreachable targets stay finite and keep bone lengths. */
export function solveTwoBone(
  origin: THREE.Vector3,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  upper: number,
  lower: number,
  joint = new THREE.Vector3(),
  end = new THREE.Vector3(),
): { joint: THREE.Vector3; end: THREE.Vector3 } {
  const direction = target.clone().sub(origin);
  const rawDistance = direction.length();
  if (rawDistance < 1e-8) direction.set(0, -1, 0);
  else direction.multiplyScalar(1 / rawDistance);
  const distance = THREE.MathUtils.clamp(
    rawDistance,
    Math.abs(upper - lower) + 1e-5,
    upper + lower - 1e-5,
  );
  const bend = pole.clone().addScaledVector(direction, -pole.dot(direction));
  if (bend.lengthSq() < 1e-8) {
    bend.copy(Math.abs(direction.y) < 0.9 ? up : new THREE.Vector3(0, 0, 1));
    bend.addScaledVector(direction, -bend.dot(direction));
  }
  bend.normalize();
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  joint.copy(origin).addScaledVector(direction, along).addScaledVector(bend, height);
  end.copy(origin).addScaledVector(direction, distance);
  return { joint, end };
}

export interface FootPose {
  position: THREE.Vector3;
  planted: boolean;
  yaw: number;
}
interface Foot extends FootPose {
  anchor: THREE.Vector3;
  start: THREE.Vector3;
  finish: THREE.Vector3;
  swinging: boolean;
  settle: number;
  launchPhase: number;
}

/** Distance-driven gait with world-space stance anchors; feet do not skate with the torso. */
export class FootPlanner {
  readonly feet: [Foot, Foot];
  phase = 0;
  private previous = new THREE.Vector3();
  private initialized = false;
  private time = 0;
  private wasMoving = false;
  private direction = new THREE.Vector3(0, 0, 1);
  constructor() {
    const foot = (): Foot => ({
      position: new THREE.Vector3(),
      anchor: new THREE.Vector3(),
      start: new THREE.Vector3(),
      finish: new THREE.Vector3(),
      planted: true,
      yaw: 0,
      swinging: false,
      settle: 1,
      launchPhase: 0.5,
    });
    this.feet = [foot(), foot()];
  }
  reset(position: THREE.Vector3, yaw: number): void {
    this.previous.copy(position);
    this.phase = 0;
    this.initialized = true;
    this.wasMoving = false;
    this.feet.forEach((foot, i) => {
      const rest = this.rest(position, yaw, i);
      foot.position.copy(rest);
      foot.anchor.copy(rest);
      foot.start.copy(rest);
      foot.finish.copy(rest);
      foot.swinging = false;
      foot.settle = 1;
      foot.planted = true;
      foot.yaw = yaw;
    });
  }
  private rest(position: THREE.Vector3, yaw: number, side: number): THREE.Vector3 {
    const lateral = side === 0 ? -0.145 : 0.145;
    return new THREE.Vector3(
      position.x + Math.cos(yaw) * lateral,
      0.105,
      position.z - Math.sin(yaw) * lateral,
    );
  }
  update(
    position: THREE.Vector3,
    yaw: number,
    dt: number,
    crouch: number,
    sprint: boolean,
  ): [FootPose, FootPose] {
    if (!this.initialized) this.reset(position, yaw);
    this.time += dt;
    const delta = position.clone().sub(this.previous);
    delta.y = 0;
    const distance = delta.length();
    // A respawn/network discontinuity must not stretch a planted leg across the map.
    if (distance > 1.1) {
      this.reset(position, yaw);
      return this.feet;
    }
    const speed = distance / Math.max(0.001, dt),
      moving = speed > 0.12;
    const stride = crouch > 0.45 ? 1 : sprint ? 2 : 1.5;
    if (moving) {
      if (!this.wasMoving) this.phase = Math.floor(this.phase) + 0.3;
      this.direction.copy(delta).normalize();
      this.phase += distance / stride;
    }
    for (let i = 0; i < 2; i++) {
      const foot = this.feet[i]!,
        phase = (this.phase + i * 0.5) % 1;
      const resting = this.rest(position, yaw, i);
      const swing = phase >= 0.5;
      if (moving) {
        if (swing && !foot.swinging) {
          foot.start.copy(foot.position);
          foot.finish.copy(resting).addScaledVector(this.direction, stride * (1 - phase + 0.25));
          foot.launchPhase = phase;
          foot.swinging = true;
        }
        if (!swing && foot.swinging) {
          foot.anchor.copy(foot.finish);
          foot.position.copy(foot.anchor);
          foot.swinging = false;
        }
        if (foot.swinging) {
          const fraction = THREE.MathUtils.clamp(
            (phase - foot.launchPhase) / Math.max(0.01, 1 - foot.launchPhase),
            0,
            1,
          );
          foot.position.lerpVectors(foot.start, foot.finish, smooth(fraction));
          foot.position.y =
            0.105 + Math.sin(fraction * Math.PI) * (crouch > 0.45 ? 0.105 : sprint ? 0.24 : 0.16);
          foot.planted = false;
        } else {
          foot.position.copy(foot.anchor);
          foot.planted = true;
        }
        foot.settle = 1;
      } else {
        if (
          this.wasMoving ||
          foot.swinging ||
          (!foot.swinging && foot.settle >= 1 && foot.position.distanceTo(resting) > 0.4)
        ) {
          foot.start.copy(foot.position);
          foot.finish.copy(resting);
          foot.settle = 0;
          foot.swinging = false;
        }
        if (foot.settle < 1) {
          foot.settle = Math.min(1, foot.settle + dt / 0.16);
          foot.position.lerpVectors(foot.start, foot.finish, smooth(foot.settle));
          foot.position.y += Math.sin(foot.settle * Math.PI) * 0.07;
          foot.anchor.copy(foot.finish);
          foot.planted = foot.settle === 1;
        } else {
          foot.position.copy(foot.anchor);
          foot.planted = true;
        }
      }
      const angle = Math.atan2(Math.sin(yaw - foot.yaw), Math.cos(yaw - foot.yaw));
      foot.yaw += angle * (1 - Math.exp(-dt * 14));
    }
    this.wasMoving = moving;
    this.previous.copy(position);
    return this.feet;
  }
}
