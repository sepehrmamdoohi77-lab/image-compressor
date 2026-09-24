// Copyright (c) Breachline UE. All rights reserved.
//
// Enemy gunnery: how well hostiles shoot and why they sometimes miss.
//
// Two layers feed every shot:
//   1. Continuous aim error — the sight picture is off, and it grows with
//      range, target movement, shooter movement and a fresh reaction.
//   2. Deliberate near misses — occasionally a round is thrown wide on purpose
//      so it cracks past the player (whiz + shake) instead of punching through.
//
// All pure math with an injectable RNG, exactly like `combat/EnemyFire.ts`.

#pragma once

#include "CoreMinimal.h"
#include "EnemyFireModel.generated.h"

USTRUCT(BlueprintType)
struct FEnemyShotInput
{
	GENERATED_BODY()

	/** Archetype accuracy before difficulty scaling (0..1). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Enemy Fire") float Accuracy = 0.5f;
	/** Round-based accuracy multiplier (0.8 .. 1.12). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Enemy Fire") float AccuracyMult = 1.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Enemy Fire") float DistanceM = 10.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Enemy Fire") float WeaponRangeM = 46.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Enemy Fire") bool bPlayerMoving = false;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Enemy Fire") float PlayerSpeedMps = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Enemy Fire") bool bPlayerCrouched = false;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Enemy Fire") bool bShooterMoving = false;
	/** Still re-acquiring after a reaction delay. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Enemy Fire") bool bReactionRecent = false;
	/** Right after taking damage or being forced out of cover. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Enemy Fire") bool bSuppressed = false;
};

USTRUCT(BlueprintType)
struct FEnemyShotPlan
{
	GENERATED_BODY()

	/** Aim cone error in radians, applied to the shot direction. */
	UPROPERTY(BlueprintReadOnly, Category = "Enemy Fire") float AimError = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Enemy Fire") bool bMiss = false;
	/** Signed lateral offset in metres, perpendicular to the shot line. */
	UPROPERTY(BlueprintReadOnly, Category = "Enemy Fire") float LateralM = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Enemy Fire") float VerticalM = 0.f;
};

/** Injectable RNG so a test can pin a shot to hit or miss deterministically. */
struct FBreachlineRng
{
	/** Returns [0,1). */
	TFunction<float()> Next01;
	/** Signed unit float in [-1,1). */
	TFunction<float()> NextSigned;

	FBreachlineRng()
	{
		Next01 = []() { return FMath::FRand(); };
		NextSigned = []() { return FMath::FRandRange(-1.f, 1.f); };
	}

	static FBreachlineRng Seeded(int32 Seed)
	{
		TSharedPtr<FRandomStream> Stream = MakeShared<FRandomStream>(Seed);
		FBreachlineRng Rng;
		Rng.Next01 = [Stream]() { return Stream->FRand(); };
		Rng.NextSigned = [Stream]() { return Stream->FRandRange(-1.f, 1.f); };
		return Rng;
	}
};

namespace Breachline
{
	/** Difficulty-scaled accuracy, clamped to a readable band. */
	float EnemyAccuracy(float Accuracy, float AccuracyMult);

	/** Continuous aim error in radians for one shot. */
	float EnemyAimError(const FEnemyShotInput& In);

	/** Probability (0 .. 0.35) that this shot is thrown wide on purpose. */
	float EnemyMissChance(const FEnemyShotInput& In);

	/** Decide the shot: cone error plus an optional planned near miss. */
	FEnemyShotPlan PlanEnemyShot(const FEnemyShotInput& In, const FBreachlineRng& Rng);

	/**
	 * Closest approach (metres) of a ray to a point, or a large value when the
	 * point is behind the muzzle or beyond MaxT (the round never got near them).
	 */
	float RayPointDistance(
		const FVector& Origin, const FVector& Direction, const FVector& Point, float MaxT);
}
