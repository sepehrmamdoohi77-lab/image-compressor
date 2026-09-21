// Tactical enemy AI: perception (vision + hearing), decaying memory, squad
// sharing, finite-state tactics (cover / flank / retreat / search), and
// aim with realistic error. One controller per enemy; staggered updates.
import { AI } from '../data/config';
import type { Enemy, EnemyStateName } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import { cellToWorld, worldToCell, type Level } from '../world/Level';
import { findPath, smoothPath, nearestOpenCell } from '../world/Navigation';
import { eyeHeight, type CombatSystem } from '../systems/CombatSystem';
import type { CoverSystem } from './CoverSystem';
import type { SquadAwareness } from './SquadAwareness';
import type { AudioManager } from '../audio/AudioManager';
import { angleLerp, clamp } from '../utils/math';

export interface AIContext {
  level: Level;
  player: Player;
  enemies: Enemy[];
  cover: CoverSystem;
  squad: SquadAwareness;
  combat: CombatSystem;
  audio: AudioManager;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class AIController {
  private lastAlertAt = -Infinity;
  private stuckCount = 0;

  constructor(private enemy: Enemy, private ctx: AIContext) {}

  /** Called by Game when this enemy takes damage. */
  notifyDamaged(amount: number, now: number): void {
    const e = this.enemy;
    const ai = e.ai;
    if (!e.alive) return;
    // Damage reveals approximate attacker position (never exact magic).
    const p = this.ctx.player;
    ai.lastSeenPos.set(
      p.pos.x + (Math.random() - 0.5) * 5,
      0,
      p.pos.z + (Math.random() - 0.5) * 5,
    );
    ai.lastSeenAt = now;
    ai.confidence = Math.max(ai.confidence, 0.55);
    ai.suspicion = 1;
    if (amount >= 22 && now - ai.stateTime > 0.4) {
      this.setState('HitReaction', now);
      ai.hideUntil = now + 0.35; // reuse as react-until timer
    }
  }

  update(dt: number, now: number): void {
    const e = this.enemy;
    if (!e.alive) {
      e.speed = 0;
      e.firing = false;
      e.updateVisual(dt);
      return;
    }
    e.weapon.update(now, dt);
    this.perceive(now);
    if (now >= e.ai.decisionAt) {
      e.ai.decisionAt = now + AI.decisionInterval * (0.8 + Math.random() * 0.4);
      this.decide(now);
    }
    this.act(dt, now);
    e.updateVisual(dt);
  }

  // --- perception ---------------------------------------------------------------
  private perceive(now: number): void {
    const e = this.enemy;
    const ai = e.ai;
    const p = this.ctx.player;
    if (now < ai.perceptionAt) return;
    ai.perceptionAt = now + AI.perceptionInterval * (0.7 + Math.random() * 0.6);

    // Vision.
    if (p.alive) {
      const dx = p.pos.x - e.pos.x;
      const dz = p.pos.z - e.pos.z;
      const dist = Math.hypot(dx, dz);
      const def = e.def;
      const inRange = dist < def.visionRange;
      const angDiff = Math.abs(wrapAngle(Math.atan2(dx, dz) - e.yaw));
      const inFov = angDiff < (def.visionFovDeg * Math.PI) / 360 || dist < 3.5;
      if (inRange && inFov) {
        const eyeH = eyeHeight(!!ai.crouched);
        const pEye = eyeHeight(p.crouched);
        const blocked = this.ctx.level.segmentBlocked(e.pos.x, eyeH, e.pos.z, p.pos.x, pEye, p.pos.z);
        if (!blocked) {
          const newly = ai.confidence < 0.3;
          ai.lastSeenPos.set(p.pos.x, 0, p.pos.z);
          ai.lastSeenAt = now;
          ai.confidence = 1;
          ai.suspicion = 0;
          if (newly) {
            ai.reactionAt = now + def.reactionTime * (0.8 + Math.random() * 0.5);
            if (now - this.lastAlertAt > 6 && dist < 30) {
              this.lastAlertAt = now;
              this.ctx.audio.playEnemyAlert(clamp(dist / 40, 0, 1));
            }
          }
          this.ctx.squad.report(p.pos.x, p.pos.z, 1, now);
        }
      }
    }

    // Memory decay.
    ai.confidence = Math.max(0, 1 - (now - ai.lastSeenAt) / AI.memoryDuration);
    ai.suspicion = Math.max(0, ai.suspicion - AI.perceptionInterval / AI.suspicionDuration);

    // Hearing.
    const noises = this.ctx.squad.noisesSince(ai.lastHeardAt, e.pos.x, e.pos.z, e.def.hearingRadius);
    ai.lastHeardAt = now;
    for (const n of noises) {
      ai.suspicion = 1;
      ai.suspicionPos.set(n.x + (Math.random() - 0.5) * 2, 0, n.z + (Math.random() - 0.5) * 2);
      if (e.state === 'Idle' || e.state === 'Patrol') this.setState('Suspicious', now);
      // Explosions and close shots also raise combat awareness.
      if ((n.kind === 'explosion' || n.kind === 'shot') && ai.confidence < 0.3) {
        ai.lastSeenPos.copy(ai.suspicionPos);
        ai.lastSeenAt = now - AI.memoryDuration * 0.55; // weak memory
        ai.confidence = AI.hearingMemoryConf;
      }
    }

    // Squad sharing (approximate, decaying).
    const sqConf = this.ctx.squad.confidence(now);
    if (ai.confidence < 0.25 && sqConf > 0.35 && (e.state === 'Idle' || e.state === 'Patrol')) {
      ai.suspicion = Math.max(ai.suspicion, sqConf);
      ai.suspicionPos.copy(this.ctx.squad.sharedPos);
      this.setState('Suspicious', now);
    }
  }

  // --- decisions ------------------------------------------------------------------
  private setState(s: EnemyStateName, now: number): void {
    const e = this.enemy;
    if (e.state === s) return;
    // Release cover claim when leaving cover states.
    if ((e.state === 'TakingCover' || e.state === 'InCover') && s !== 'TakingCover' && s !== 'InCover') {
      this.ctx.cover.releaseByEnemy(e.id);
      e.ai.coverId = -1;
    }
    e.state = s;
    e.ai.stateTime = now;
    e.ai.crouched = false;
  }

  private reacted(now: number): boolean {
    return now >= this.enemy.ai.reactionAt;
  }

  private decide(now: number): void {
    const e = this.enemy;
    const ai = e.ai;
    const p = this.ctx.player;
    const conf = ai.confidence;
    const seenAndReady = conf > 0.55 && this.reacted(now) && p.alive;

    switch (e.state) {
      case 'Dead':
        return;
      case 'HitReaction':
        if (now > ai.hideUntil) this.setState(conf > 0.3 ? 'Engaging' : 'Suspicious', now);
        return;
      case 'Idle':
        this.setState('Patrol', now);
        return;
      case 'Patrol': {
        if (seenAndReady) {
          this.setState('Engaging', now);
          return;
        }
        if (ai.suspicion > 0.5) {
          this.setState('Suspicious', now);
          return;
        }
        if (!ai.hasPatrolTarget) this.pickPatrolTarget(now);
        return;
      }
      case 'Suspicious': {
        if (seenAndReady) {
          this.setState('Engaging', now);
          return;
        }
        if (now - ai.stateTime > 1.1) {
          if (conf > 0.25 || ai.suspicion > 0.35) {
            const t = conf > ai.suspicion ? ai.lastSeenPos : ai.suspicionPos;
            if (this.requestPathTo(t.x, t.z, now, true)) {
              ai.searchIndex = 0;
              this.setState('Investigating', now);
            } else {
              this.setState('Patrol', now);
              ai.hasPatrolTarget = false;
            }
          } else {
            this.setState('Patrol', now);
            ai.hasPatrolTarget = false;
          }
        }
        return;
      }
      case 'Investigating': {
        if (seenAndReady) {
          this.setState('Engaging', now);
          return;
        }
        if (this.pathDone()) {
          ai.searchIndex = 0;
          this.setState('Searching', now);
        }
        return;
      }
      case 'Searching': {
        if (seenAndReady) {
          this.setState('Engaging', now);
          return;
        }
        if (this.pathDone()) {
          ai.searchIndex++;
          if (ai.searchIndex >= 4 || (conf <= 0.05 && ai.suspicion <= 0.1)) {
            ai.suspicion = 0;
            this.setState('Patrol', now);
            ai.hasPatrolTarget = false;
          } else {
            this.pickSearchPoint(now);
          }
        }
        return;
      }
      case 'Engaging':
        this.decideCombat(now);
        return;
      case 'TakingCover': {
        if (!p.alive) {
          this.setState('Searching', now);
          return;
        }
        const distP = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
        if (distP < 4 && conf > 0.5) {
          this.setState('Engaging', now); // too close — fight
          return;
        }
        if (this.pathDone() || now - ai.stateTime > 7) {
          ai.hideUntil = now + 0.6 + Math.random() * 0.8;
          ai.exposeUntil = 0;
          this.setState('InCover', now);
        }
        return;
      }
      case 'InCover': {
        if (!p.alive || conf < 0.15) {
          this.setState('Searching', now);
          return;
        }
        const distP = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
        if (distP < 5) {
          this.setState('Engaging', now);
          return;
        }
        // Re-evaluate cover if it no longer protects (flanked) or after a while.
        if (now - ai.stateTime > 9 + Math.random() * 4) {
          if (this.tryTakeCover(now, p.pos.x, p.pos.z)) return;
          this.setState('Engaging', now);
        }
        return;
      }
      case 'Flanking': {
        if (seenAndReady) {
          const distP = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
          if (this.pathDone() || (distP > e.def.preferredMin && distP < e.def.preferredMax)) {
            this.setState('Engaging', now);
            return;
          }
        }
        if (this.pathDone() || now - ai.stateTime > 10) this.setState('Engaging', now);
        return;
      }
      case 'Retreating': {
        if (this.pathDone() || now - ai.stateTime > 7) {
          if (e.weapon.isEmpty && e.weapon.reserveAmmo > 0) {
            e.weapon.startReload(now);
            this.setState('Reloading', now);
          } else {
            ai.hideUntil = now + 1;
            this.setState('InCover', now);
          }
        }
        return;
      }
      case 'Reloading': {
        if (!e.weapon.reloading) this.setState(p.alive && conf > 0.2 ? 'Engaging' : 'Searching', now);
        return;
      }
    }
  }

  private decideCombat(now: number): void {
    const e = this.enemy;
    const ai = e.ai;
    const p = this.ctx.player;
    const conf = ai.confidence;

    if (!p.alive || (conf < 0.2 && ai.suspicion < 0.3)) {
      this.setState('Searching', now);
      return;
    }
    // Reload when empty.
    if (e.weapon.isEmpty) {
      if (e.weapon.reserveAmmo > 0) {
        e.weapon.startReload(now);
        this.setState('Reloading', now);
      }
      return;
    }
    // Tactical reload mid-fight when safe-ish.
    if (e.weapon.magAmmo <= e.weapon.def.magSize * 0.25 && e.weapon.reserveAmmo > 0) {
      const distP = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
      if (distP > 14 || e.state === 'InCover') {
        e.weapon.startReload(now);
        this.setState('Reloading', now);
        return;
      }
    }

    const distP = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
    const aggression = clamp(e.def.aggression * e.aggressionMult, 0, 1);
    const healthFrac = e.health / e.maxHealth;
    const recentlyHurt = now - ai.lastDamageAt < 3;

    // Retreat when badly hurt and not aggressive.
    if (healthFrac < AI.retreatHealthFrac && aggression < 0.65 && Math.random() < 0.5) {
      if (this.tryRetreat(now, p.pos.x, p.pos.z)) return;
    }

    // Range management.
    if (distP < e.def.preferredMin * 0.75) {
      if (aggression > 0.72) return; // assault archetype pushes in
      // Back off to cover.
      if (this.tryTakeCover(now, p.pos.x, p.pos.z)) return;
      return;
    }
    if (distP > e.def.preferredMax * 1.25) {
      // Too far: advance (direct path toward player, repathed periodically).
      this.requestPathTo(p.pos.x, p.pos.z, now, false);
      if (aggression > 0.5 && Math.random() < 0.4) {
        this.tryFlank(now, p.pos.x, p.pos.z);
      }
      return;
    }

    // In preferred band: choose posture.
    const roll = Math.random();
    if (recentlyHurt && roll < 0.55) {
      if (this.tryTakeCover(now, p.pos.x, p.pos.z)) return;
    } else if (roll < 0.3 + aggression * 0.35) {
      if (this.tryFlank(now, p.pos.x, p.pos.z)) return;
    } else if (roll < 0.5 && this.tryTakeCover(now, p.pos.x, p.pos.z)) {
      return;
    }
    // Otherwise hold + strafe (handled in act).
    ai.path.length = 0;
    ai.strafeAt = now + 1 + Math.random() * 2;
    ai.strafeDir = Math.random() < 0.5 ? -1 : 1;
  }

  // --- actions ---------------------------------------------------------------------
  private act(dt: number, now: number): void {
    const e = this.enemy;
    const ai = e.ai;
    const p = this.ctx.player;
    const def = e.def;
    let moveSpeed = 0;
    let faceX: number | null = null;
    let faceZ: number | null = null;
    e.aiming = false;
    e.firing = false;

    switch (e.state) {
      case 'Idle':
        break;
      case 'Patrol': {
        if (ai.hasPatrolTarget) {
          if (this.followPath(dt, def.speed * 0.45)) {
            ai.hasPatrolTarget = false;
            ai.stateTime = now; // idle pause
          }
          moveSpeed = def.speed * 0.45;
        } else if (now - ai.stateTime > 1.6 + (e.id % 3)) {
          this.pickPatrolTarget(now);
        }
        break;
      }
      case 'Suspicious':
        faceX = ai.suspicionPos.x;
        faceZ = ai.suspicionPos.z;
        e.aiming = true;
        break;
      case 'Investigating':
        if (!this.followPath(dt, def.speed * 0.7)) moveSpeed = def.speed * 0.7;
        faceX = ai.path.length > ai.pathIndex ? ai.path[ai.pathIndex].x : ai.lastSeenPos.x;
        faceZ = ai.path.length > ai.pathIndex ? ai.path[ai.pathIndex].z : ai.lastSeenPos.z;
        e.aiming = true;
        break;
      case 'Searching': {
        if (!this.pathDone()) {
          if (!this.followPath(dt, def.speed * 0.6)) moveSpeed = def.speed * 0.6;
          e.aiming = true;
        } else {
          // Look around while deciding next search point.
          const look = now * 1.5 + e.id;
          faceX = e.pos.x + Math.sin(look) * 5;
          faceZ = e.pos.z + Math.cos(look * 0.7) * 5;
          e.aiming = true;
        }
        break;
      }
      case 'Engaging': {
        faceX = ai.confidence > 0.2 ? ai.lastSeenPos.x : p.pos.x;
        faceZ = ai.confidence > 0.2 ? ai.lastSeenPos.z : p.pos.z;
        e.aiming = true;
        // Advance toward player if path active (out-of-range case).
        if (ai.path.length > ai.pathIndex) {
          this.followPath(dt, def.speed);
          moveSpeed = def.speed;
        } else if (now < ai.strafeAt) {
          // Combat strafe perpendicular to threat.
          const dx = e.pos.x - p.pos.x;
          const dz = e.pos.z - p.pos.z;
          const d = Math.max(0.001, Math.hypot(dx, dz));
          const sx = (-dz / d) * ai.strafeDir;
          const sz = (dx / d) * ai.strafeDir;
          this.moveDir(dt, sx, sz, def.speed * 0.45);
          moveSpeed = def.speed * 0.45;
        }
        this.tryShoot(now);
        break;
      }
      case 'TakingCover': {
        this.followPath(dt, def.speed * 1.05);
        moveSpeed = def.speed * 1.05;
        e.aiming = true;
        break;
      }
      case 'InCover': {
        faceX = p.pos.x;
        faceZ = p.pos.z;
        e.aiming = true;
        // Pop-up rhythm: hide, then expose to fire.
        if (ai.exposeUntil > now) {
          ai.crouched = false;
          this.tryShoot(now);
        } else if (now > ai.hideUntil) {
          ai.exposeUntil = now + 1.4 + Math.random() * 1.4;
          ai.hideUntil = ai.exposeUntil + 1.2 + Math.random() * 1.6;
          ai.crouched = false;
        } else {
          ai.crouched = true;
        }
        break;
      }
      case 'Flanking': {
        this.followPath(dt, def.speed * 0.95);
        moveSpeed = def.speed * 0.95;
        faceX = ai.lastSeenPos.x;
        faceZ = ai.lastSeenPos.z;
        e.aiming = true;
        this.tryShoot(now); // engage on the move, less accurate (handled in aim error)
        break;
      }
      case 'Retreating': {
        this.followPath(dt, def.speed * 1.1);
        moveSpeed = def.speed * 1.1;
        faceX = p.pos.x; // back away facing threat
        faceZ = p.pos.z;
        e.aiming = true;
        break;
      }
      case 'Reloading': {
        faceX = ai.lastSeenPos.x;
        faceZ = ai.lastSeenPos.z;
        e.aiming = false;
        if (e.ai.coverId >= 0) ai.crouched = true;
        // Small sidestep while reloading in the open.
        if (e.ai.coverId < 0) {
          const dx = e.pos.x - p.pos.x;
          const dz = e.pos.z - p.pos.z;
          const d = Math.max(0.001, Math.hypot(dx, dz));
          this.moveDir(dt, -dz / d, dx / d, def.speed * 0.3);
          moveSpeed = def.speed * 0.3;
        }
        break;
      }
      case 'HitReaction':
        moveSpeed = 0;
        faceX = ai.lastSeenPos.x;
        faceZ = ai.lastSeenPos.z;
        break;
      case 'Dead':
        return;
    }

    if (faceX !== null && faceZ !== null) {
      const targetYaw = Math.atan2(faceX - e.pos.x, faceZ - e.pos.z);
      e.yaw = angleLerp(e.yaw, targetYaw, Math.min(1, dt * 9));
    }
    // Hit stagger slows movement.
    if (e.state === 'HitReaction') moveSpeed *= 0.25;
    e.speed = moveSpeed;
    this.applySeparation(dt);
    this.ctx.level.collideCircle(e.pos, e.radius);
  }

  // --- shooting ----------------------------------------------------------------------
  private tryShoot(now: number): void {
    const e = this.enemy;
    const ai = e.ai;
    const p = this.ctx.player;
    if (!p.alive || ai.confidence < 0.35 || !this.reacted(now)) return;
    const distP = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
    if (distP > e.weapon.def.range * 0.95 || distP < 1.2) return;
    // Must face the target (prevents shooting backwards while moving).
    const angDiff = Math.abs(wrapAngle(Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z) - e.yaw));
    if (angDiff > 0.5) return;
    // Line of fire check (muzzle height to player chest).
    const mzlY = ai.crouched ? 1.0 : 1.35;
    const chestY = p.crouched ? 0.75 : 1.2;
    if (this.ctx.level.segmentBlocked(e.pos.x, mzlY, e.pos.z, p.pos.x, chestY, p.pos.z)) return;

    // Burst discipline.
    if (ai.burstLeft <= 0) {
      if (now < ai.nextBurstAt) return;
      ai.burstLeft = e.def.burstSize;
    }
    // Aim error model: archetype accuracy, distance, target/self movement, reaction.
    const acc = clamp(e.def.accuracy * e.accuracyMult, 0.05, 0.95);
    let err = AI.aimErrorBase * (1.35 - acc);
    err += (distP / Math.max(1, e.weapon.def.range)) * 0.035;
    if (p.moving) err += AI.aimErrorMoveTarget * clamp(p.speed / 4.6, 0, 1);
    if (e.speed > 0.5) err += AI.aimErrorMoveSelf;
    if (p.crouched) err += 0.012;
    if (now - ai.reactionAt < 0.6) err *= 1.6;
    const res = this.ctx.combat.enemyFire(e, p, err, now);
    if (res.fired) {
      e.firing = true;
      ai.burstLeft--;
      if (ai.burstLeft <= 0) {
        ai.nextBurstAt = now + e.def.burstPause * (0.8 + Math.random() * 0.5);
      }
    }
  }

  // --- movement helpers ------------------------------------------------------------------
  private requestPathTo(x: number, z: number, now: number, force: boolean): boolean {
    const e = this.enemy;
    const ai = e.ai;
    if (!force && now < ai.repathAt && ai.path.length > ai.pathIndex) return true;
    ai.repathAt = now + AI.moveRepathInterval * (0.8 + Math.random() * 0.4);
    const level = this.ctx.level;
    const size = 44;
    const start = { cx: worldToCell(e.pos.x), cz: worldToCell(e.pos.z) };
    let goal = { cx: worldToCell(x), cz: worldToCell(z) };
    const snapped = nearestOpenCell(level.grid, size, goal.cx, goal.cz, 5);
    if (!snapped) return false;
    goal = snapped;
    const raw = findPath(level.grid, size, start, goal, { maxIterations: 2500 });
    if (!raw || raw.length === 0) return false;
    const smooth = smoothPath(level.grid, size, raw);
    ai.path.length = 0;
    for (let i = 1; i < smooth.length; i++) {
      ai.path.push({ x: cellToWorld(smooth[i].cx), z: cellToWorld(smooth[i].cz) });
    }
    // Always include exact goal for arrival checks.
    ai.path.push({ x: cellToWorld(goal.cx), z: cellToWorld(goal.cz) });
    ai.pathIndex = 0;
    ai.stuckCheckAt = now + 1.2;
    ai.stuckX = e.pos.x;
    ai.stuckZ = e.pos.z;
    this.stuckCount = 0;
    return true;
  }

  private pathDone(): boolean {
    const ai = this.enemy.ai;
    return ai.pathIndex >= ai.path.length;
  }

  /** Returns true when arrived / no path. */
  private followPath(dt: number, speed: number): boolean {
    const e = this.enemy;
    const ai = e.ai;
    if (this.pathDone()) return true;
    const wp = ai.path[ai.pathIndex];
    const dx = wp.x - e.pos.x;
    const dz = wp.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.45) {
      ai.pathIndex++;
      return this.pathDone();
    }
    e.pos.x += (dx / d) * speed * dt;
    e.pos.z += (dz / d) * speed * dt;
    e.yaw = angleLerp(e.yaw, Math.atan2(dx, dz), Math.min(1, dt * 7));
    // Stuck recovery.
    const now = performance.now() / 1000;
    if (now > ai.stuckCheckAt) {
      const moved = Math.hypot(e.pos.x - ai.stuckX, e.pos.z - ai.stuckZ);
      ai.stuckCheckAt = now + 1.2;
      ai.stuckX = e.pos.x;
      ai.stuckZ = e.pos.z;
      if (moved < 0.2 && d > 1) {
        this.stuckCount++;
        ai.repathAt = 0; // force repath next request
        if (this.stuckCount > 2) {
          ai.path.length = 0; // give up; decide() picks a new plan
          this.stuckCount = 0;
          return true;
        }
      } else {
        this.stuckCount = 0;
      }
    }
    return false;
  }

  private moveDir(dt: number, nx: number, nz: number, speed: number): void {
    const e = this.enemy;
    e.pos.x += nx * speed * dt;
    e.pos.z += nz * speed * dt;
  }

  private applySeparation(dt: number): void {
    const e = this.enemy;
    for (const o of this.ctx.enemies) {
      if (o === e || !o.alive) continue;
      const dx = e.pos.x - o.pos.x;
      const dz = e.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      const min = AI.separationRadius;
      if (d2 > 1e-6 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = ((min - d) / min) * 2.2 * dt;
        e.pos.x += (dx / d) * push;
        e.pos.z += (dz / d) * push;
      }
    }
  }

  // --- tactical pickers ---------------------------------------------------------------------
  private pickPatrolTarget(now: number): void {
    const e = this.enemy;
    const ai = e.ai;
    for (let tries = 0; tries < 6; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 10;
      const x = ai.homeX + Math.cos(a) * r;
      const z = ai.homeZ + Math.sin(a) * r;
      if (this.requestPathTo(x, z, now, true)) {
        ai.hasPatrolTarget = true;
        return;
      }
    }
    ai.hasPatrolTarget = false;
  }

  private pickSearchPoint(now: number): void {
    const e = this.enemy;
    const ai = e.ai;
    const base = ai.confidence > 0.1 ? ai.lastSeenPos : ai.suspicionPos;
    for (let tries = 0; tries < 6; tries++) {
      const a = (ai.searchIndex / 4) * Math.PI * 2 + Math.random() * 0.8;
      const r = 2.5 + Math.random() * 4;
      if (this.requestPathTo(base.x + Math.cos(a) * r, base.z + Math.sin(a) * r, now, true)) return;
    }
  }

  private tryTakeCover(now: number, tx: number, tz: number): boolean {
    const e = this.enemy;
    const ai = e.ai;
    const idx = this.ctx.cover.findCover(e.pos.x, e.pos.z, tx, tz, e.id, e.def.preferredMin, e.def.preferredMax);
    if (idx < 0) return false;
    const cp = this.ctx.cover.points[idx];
    if (this.requestPathTo(cp.x, cp.z, now, true)) {
      this.ctx.cover.claim(idx, e.id);
      ai.coverId = idx;
      this.setState('TakingCover', now);
      return true;
    }
    return false;
  }

  private tryRetreat(now: number, tx: number, tz: number): boolean {
    const e = this.enemy;
    const ai = e.ai;
    // Prefer cover far from the threat.
    const pts = this.ctx.cover.points;
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const cp = pts[i];
      const dE = Math.hypot(cp.x - e.pos.x, cp.z - e.pos.z);
      const dT = Math.hypot(cp.x - tx, cp.z - tz);
      if (dE > AI.coverSearchRadius || dT < 9) continue;
      if (this.ctx.cover.isClaimedByOther(i, e.id)) continue;
      const s = dT * 1.6 - dE + Math.random() * 4;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best < 0) return false;
    const cp = pts[best];
    if (this.requestPathTo(cp.x, cp.z, now, true)) {
      this.ctx.cover.claim(best, e.id);
      ai.coverId = best;
      this.setState('Retreating', now);
      return true;
    }
    return false;
  }

  private tryFlank(now: number, tx: number, tz: number): boolean {
    const e = this.enemy;
    const toThreat = Math.atan2(tx - e.pos.x, tz - e.pos.z);
    const side = Math.random() < 0.5 ? 1 : -1;
    const flankA = (AI.flankAngleDeg * Math.PI) / 180;
    const dist = clamp((e.def.preferredMin + e.def.preferredMax) / 2, 7, 18);
    const fx = tx - Math.sin(toThreat + side * flankA) * dist;
    const fz = tz - Math.cos(toThreat + side * flankA) * dist;
    if (this.requestPathTo(fx, fz, now, true)) {
      this.setState('Flanking', now);
      return true;
    }
    return false;
  }
}
