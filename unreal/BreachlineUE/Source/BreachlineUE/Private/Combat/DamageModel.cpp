// Copyright (c) Breachline UE. All rights reserved.

#include "Combat/DamageModel.h"

const FBreachlineDamageTuning& FBreachlineDamageTuning::Get()
{
	static const FBreachlineDamageTuning Tuning;
	return Tuning;
}

namespace Breachline
{
	float FalloffMultiplier(float DistanceM, float StartM, float EndM, float MinMult)
	{
		if (DistanceM <= StartM) return 1.f;
		if (DistanceM >= EndM) return MinMult;
		const float T = (DistanceM - StartM) / FMath::Max(1e-4f, EndM - StartM);
		return 1.f + (MinMult - 1.f) * T;
	}

	float ArmorReduction(float Armor, float ArmorK)
	{
		if (Armor <= 0.f) return 0.f;
		return FMath::Clamp(Armor / (Armor + FMath::Max(1.f, ArmorK)), 0.f, 0.75f);
	}

	float ZoneMultiplier(EHitZone Zone, float HeadshotMult, const FBreachlineDamageTuning& Tuning)
	{
		switch (Zone)
		{
		case EHitZone::Head:	 return HeadshotMult;
		case EHitZone::Torso:	 return Tuning.ZoneTorso;
		case EHitZone::Arms:	 return Tuning.ZoneArms;
		case EHitZone::Legs:	 return Tuning.ZoneLegs;
		default:				 return 1.f;
		}
	}

	FDamageResult ComputeDamage(const FDamageInput& In, const FBreachlineDamageTuning& Tuning)
	{
		FDamageResult Out;

		const float ZoneMult = ZoneMultiplier(In.Zone, In.HeadshotMult, Tuning);
		const float Fall = FalloffMultiplier(In.DistanceM, In.FalloffStartM, In.FalloffEndM, In.MinDamageMult);
		const float Raw = FMath::Max(0.f, In.BaseDamage * ZoneMult * Fall);
		const float Reduction = ArmorReduction(In.TargetArmor, Tuning.ArmorK);
		const float Mitigated = Raw * Reduction;

		// A connecting shot always does *something*: never reward a limp hit with 0.
		Out.RawDamage = Raw;
		Out.Mitigated = Mitigated;
		Out.HealthDamage = FMath::Max(1.f, Raw - Mitigated);
		Out.ArmorDamage = FMath::Max(0.f,
			Mitigated * Tuning.ArmorAbsorb * In.ArmorDamageMult
			+ Raw * 0.12f * In.ArmorDamageMult);
		return Out;
	}

	EHitZone ZoneFromHeight(float ImpactZ, float FeetZ, float TargetHeight, float LateralOffset)
	{
		const float H = FMath::Clamp((ImpactZ - FeetZ) / FMath::Max(0.5f, TargetHeight), 0.f, 1.2f);
		if (H >= 0.86f) return EHitZone::Head;
		if (H >= 0.52f)
		{
			// Wide lateral hits at chest height clip the arms, not the torso.
			return LateralOffset > 0.42f ? EHitZone::Arms : EHitZone::Torso;
		}
		if (H >= 0.3f && LateralOffset > 0.4f) return EHitZone::Arms;
		return EHitZone::Legs;
	}

	float GrenadeFalloff(float DistanceM, float RadiusM, float Power)
	{
		if (DistanceM >= RadiusM) return 0.f;
		const float T = FMath::Clamp(DistanceM / FMath::Max(0.01f, RadiusM), 0.f, 1.f);
		return 1.f - FMath::Pow(T, FMath::Max(0.1f, Power)) * 0.75f;
	}
}
