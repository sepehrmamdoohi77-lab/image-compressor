// Copyright (c) Breachline UE. All rights reserved.

#include "Weapons/WeaponComponent.h"
#include "Combat/BreachlineCombatLibrary.h"
#include "Core/ProgressionSubsystem.h"
#include "Audio/BreachlineAudioSubsystem.h"
#include "BreachlineUE.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"

UWeaponComponent::UWeaponComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.bStartWithTickEnabled = false;
}

void UWeaponComponent::SetDefinition(const FBreachlineWeaponDef& InDef)
{
	Def = InDef;
	MagCapacity = FMath::Max(1, InDef.MagSize);
	MagAmmo = MagCapacity;
	ReserveAmmo = InDef.StartReserve;
	Bloom = 0.f;
	bReloading = false;
	LastShotTime = -1000.f;
	OnAmmoChanged.Broadcast(MagAmmo, ReserveAmmo);
}

bool UWeaponComponent::CanFire(float Now) const
{
	if (bReloading || MagAmmo <= 0) return false;
	const float Interval = 60.f / FMath::Max(1.f, Def.RoundsPerMinute);
	return (Now - LastShotTime) >= Interval;
}

float UWeaponComponent::GetCooldownRemaining(float Now) const
{
	const float Interval = 60.f / FMath::Max(1.f, Def.RoundsPerMinute);
	return FMath::Max(0.f, Interval - (Now - LastShotTime));
}

float UWeaponComponent::GetSpreadRadians() const
{
	float Spread = Def.SpreadBase + Bloom;
	if (bMoving) Spread += Def.SpreadMove;
	if (bCrouched) Spread *= 0.75f;
	if (bAiming) Spread *= Def.SpreadAimMult;
	return Spread;
}

bool UWeaponComponent::TryFire(const FVector& MuzzleLocation, const FVector& AimDirection, bool bIgnoreRateLimit)
{
	UWorld* World = GetWorld();
	if (!World) return false;

	const float Now = World->GetTimeSeconds();
	if (!bIgnoreRateLimit && !CanFire(Now)) return false;

	if (MagAmmo <= 0)
	{
		// Dry fire: click, then start a reload automatically (the web build's
		// "auto-reloads on empty trigger" behaviour).
		if (UBreachlineAudioSubsystem* Audio = World->GetSubsystem<UBreachlineAudioSubsystem>())
		{
			Audio->PlayDryFire(GetOwner());
		}
		if (ReserveAmmo > 0 && !bReloading) StartReload();
		return false;
	}

	LastShotTime = Now;
	MagAmmo--;

	const float Spread = GetSpreadRadians();
	Bloom = FMath::Min(Def.SpreadBase + 0.12f, Bloom + Def.SpreadBloomPerShot);

	FBreachlineShotContext Context;
	Context.Weapon = Def;
	Context.MuzzleLocation = MuzzleLocation;
	Context.AimDirection = AimDirection;
	Context.SpreadRadians = Spread;
	Context.Instigator = GetOwner();
	Context.Pellets = FMath::Max(1, Def.Pellets);

	const bool bConnected = UBreachlineCombatLibrary::ResolveShot(World, Context);

	// Accuracy is counted per trigger pull that connected, exactly like the web
	// build's ProgressionSystem: a shotgun blast that lands one pellet is a hit.
	if (UProgressionSubsystem* Progression = World->GetSubsystem<UProgressionSubsystem>())
	{
		Progression->OnShotFired(bConnected);
	}

	OnFired.Broadcast(Def.Id, MagAmmo);
	OnAmmoChanged.Broadcast(MagAmmo, ReserveAmmo);
	return true;
}

bool UWeaponComponent::TryFireEnemy(
	const FVector& MuzzleLocation,
	AActor* Target,
	float Accuracy,
	float AccuracyMult,
	FEnemyShotPlan& OutPlan,
	float& OutNearMissMeters)
{
	OutPlan = FEnemyShotPlan();
	OutNearMissMeters = TNumericLimits<float>::Max();

	UWorld* World = GetWorld();
	if (!World || !Target) return false;

	const float Now = World->GetTimeSeconds();
	if (!CanFire(Now)) return false;
	if (MagAmmo <= 0)
	{
		if (ReserveAmmo > 0 && !bReloading) StartReload();
		return false;
	}

	LastShotTime = Now;
	MagAmmo--;
	Bloom = FMath::Min(Def.SpreadBase + 0.12f, Bloom + Def.SpreadBloomPerShot);
	OnFired.Broadcast(Def.Id, MagAmmo);
	OnAmmoChanged.Broadcast(MagAmmo, ReserveAmmo);

	// One deterministic RNG per round: aim error and the miss roll stay
	// reproducible for a given seed, which is what the automation tests assert.
	FBreachlineRng Rng = FBreachlineRng::Seeded(static_cast<int32>(Now * 1000.f) ^ static_cast<int32>(GetUniqueID()));

	return UBreachlineCombatLibrary::ResolveEnemyShot(
		World, GetOwner(), Def, MuzzleLocation, Target, Accuracy, AccuracyMult, Rng,
		OutPlan, OutNearMissMeters);
}

void UWeaponComponent::StartReload()
{
	if (bReloading || MagAmmo >= MagCapacity || ReserveAmmo <= 0) return;

	UWorld* World = GetWorld();
	if (!World) return;

	bReloading = true;
	ReloadEndTime = World->GetTimeSeconds() + FMath::Max(0.2f, Def.ReloadTime);
	SetComponentTickEnabled(true);

	if (UBreachlineAudioSubsystem* Audio = World->GetSubsystem<UBreachlineAudioSubsystem>())
	{
		Audio->PlayReloadStart(GetOwner(), Def);
	}
}

void UWeaponComponent::CancelReload()
{
	bReloading = false;
	ReloadEndTime = -1.f;
}

void UWeaponComponent::Resupply()
{
	bReloading = false;
	ReloadEndTime = -1.f;
	Bloom = 0.f;
	MagAmmo = MagCapacity;
	// Reserves top up to at least the authored starting load, capped by max.
	ReserveAmmo = FMath::Clamp(FMath::Max(ReserveAmmo, Def.StartReserve), 0, FMath::Max(1, Def.MaxReserve));
	OnAmmoChanged.Broadcast(MagAmmo, ReserveAmmo);
}

void UWeaponComponent::SetAmmo(int32 InMag, int32 InReserve)
{
	MagAmmo = FMath::Clamp(InMag, 0, MagCapacity);
	ReserveAmmo = FMath::Clamp(InReserve, 0, FMath::Max(1, Def.MaxReserve));
	OnAmmoChanged.Broadcast(MagAmmo, ReserveAmmo);
}

void UWeaponComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	UWorld* World = GetWorld();
	if (!World) return;

	// Bloom recovers while not shooting; heavier weapons recover slower.
	Bloom = FMath::Max(0.f, Bloom - DeltaTime * Def.RecoilRecovery * 0.01f);

	if (bReloading && World->GetTimeSeconds() >= ReloadEndTime)
	{
		const int32 Need = MagCapacity - MagAmmo;
		const int32 Take = FMath::Min(Need, ReserveAmmo);
		MagAmmo += Take;
		ReserveAmmo -= Take;
		bReloading = false;
		ReloadEndTime = -1.f;
		SetComponentTickEnabled(false);

		OnReloadFinished.Broadcast(Def.Id);
		OnAmmoChanged.Broadcast(MagAmmo, ReserveAmmo);

		if (UBreachlineAudioSubsystem* Audio = World->GetSubsystem<UBreachlineAudioSubsystem>())
		{
			Audio->PlayReloadEnd(GetOwner(), Def);
		}
	}
}
