// Centralized damage pipeline: Weapon -> HitDetection -> Zone -> Falloff ->
// Armor -> Health. Pure functions (unit-tested) + an application helper.
import { DAMAGE, type WeaponDef, type HitZone } from '../data/config';
import { clamp } from '../utils/math';

export interface DamageInput {
  baseDamage: number;
  headshotMult: number;
  zone: HitZone;
  distance: number;
  falloffStart: number;
  falloffEnd: number;
  minDamageMult: number;
  armor: number;
  armorDamageMult: number;
}

export interface DamageResult {
  healthDamage: number;
  armorDamage: number;
  rawDamage: number;
  mitigated: number;
}

/** Distance falloff multiplier: 1 until start, linear to min at end. */
export function falloffMultiplier(distance: number, start: number, end: number, minMult: number): number {
  if (distance <= start) return 1;
  if (distance >= end) return minMult;
  const t = (distance - start) / Math.max(1e-6, end - start);
  return 1 + (minMult - 1) * t;
}

/** Armor mitigation fraction 0..1. */
export function armorReduction(armor: number): number {
  if (armor <= 0) return 0;
  return clamp(armor / (armor + DAMAGE.armorK), 0, 0.75);
}

export function computeDamage(input: DamageInput): DamageResult {
  const zoneMult = input.zone === 'HEAD' ? input.headshotMult : DAMAGE.zoneMult[input.zone];
  const fall = falloffMultiplier(input.distance, input.falloffStart, input.falloffEnd, input.minDamageMult);
  const raw = Math.max(0, input.baseDamage * zoneMult * fall);
  const reduction = armorReduction(input.armor);
  const mitigated = raw * reduction;
  const healthDamage = Math.max(1, Math.round(raw - mitigated));
  const armorDamage = Math.max(0, Math.round(mitigated * DAMAGE.armorAbsorb * input.armorDamageMult + raw * 0.12 * input.armorDamageMult));
  return { healthDamage, armorDamage, rawDamage: raw, mitigated };
}

/** Classify hit zone from the height of the impact on a humanoid target. */
export function zoneFromHeight(hitY: number, targetFeetY: number, targetHeight: number, lateralOffset: number): HitZone {
  const h = clamp((hitY - targetFeetY) / Math.max(0.5, targetHeight), 0, 1.2);
  if (h >= 0.86) return 'HEAD';
  if (h >= 0.52) {
    // Wide lateral hits at torso height clip arms.
    if (lateralOffset > 0.42) return 'ARMS';
    return 'TORSO';
  }
  if (h >= 0.3 && lateralOffset > 0.4) return 'ARMS';
  return 'LEGS';
}

export function weaponDamage(def: WeaponDef, zone: HitZone, distance: number, armor: number): DamageResult {
  return computeDamage({
    baseDamage: def.damage,
    headshotMult: def.headshotMult,
    zone,
    distance,
    falloffStart: def.falloffStart,
    falloffEnd: def.falloffEnd,
    minDamageMult: def.minDamageMult,
    armor,
    armorDamageMult: def.armorDamageMult,
  });
}

/** Grenade radial falloff: 1 at center -> 0.25 at edge -> 0 beyond. */
export function grenadeFalloff(distance: number, radius: number): number {
  if (distance >= radius) return 0;
  const t = clamp(distance / radius, 0, 1);
  return (1 - Math.pow(t, DAMAGE.grenadeFalloffPower)) * 0.75 + 0.25 * (1 - t);
}
