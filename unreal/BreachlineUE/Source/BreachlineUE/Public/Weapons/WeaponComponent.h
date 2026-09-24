// Copyright (c) Breachline UE. All rights reserved.

#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Core/BreachlineTypes.h"
#include "Combat/EnemyFireModel.h"   // FEnemyShotPlan (hostile fire path)
#include "WeaponComponent.generated.h"

class UBreachlineAudioSubsystem;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FBreachlineWeaponFired, FName, WeaponId, int32, MagAmmo);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FBreachlineWeaponAmmoChanged, int32, MagAmmo, int32, ReserveAmmo);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FBreachlineReloadFinished, FName, WeaponId);

/**
 * Live state + rules for ONE weapon: ammo, rate of fire, bloom, spread, reload.
 * Every number comes from the FBreachlineWeaponDef it is built from, so making a
 * gun "feel" different is a data edit, not a code change.
 *
 * Firing itself is delegated to UBreachlineCombatLibrary (traces + damage) so the
 * weapon component stays free of combat rules.
 */
UCLASS(ClassGroup = (Breachline), meta = (BlueprintSpawnableComponent))
class BREACHLINEUE_API UWeaponComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UWeaponComponent();

	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	UFUNCTION(BlueprintCallable, Category = "Breachline|Weapon")
	void SetDefinition(const FBreachlineWeaponDef& InDef);

	UFUNCTION(BlueprintPure, Category = "Breachline|Weapon")
	const FBreachlineWeaponDef& GetDefinition() const { return Def; }

	// --- trigger -------------------------------------------------------------
	/** True when the weapon was ready and a round left the barrel. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Weapon")
	bool TryFire(const FVector& MuzzleLocation, const FVector& AimDirection, bool bIgnoreRateLimit = false);

	/**
	 * Hostile trigger pull. Same ammo/bloom/cooldown bookkeeping as TryFire, but
	 * the round is resolved by the enemy gunnery model (aim error, suppression,
	 * deliberate near misses) instead of the player's spread cone. Enemies must
	 * NOT go through TryFire: that would resolve the shot twice and with the
	 * wrong rules.
	 */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Weapon")
	bool TryFireEnemy(
		const FVector& MuzzleLocation,
		AActor* Target,
		float Accuracy,
		float AccuracyMult,
		FEnemyShotPlan& OutPlan,
		float& OutNearMissMeters);

	UFUNCTION(BlueprintCallable, Category = "Breachline|Weapon")
	void StartReload();

	UFUNCTION(BlueprintCallable, Category = "Breachline|Weapon")
	void CancelReload();

	UFUNCTION(BlueprintPure, Category = "Breachline|Weapon")
	bool CanFire(float Now) const;

	UFUNCTION(BlueprintPure, Category = "Breachline|Weapon")
	bool IsEmpty() const { return MagAmmo <= 0; }

	UFUNCTION(BlueprintPure, Category = "Breachline|Weapon")
	bool IsReloading() const { return bReloading; }

	/** Seconds until the next round can leave the barrel (for AI burst timing). */
	UFUNCTION(BlueprintPure, Category = "Breachline|Weapon")
	float GetCooldownRemaining(float Now) const;

	// --- handling ------------------------------------------------------------
	/** Current spread half-angle in radians for a shot fired right now. */
	UFUNCTION(BlueprintPure, Category = "Breachline|Weapon")
	float GetSpreadRadians() const;

	UFUNCTION(BlueprintCallable, Category = "Breachline|Weapon")
	void SetAiming(bool bInAiming) { bAiming = bInAiming; }

	UFUNCTION(BlueprintCallable, Category = "Breachline|Weapon")
	void SetMoving(bool bInMoving) { bMoving = bInMoving; }

	UFUNCTION(BlueprintCallable, Category = "Breachline|Weapon")
	void SetCrouched(bool bInCrouched) { bCrouched = bInCrouched; }

	// --- ammo ---------------------------------------------------------------
	UFUNCTION(BlueprintCallable, Category = "Breachline|Weapon")
	void Resupply();

	UFUNCTION(BlueprintCallable, Category = "Breachline|Weapon")
	void SetAmmo(int32 InMag, int32 InReserve);

	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Weapon") int32 MagAmmo = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Weapon") int32 ReserveAmmo = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Weapon") float Bloom = 0.f;

	UPROPERTY(BlueprintAssignable, Category = "Breachline|Weapon") FBreachlineWeaponFired OnFired;
	UPROPERTY(BlueprintAssignable, Category = "Breachline|Weapon") FBreachlineWeaponAmmoChanged OnAmmoChanged;
	UPROPERTY(BlueprintAssignable, Category = "Breachline|Weapon") FBreachlineReloadFinished OnReloadFinished;

private:
	UPROPERTY() FBreachlineWeaponDef Def;
	/** Magazine ceiling after reload (per-weapon; DMR/shotgun differ from rifles). */
	UPROPERTY() int32 MagCapacity = 30;

	float LastShotTime = -1000.f;
	float ReloadEndTime = -1.f;
	bool bReloading = false;
	bool bAiming = false;
	bool bMoving = false;
	bool bCrouched = false;
};
