// Copyright (c) Breachline UE. All rights reserved.

#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "Engine/HitResult.h"
#include "Core/BreachlineTypes.h"
#include "Combat/EnemyFireModel.h"
#include "BreachlineCombatLibrary.generated.h"

class AActor;
class UWorld;
class UHealthComponent;

/** Everything needed to resolve one trigger pull. */
USTRUCT(BlueprintType)
struct FBreachlineShotContext
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Shot") FBreachlineWeaponDef Weapon;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Shot") FVector MuzzleLocation = FVector::ZeroVector;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Shot") FVector AimDirection = FVector::ForwardVector;
	/** Cone half-angle in radians (already includes bloom/aim/move modifiers). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Shot") float SpreadRadians = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Shot") TObjectPtr<AActor> Instigator = nullptr;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Shot") int32 Pellets = 1;
	/** True for hostile fire: different tracer colour, no player camera kick. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Shot") bool bEnemyShot = false;
	/** Deliberate near miss: shifts the aim line so the round cracks past. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Shot") bool bDeliberateMiss = false;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Shot") float MissLateralM = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Shot") float MissVerticalM = 0.f;
	/** Shooter accuracy for the near-miss report (0..1). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Shot") float ShooterAccuracy = 0.5f;
};

/**
 * Single place where bullets become damage. Weapons, AI and grenades all funnel
 * through here, so hit zones, falloff, armor and every piece of feedback stay
 * consistent no matter who pulled the trigger.
 */
UCLASS()
class BREACHLINEUE_API UBreachlineCombatLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/**
	 * Player-side shot: one trace per pellet, cone spread, damage + full feedback.
	 * Returns true when at least one pellet connected, which is what the accuracy
	 * statistic counts (a trigger pull, not a bullet).
	 */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Combat")
	static bool ResolveShot(UWorld* World, const FBreachlineShotContext& Context);

	/**
	 * Hostile shot: builds the gunnery model input from the actual world state,
	 * plans the shot (aim error + optional deliberate near miss), resolves it and
	 * reports how close the round came so the player hears it crack past.
	 */
	/**
	 * NOT a UFUNCTION: the injectable RNG (FBreachlineRng) is a plain C++ struct with
	 * TFunction members, which UnrealHeaderTool cannot reflect. Callers are C++
	 * (UWeaponComponent::TryFireEnemy).
	 */
	static bool ResolveEnemyShot(
		UWorld* World,
		AActor* Shooter,
		const FBreachlineWeaponDef& Weapon,
		const FVector& MuzzleLocation,
		AActor* Target,
		float Accuracy,
		float AccuracyMult,
		const FBreachlineRng& Rng,
		FEnemyShotPlan& OutPlan,
		float& OutNearMissMeters);

	/** Radial explosion with LOS-aware falloff (grenades). */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Combat")
	static void ApplyExplosion(
		UWorld* World,
		const FVector& Origin,
		float RadiusMeters,
		float BaseDamage,
		AActor* Instigator,
		const TArray<AActor*>& IgnoreActors);

	/** Classifies the hit zone from the hit bone when available, else from height. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Combat")
	static EHitZone ClassifyHitZone(const FHitResult& Hit, AActor* Target);

	/** Raw bullet trace. Uses the Weapon channel: soft foliage and glass are ignored. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Combat")
	static FHitResult TraceBullet(
		UWorld* World,
		const FVector& Start,
		const FVector& Direction,
		float RangeMeters,
		AActor* IgnoreActor);

	/** Pure direction perturbation inside a cone (deterministic with a seeded RNG). */
	/** NOT a UFUNCTION for the same reason as ResolveEnemyShot (unreflected RNG). */
	static FVector PerturbDirection(const FVector& Direction, float SpreadRadians, const FBreachlineRng& Rng);

	UFUNCTION(BlueprintCallable, Category = "Breachline|Combat")
	static UHealthComponent* FindHealth(AActor* Actor);
};
