// Copyright (c) Breachline UE. All rights reserved.

#include "Weapons/WeaponManagerComponent.h"
#include "Weapons/WeaponComponent.h"
#include "Weapons/WeaponDataAsset.h"
#include "Core/BreachlineBalance.h"
#include "Core/BreachlineSettings.h"
#include "Engine/DataTable.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"
#include "BreachlineUE.h"

UWeaponManagerComponent::UWeaponManagerComponent()
{
	PrimaryComponentTick.bCanEverTick = false;
}

void UWeaponManagerComponent::BeginPlay()
{
	Super::BeginPlay();
	BuildLoadout();
}

void UWeaponManagerComponent::BuildLoadout()
{
	AActor* Owner = GetOwner();
	if (!Owner) return;

	Definitions = Breachline::DefaultWeapons();

	// A weapon DataTable (rows of FBreachlineWeaponDef, keyed by weapon id)
	// overrides matching entries by id.
	if (const UDataTable* Table = UBreachlineSettings::Get()->ResolveWeaponTable())
	{
		for (FBreachlineWeaponDef& Def : Definitions)
		{
			static const FString Context(TEXT("WeaponTable"));
			if (const FBreachlineWeaponDef* Row = Table->FindRow<FBreachlineWeaponDef>(Def.Id, Context, false))
			{
				const FName KeptId = Def.Id;
				Def = *Row;
				Def.Id = KeptId; // the row may omit the key column
			}
		}
	}

	// Prefer data assets when the project has them (DA_Weapon_*).
	for (FBreachlineWeaponDef& Def : Definitions)
	{
		const FString Path = FString::Printf(TEXT("/Game/Breachline/Data/DA_Weapon_%s.DA_Weapon_%s"),
			*Def.Id.ToString(), *Def.Id.ToString());
		if (const UBreachlineWeaponDataAsset* Asset = LoadObject<UBreachlineWeaponDataAsset>(nullptr, *Path))
		{
			const FName KeptId = Def.Id;
			Def = Asset->Def;
			Def.Id = KeptId;
		}
	}

	Weapons.Reset();
	Weapons.Reserve(Definitions.Num());

	for (int32 Index = 0; Index < Definitions.Num(); ++Index)
	{
		UWeaponComponent* Weapon = NewObject<UWeaponComponent>(Owner);
		Weapon->SetDefinition(Definitions[Index]);
		Weapon->RegisterComponent();
		Weapon->SetComponentTickEnabled(false);
		Weapons.Add(Weapon);
	}

	ActiveSlot = EWeaponSlotId::Rifle;
	if (UWeaponComponent* Active = GetActiveWeapon())
	{
		Active->SetComponentTickEnabled(true);
		OnWeaponSwitched.Broadcast(ActiveSlot, Active->GetDefinition());
	}
}

UWeaponComponent* UWeaponManagerComponent::GetWeapon(EWeaponSlotId Slot) const
{
	const int32 Index = static_cast<int32>(Slot);
	return Weapons.IsValidIndex(Index) ? Weapons[Index] : nullptr;
}

UWeaponComponent* UWeaponManagerComponent::GetActiveWeapon() const
{
	return GetWeapon(ActiveSlot);
}

void UWeaponManagerComponent::EquipSlot(EWeaponSlotId Slot)
{
	if (Slot == ActiveSlot || static_cast<int32>(Slot) >= Weapons.Num())
	{
		return;
	}

	// Switching cancels a reload: the magazine in progress is lost.
	if (UWeaponComponent* Previous = GetActiveWeapon())
	{
		Previous->CancelReload();
		Previous->SetComponentTickEnabled(false);
	}

	ActiveSlot = Slot;

	if (UWeaponComponent* Next = GetActiveWeapon())
	{
		Next->SetComponentTickEnabled(true);
		OnWeaponSwitched.Broadcast(ActiveSlot, Next->GetDefinition());
	}
}

void UWeaponManagerComponent::CycleWeapon(int32 Direction)
{
	const int32 Count = Weapons.Num();
	if (Count <= 0) return;

	int32 Index = static_cast<int32>(ActiveSlot);
	Index = ((Index + Direction) % Count + Count) % Count;
	EquipSlot(static_cast<EWeaponSlotId>(Index));
}

void UWeaponManagerComponent::ResupplyAll()
{
	for (UWeaponComponent* Weapon : Weapons)
	{
		if (Weapon)
		{
			Weapon->Resupply();
		}
	}
	UE_LOG(LogBreachline, Verbose, TEXT("Loadout resupplied (%d weapons)."), Weapons.Num());
}
