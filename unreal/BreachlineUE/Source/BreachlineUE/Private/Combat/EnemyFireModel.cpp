// Copyright (c) Breachline UE. All rights reserved.

#include "Combat/EnemyFireModel.h"
#include "Core/BreachlineBalance.h"

namespace Breachline
{
	float EnemyAccuracy(float Accuracy, float AccuracyMult)
	{
		return FMath::Clamp(Accuracy * AccuracyMult, 0.05f, 0.95f);
	}

	float EnemyAimError(const FEnemyShotInput& In)
	{
		const float Acc = EnemyAccuracy(In.Accuracy, In.AccuracyMult);
		float Err = AI::AimErrorBase * (1.35f - Acc);

		Err += (In.DistanceM / FMath::Max(1.f, In.WeaponRangeM)) * 0.035f;

		if (In.bPlayerMoving)
		{
			Err += AI::AimErrorMoveTarget * FMath::Clamp(In.PlayerSpeedMps / Player::WalkSpeedMps, 0.f, 1.f);
		}
		if (In.bShooterMoving)
		{
			Err += AI::AimErrorMoveSelf;
		}
		if (In.bPlayerCrouched)
		{
			Err += 0.012f;
		}
		if (In.bReactionRecent)
		{
			// Re-acquiring: the first shots out of a fresh reaction are loose.
			Err *= 1.6f;
		}
		return Err;
	}

	float EnemyMissChance(const FEnemyShotInput& In)
	{
		const float Acc = EnemyAccuracy(In.Accuracy, In.AccuracyMult);

		float Chance = AI::MissChanceBase + AI::MissChanceAccuracyScale * (1.f - Acc);
		if (In.bPlayerMoving)
		{
			Chance += AI::MissChanceMoving * FMath::Clamp(In.PlayerSpeedMps / Player::WalkSpeedMps, 0.f, 1.2f);
		}
		Chance += AI::MissChanceDistance * FMath::Clamp(In.DistanceM / FMath::Max(1.f, In.WeaponRangeM), 0.f, 1.f);
		if (In.bSuppressed)
		{
			Chance += AI::MissChanceSuppressed;
		}
		if (In.bPlayerCrouched)
		{
			Chance += 0.04f;
		}
		// A fresh reaction must not be a guaranteed miss — cap the stack.
		return FMath::Clamp(Chance, 0.f, 0.35f);
	}

	FEnemyShotPlan PlanEnemyShot(const FEnemyShotInput& In, const FBreachlineRng& Rng)
	{
		FEnemyShotPlan Plan;
		Plan.AimError = EnemyAimError(In);
		Plan.bMiss = Rng.Next01() < EnemyMissChance(In);

		if (!Plan.bMiss)
		{
			return Plan;
		}

		const float Side = Rng.Next01() < 0.5f ? -1.f : 1.f;
		// 0.55..1.0 of the tuned lateral magnitude: the round snaps past the head.
		Plan.LateralM = Side * AI::MissLateralM * (0.55f + Rng.Next01() * 0.45f);
		Plan.VerticalM = Rng.NextSigned() * AI::MissVerticalM;
		return Plan;
	}

	float RayPointDistance(const FVector& Origin, const FVector& Direction, const FVector& Point, float MaxT)
	{
		const float T = FVector::DotProduct(Point - Origin, Direction);
		if (T <= 0.f || T > MaxT)
		{
			return TNumericLimits<float>::Max();
		}
		const FVector Closest = Origin + Direction * T;
		return FVector::Dist(Point, Closest) / BREACHLINE_CM_PER_M;
	}
}
