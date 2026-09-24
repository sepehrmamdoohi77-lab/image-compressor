// Copyright (c) Breachline UE. All rights reserved.

#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Core/BreachlineTypes.h"
#include "WeaponManagerComponent.generated.h"

class UWeaponComponent;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FBreachlineWeaponSwitched, EWeaponSlotId, Slot, FBreachlineWeaponDef, Def);

/**
 * The squad loadout: five weapon components, one active at a time. Switching
 * cancels a reload in progress (the web build does the same, so swapping mid
 * reload is a real decision) and round resupply tops every slot back up.
 *
 * Definitions come from DataTable/DataAssets when present, otherwise from
 * Breachline::DefaultWeapons() — so a fresh clone plays with the tuned set and
 * a designer can replace one gun at a time.
 */
UCLASS(ClassGroup = (Breachline), meta = (BlueprintSpawnableComponent))
class BREACHLINEUE_API UWeaponManagerComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UWeaponManagerComponent();

	virtual void BeginPlay() override;

	/** Loads definitions (data table > defaults) and builds the five components. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Loadout")
	void BuildLoadout();

	UFUNCTION(BlueprintCallable, Category = "Breachline|Loadout")
	void EquipSlot(EWeaponSlotId Slot);

	UFUNCTION(BlueprintCallable, Category = "Breachline|Loadout")
	void CycleWeapon(int32 Direction);

	UFUNCTION(BlueprintCallable, Category = "Breachline|Loadout")
	void ResupplyAll();

	UFUNCTION(BlueprintPure, Category = "Breachline|Loadout")
	UWeaponComponent* GetActiveWeapon() const;

	UFUNCTION(BlueprintPure, Category = "Breachline|Loadout")
	UWeaponComponent* GetWeapon(EWeaponSlotId Slot) const;

	UFUNCTION(BlueprintPure, Category = "Breachline|Loadout")
	EWeaponSlotId GetActiveSlot() const { return ActiveSlot; }

	UFUNCTION(BlueprintPure, Category = "Breachline|Loadout")
	TArray<FBreachlineWeaponDef> GetDefinitions() const { return Definitions; }

	UPROPERTY(BlueprintAssignable, Category = "Breachline|Loadout")
	FBreachlineWeaponSwitched OnWeaponSwitched;

	/** All five definitions, indexed by EWeaponSlotId. */
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Loadout")
	TArray<FBreachlineWeaponDef> Definitions;

private:
	UPROPERTY(Transient)
	TArray<TObjectPtr<UWeaponComponent>> Weapons;

	EWeaponSlotId ActiveSlot = EWeaponSlotId::Rifle;
};
