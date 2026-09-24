// Copyright (c) Breachline UE. All rights reserved.

#include "Character/BreachlineEnemyCharacter.h"
#include "Character/HealthComponent.h"
#include "Weapons/WeaponComponent.h"
#include "Core/BreachlineBalance.h"
#include "Core/BreachlineSettings.h"
#include "Components/CapsuleComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"
#include "Engine/StaticMesh.h"
#include "BreachlineUE.h"

using namespace Breachline;

ABreachlineEnemyCharacter::ABreachlineEnemyCharacter()
{
	PrimaryActorTick.bCanEverTick = true;

	Weapon = CreateDefaultSubobject<UWeaponComponent>(TEXT("Weapon"));

	// Enemies face where they move/aim; the AI controller sets rotation directly.
	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		Move->bOrientRotationToMovement = false;
	}

	// Every enemy carries the default rifleman kit until Configure() runs, so the
	// class is never in a half-built state.
	Archetype = Breachline::DefaultEnemyArchetypes()[0];
}

void ABreachlineEnemyCharacter::BeginPlay()
{
	Super::BeginPlay();

	if (Health)
	{
		Health->DamageTakenMultiplier = UBreachlineSettings::Get()->EnemyDamageTakenMultiplier;
		Health->MaxHealth = Archetype.MaxHealth;
		Health->MaxArmor = FMath::Max(Archetype.Armor, 1.f);
		Health->Armor = Archetype.Armor;
	}

	ApplyArchetypeVisuals();
}

void ABreachlineEnemyCharacter::Configure(
	const FEnemyArchetypeDef& InArchetype, float HealthMult, float AccuracyMultIn, float AggressionMultIn)
{
	Archetype = InArchetype;
	AccuracyMult = AccuracyMultIn;
	AggressionMult = AggressionMultIn;

	if (Health)
	{
		Health->MaxHealth = InArchetype.MaxHealth * HealthMult;
		Health->MaxArmor = FMath::Max(1.f, InArchetype.Armor * HealthMult);
		Health->Armor = InArchetype.Armor * HealthMult;
		Health->Resupply(1.f, InArchetype.Armor * HealthMult);
	}

	// The archetype's weapon, from the same table the player's guns use.
	const TArray<FBreachlineWeaponDef> Definitions = Breachline::DefaultWeapons();
	const int32 WeaponIndex = static_cast<int32>(InArchetype.Weapon);
	if (Weapon && Definitions.IsValidIndex(WeaponIndex))
	{
		Weapon->SetDefinition(Definitions[WeaponIndex]);
		// Hostiles carry generous reserves: reloads still happen (readable beat)
		// but they never run dry in a way that looks broken.
		Weapon->SetAmmo(Definitions[WeaponIndex].MagSize, Definitions[WeaponIndex].MaxReserve);
	}

	PrimaryWeaponSlot = InArchetype.Weapon;
	ApplyArchetypeVisuals();
}

FBreachlineWeaponDef ABreachlineEnemyCharacter::GetWeaponDef() const
{
	static const FBreachlineWeaponDef Fallback;
	return Weapon ? Weapon->GetDefinition() : Fallback;
}

void ABreachlineEnemyCharacter::ApplyArchetypeVisuals()
{
	// Build scale sells the archetype: the Heavy is visibly bigger than the
	// Runner, which is a gameplay-relevant read at iso distance.
	const float Scale = FMath::Clamp(Archetype.Scale, 0.85f, 1.25f);
	GetMesh()->SetRelativeScale3D(FVector(Scale));

	// Tint whatever we are wearing. With real meshes this becomes a material
	// parameter override; with the blockout capsule it is still enough to tell
	// archetypes apart in the heat of a fight.
	if (USkeletalMeshComponent* Mesh = GetMesh())
	{
		if (UMaterialInterface* Base = Mesh->GetMaterial(0))
		{
			if (!TintMaterial)
			{
				TintMaterial = UMaterialInstanceDynamic::Create(Base, this);
				Mesh->SetMaterial(0, TintMaterial);
			}
			if (TintMaterial)
			{
				static const FName TintParam(TEXT("Tint"));
				TintMaterial->SetVectorParameterValue(TintParam, Archetype.Tint);
				static const FName ColorParam(TEXT("Color"));
				TintMaterial->SetVectorParameterValue(ColorParam, Archetype.Tint);
			}
		}
	}
}

bool ABreachlineEnemyCharacter::CanFireNow() const
{
	if (!Weapon || !IsAlive()) return false;
	const UWorld* World = GetWorld();
	return World ? Weapon->CanFire(World->GetTimeSeconds()) : false;
}

bool ABreachlineEnemyCharacter::FireWeapon()
{
	if (!Weapon || !IsAlive()) return false;

	// The AI controller supplies the target; the muzzle and direction come from
	// the body so the tracer always leaves the barrel the player can see.
	const FVector Muzzle = GetMuzzleLocation();
	return Weapon->TryFire(Muzzle, AimDirection);
}

void ABreachlineEnemyCharacter::ReloadWeapon()
{
	if (!Weapon) return;
	Weapon->StartReload();
}
