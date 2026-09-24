// Copyright (c) Breachline UE. All rights reserved.

#include "Character/HealthComponent.h"
#include "Combat/DamageModel.h"
#include "Engine/World.h"
#include "BreachlineUE.h"

UHealthComponent::UHealthComponent()
{
	PrimaryComponentTick.bCanEverTick = false;
	SetIsReplicatedByDefault(true);
}

void UHealthComponent::BeginPlay()
{
	Super::BeginPlay();
	Health = MaxHealth;
	bDead = false;
}

float UHealthComponent::ApplyBullet(const FBulletResult& Hit, AActor* Instigator, const FDamageInput& Input)
{
	// Record what killed them (if this is the killing blow) before any early-out:
	// the scorer reads this when OnDied fires.
	LastHitZone = Hit.Zone;
	bLastDamageExplosive = false;
	LastDamageInstigator = Instigator;

	FDamageInput Scaled = Input;
	Scaled.TargetArmor = Armor;

	const FDamageResult Result = Breachline::ComputeDamage(Scaled, FBreachlineDamageTuning::Get());

	// Armor soaks the shot before health does.
	const float ArmorApplied = FMath::Min(Armor, Result.ArmorDamage);
	Armor = FMath::Max(0.f, Armor - Result.ArmorDamage);

	const float HpDamage = ApplyDamage(Result.HealthDamage, Instigator);

	UE_LOG(LogBreachline, Verbose, TEXT("%s hit for %.1f (zone %d, armor -%.1f)"),
		*GetNameSafe(GetOwner()), HpDamage, static_cast<int32>(Hit.Zone), ArmorApplied);
	return HpDamage;
}

float UHealthComponent::ApplyDamage(float Amount, AActor* Instigator)
{
	if (bDead || bInvulnerable || Amount <= 0.f)
	{
		return 0.f;
	}

	const float Final = Amount * FMath::Max(0.f, DamageTakenMultiplier);
	const float Before = Health;
	Health = FMath::Max(0.f, Health - Final);
	const float Delta = Health - Before;

	LastDamageTime = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f;

	// Non-bullet damage (falling, future hazards) has no zone; keep the field sane.
	LastDamageInstigator = Instigator;
	OnHealthChanged.Broadcast(Health, Delta, Instigator);

	if (Health <= 0.f)
	{
		bDead = true;
		OnDied.Broadcast(GetOwner(), Instigator);
	}
	return -Delta;
}

float UHealthComponent::ApplyExplosiveDamage(float Amount, AActor* Instigator)
{
	bLastDamageExplosive = true;
	LastDamageInstigator = Instigator;
	return ApplyDamage(Amount, Instigator);
}

bool UHealthComponent::TryClaimKillAward()
{
	if (bKillAwarded)
	{
		return false;
	}
	bKillAwarded = true;
	return true;
}

float UHealthComponent::Heal(float Amount)
{
	if (bDead || Amount <= 0.f)
	{
		return 0.f;
	}
	const float Before = Health;
	Health = FMath::Min(MaxHealth, Health + Amount);
	const float Gained = Health - Before;
	if (Gained > 0.f)
	{
		OnHealed.Broadcast(Gained);
	}
	return Gained;
}

void UHealthComponent::Resupply(float HealthFrac, float ArmorFloor)
{
	bDead = false; // a new round revives the squad, it does not resurrect corpses
	bKillAwarded = false; // a resupplied actor can be killed again (and scored)
	Health = FMath::Clamp(MaxHealth * HealthFrac, 1.f, MaxHealth);
	Armor = FMath::Clamp(FMath::Max(Armor, ArmorFloor), 0.f, MaxArmor);
	OnHealthChanged.Broadcast(Health, Health - MaxHealth * HealthFrac, nullptr);
}
