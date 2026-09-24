// Copyright (c) Breachline UE. All rights reserved.

#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "Core/BreachlineTypes.h"
#include "WeaponDataAsset.generated.h"

/**
 * One weapon as an asset (DA_Weapon_Rifle ...). Generated from
 * Content/Data/weapons.json by Content/Python/breachline_assets.py, or authored
 * by hand; either way the runtime only ever reads FBreachlineWeaponDef, and
 * falls back to Breachline::DefaultWeapons() when nothing is assigned.
 */
UCLASS(BlueprintType)
class BREACHLINEUE_API UBreachlineWeaponDataAsset : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Weapon")
	FBreachlineWeaponDef Def;

	/** Skeletal-mesh socket the muzzle flash and bullet traces originate from. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Weapon")
	FName MuzzleSocket = TEXT("Muzzle");

	/** Socket on the handguard the support hand should grip (two-handed hold). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Weapon")
	FName SupportGripSocket = TEXT("GripSupport");

	/** Local offset of the support hand relative to the weapon root, in cm. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Weapon")
	FVector SupportGripOffset = FVector(0.f, 0.f, 30.f);

	virtual FPrimaryAssetId GetPrimaryAssetId() const override
	{
		return FPrimaryAssetId(TEXT("BreachlineWeapon"), Def.Id);
	}

#if WITH_EDITOR
	virtual EDataValidationResult IsDataValid(FDataValidationContext& Context) const override;
#endif
};
