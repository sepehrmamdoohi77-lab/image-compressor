// Copyright (c) Breachline UE. All rights reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "Core/BreachlineTypes.h"
#include "BreachlineCharacterBase.generated.h"

class UCapsuleComponent;
class UHealthComponent;
class UWeaponComponent;
class UBreachlineWeaponDataAsset;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FBreachlineCharacterDied, ABreachlineCharacterBase*, Character, AActor*, Killer);

/**
 * Shared base for the player and every hostile: capsule sizing, health/armor,
 * the ragdoll-vs-collapse death switch, and the muzzle/support-grip queries the
 * weapons need. Character-specific behaviour lives in the subclasses.
 */
UCLASS(Abstract)
class BREACHLINEUE_API ABreachlineCharacterBase : public ACharacter
{
	GENERATED_BODY()

public:
	ABreachlineCharacterBase();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	/** Muzzle transform for the currently held weapon (trace origin + FX). */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Character")
	FVector GetMuzzleLocation() const;

	UFUNCTION(BlueprintPure, Category = "Breachline|Character")
	UHealthComponent* GetHealthComponent() const { return Health; }

	UFUNCTION(BlueprintPure, Category = "Breachline|Character")
	bool IsAlive() const { return Health && !Health->IsDead(); }

	/** True for the first ~0.22 s after death: used to fire the impact recoil. */
	UFUNCTION(BlueprintPure, Category = "Breachline|Character")
	float GetTimeSinceDeath() const;

	/** Aim bob/lean: where the muzzle points, in world space. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Character")
	void SetAimDirection(const FVector& WorldDirection);

	UFUNCTION(BlueprintPure, Category = "Breachline|Character")
	FVector GetAimDirection() const { return AimDirection; }

	/** Head-height point used by hostile gunnery and near-miss measurement. */
	UFUNCTION(BlueprintPure, Category = "Breachline|Character")
	FVector GetChestLocation() const;

	// --- death ---------------------------------------------------------------
	/** Fired once when health reaches zero (before the ragdoll swap). */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Character")
	virtual void HandleDeath(AActor* Killer);

	/** Dynamic-delegate trampoline for UHealthComponent::OnDied. */
	UFUNCTION()
	void HandleDeathFromHealth(AActor* Victim, AActor* Killer);

	/** Procedural collapse when no animation assets are present, ragdoll when they are. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Death")
	bool bUseRagdoll = true;

	UPROPERTY(BlueprintAssignable, Category = "Breachline|Character")
	FBreachlineCharacterDied OnCharacterDied;

	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Character")
	FVector AimDirection = FVector::ForwardVector;

	/** Inventory weight tier: enemies carry one weapon, the player carries five. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Breachline|Character")
	EWeaponSlotId PrimaryWeaponSlot = EWeaponSlotId::Rifle;

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Breachline|Character")
	TObjectPtr<UHealthComponent> Health;

	/** Socket on the skeletal mesh where the muzzle flash and traces start. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Character")
	FName MuzzleSocketName = TEXT("Muzzle");

	/** Fallback muzzle offset when the socket is missing (blockout characters). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Character")
	FVector MuzzleFallbackOffset = FVector(45.f, 18.f, 130.f);

	/** Death timestamp (world seconds) so the collapse can be time-driven. */
	float DeathTime = -1.f;

	/** Cached for the death collapse: which way this body topples. */
	float FallRollDeg = 0.f;
};
