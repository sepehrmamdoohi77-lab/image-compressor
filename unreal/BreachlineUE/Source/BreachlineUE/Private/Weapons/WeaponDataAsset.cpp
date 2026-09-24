// Copyright (c) Breachline UE. All rights reserved.

#include "Weapons/WeaponDataAsset.h"

#if WITH_EDITOR
#include "Misc/DataValidation.h"

EDataValidationResult UBreachlineWeaponDataAsset::IsDataValid(FDataValidationContext& Context) const
{
	EDataValidationResult Result = Super::IsDataValid(Context);

	// A weapon asset is the designer-facing half of the balance table, so the
	// validation rules are the balance invariants: ids must be set, numbers must
	// be positive, and the falloff window must be ordered.
	if (Def.Id.IsNone())
	{
		Context.AddError(FText::FromString(TEXT("Weapon Id is empty: the asset cannot be found by loadout code.")));
		Result = EDataValidationResult::Invalid;
	}

	if (Def.Damage <= 0.f)
	{
		Context.AddError(FText::FromString(TEXT("Damage must be greater than zero.")));
		Result = EDataValidationResult::Invalid;
	}

	if (Def.RoundsPerMinute <= 0.f)
	{
		Context.AddError(FText::FromString(TEXT("RoundsPerMinute must be greater than zero (it is a divisor).")));
		Result = EDataValidationResult::Invalid;
	}

	if (Def.MagSize <= 0)
	{
		Context.AddError(FText::FromString(TEXT("MagSize must be at least 1.")));
		Result = EDataValidationResult::Invalid;
	}

	if (Def.FalloffEnd < Def.FalloffStart)
	{
		Context.AddError(FText::FromString(TEXT("FalloffEnd must be greater than or equal to FalloffStart.")));
		Result = EDataValidationResult::Invalid;
	}

	if (Def.Range < Def.FalloffEnd)
	{
		Context.AddWarning(FText::FromString(TEXT("Range is shorter than FalloffEnd: the last part of the falloff curve can never be reached.")));
	}

	return Result;
}
#endif
