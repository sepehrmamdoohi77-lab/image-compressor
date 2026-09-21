// Rounds, objectives, and scoring. Pure scoring helpers are unit-tested.
import { ROUNDS, SCORING } from '../data/config';

export function multikillBonus(chain: number): number {
  const table = SCORING.multikillBonus;
  return table[Math.min(chain, table.length - 1)] ?? 0;
}

export function roundClearBonus(roundIndex: number): number {
  const table = SCORING.roundClearBonus;
  return table[Math.min(roundIndex + 1, table.length - 1)] ?? 0;
}

export class ProgressionSystem {
  roundIndex = 0;
  score = 0;
  kills = 0;
  headshots = 0;
  shotsFired = 0;
  shotsHit = 0;
  grenadeKills = 0;
  roundKills = 0;
  roundTotal = 0;
  roundStartScore = 0;
  roundDamageTaken = 0;
  roundShots = 0;
  roundHits = 0;
  private lastKillAt = -Infinity;
  private killChain = 0;
  lastBonus = 0;
  lastBonusLabel = '';

  get roundDef() {
    return ROUNDS[this.roundIndex];
  }

  get totalRounds(): number {
    return ROUNDS.length;
  }

  get isFinalRound(): boolean {
    return this.roundIndex >= ROUNDS.length - 1;
  }

  get accuracy(): number {
    return this.shotsFired > 0 ? this.shotsHit / this.shotsFired : 0;
  }

  startRun(): void {
    this.roundIndex = 0;
    this.score = 0;
    this.kills = 0;
    this.headshots = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.grenadeKills = 0;
    this.beginRound(0);
  }

  beginRound(index: number): void {
    this.roundIndex = index;
    this.roundKills = 0;
    this.roundTotal = ROUNDS[index]?.enemies.length ?? 0;
    this.roundStartScore = this.score;
    this.roundDamageTaken = 0;
    this.roundShots = 0;
    this.roundHits = 0;
    this.killChain = 0;
    this.lastBonus = 0;
    this.lastBonusLabel = '';
  }

  onShot(hit: boolean): void {
    this.shotsFired++;
    this.roundShots++;
    if (hit) {
      this.shotsHit++;
      this.roundHits++;
    }
  }

  onEnemyKilled(scoreValue: number, headshot: boolean, cause: 'bullet' | 'grenade', now: number): number {
    this.kills++;
    this.roundKills++;
    let gained = scoreValue;
    if (headshot) {
      this.headshots++;
      gained += SCORING.headshotBonus;
    }
    if (cause === 'grenade') {
      this.grenadeKills++;
      gained += SCORING.grenadeBonus;
    }
    // Multikill chain.
    if (now - this.lastKillAt <= SCORING.multikillWindow) this.killChain++;
    else this.killChain = 1;
    this.lastKillAt = now;
    const mk = multikillBonus(this.killChain);
    gained += mk;
    this.lastBonus = mk;
    this.lastBonusLabel = this.killChain >= 2 ? `MULTI-KILL x${this.killChain}` : '';
    this.score += gained;
    return gained;
  }

  onPlayerDamaged(amount: number): void {
    this.roundDamageTaken += amount;
  }

  /** End-of-round bonuses. Returns total bonus gained. */
  completeRound(): number {
    let bonus = roundClearBonus(this.roundIndex);
    const acc = this.roundShots > 0 ? this.roundHits / this.roundShots : 0;
    if (acc >= SCORING.accuracyBonusThreshold && this.roundShots >= 10) bonus += SCORING.accuracyBonus;
    if (this.roundDamageTaken <= 0) bonus += SCORING.noDamageBonus;
    this.score += bonus;
    return bonus;
  }

  advance(): boolean {
    if (this.isFinalRound) return false;
    this.beginRound(this.roundIndex + 1);
    return true;
  }

  reset(): void {
    this.startRun();
  }
}
