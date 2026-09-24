// Copyright (c) Breachline UE. All rights reserved.
//
// Central damage pipeline: Weapon -> HitDetection -> Zone -> Falloff -> Armor ->
// Health. Pure functions with no engine state (unit-testable and identical to
// the web prototype's `combat/DamageSystem.ts`), plus small helpers for the
// engine-side trace classification.

#pragma once

#include "CoreMinimal.h"
#include "Core/BreachlineTypes.h"
#include "DamageModel.generated.h"

/** Weapon + target + distance in, resolved damage out. */
USTRUCT(BlueprintType)
struct FDamageInput
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float BaseDamage = 24.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float HeadshotMult = 2.1f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") EHitZone Zone = EHitZone::Torso;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float DistanceM = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float FalloffStartM = 16.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float FalloffEndM = 38.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float MinDamageMult = 0.55f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float TargetArmor = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float ArmorDamageMult = 1.f;
};

USTRUCT(BlueprintType)
struct FDamageResult
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Damage") float HealthDamage = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Damage") float ArmorDamage = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Damage") float RawDamage = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Damage") float Mitigated = 0.f;
};

/** Tunables mirrored from the web build's DAMAGE block. */
USTRUCT(BlueprintType)
struct FBreachlineDamageTuning
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float ZoneHead = 2.2f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float ZoneTorso = 1.0f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float ZoneArms = 0.75f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float ZoneLegs = 0.65f;
	/** reduction = armor / (armor + ArmorK) — keeps time-to-kill fair. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float ArmorK = 60.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float ArmorAbsorb = 0.65f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float GrenadeDamage = 110.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float GrenadeRadiusM = 5.5f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Damage") float GrenadeFalloffPower = 1.35f;

	static const FBreachlineDamageTuning& Get();
};

namespace Breachline
{
	/** 1 until FalloffStartM, linear to MinDamageMult at FalloffEndM. */
	float FalloffMultiplier(float DistanceM, float StartM, float EndM, float MinMult);

	/** Armor mitigation fraction 0..0.75. */
	float ArmorReduction(float Armor, float ArmorK);

	/** Full pipeline. Pure — safe to call from tests and from gameplay. */
	FDamageResult ComputeDamage(const FDamageInput& Input, const FBreachlineDamageTuning& Tuning);

	/** Zone from impact height relative to the target's feet (0..1 body frac). */
	EHitZone ZoneFromHeight(float ImpactZ, float FeetZ, float TargetHeight, float LateralOffset);

	/** Grenade radial falloff: 1 at the centre, 0 at the radius. */
	float GrenadeFalloff(float DistanceM, float RadiusM, float Power);

	/** Zone multiplier for weapons whose headshot mult is not authored. */
	float ZoneMultiplier(EHitZone Zone, float HeadshotMult, const FBreachlineDamageTuning& Tuning);
}
