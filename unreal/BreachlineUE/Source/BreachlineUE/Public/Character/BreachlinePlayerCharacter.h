// Copyright (c) Breachline UE. All rights reserved.

#pragma once

#include "CoreMinimal.h"
#include "Character/BreachlineCharacterBase.h"
#include "Weapons/GrenadeActor.h"
#include "BreachlinePlayerCharacter.generated.h"

class UCameraComponent;
class UInputAction;
class UInputMappingContext;
class UWeaponManagerComponent;
struct FInputActionValue;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FBreachlineMedkitPicked, float, Amount, int32, MedkitsUsed);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FBreachlineSprintChanged, bool, bSprinting);

/**
 * The operator. Owns movement (walk/sprint/crouch), the aim state, the five-slot
 * loadout and the round resupply. Sprint and aim are mutually exclusive, exactly
 * like the web build: speed costs you precision and silence.
 *
 * Enhanced Input bindings are created in code when no IMC asset is assigned, so
 * the game is playable from a fresh clone; assigning IMC_Breachline in Project
 * Settings takes over without a code change.
 */
UCLASS()
class BREACHLINEUE_API ABreachlinePlayerCharacter : public ABreachlineCharacterBase
{
	GENERATED_BODY()

public:
	ABreachlinePlayerCharacter();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(class UInputComponent* PlayerInputComponent) override;

	/** Builds the runtime IMC + input actions when no asset is configured. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Input")
	void BuildDefaultInputMapping(UInputMappingContext* Context);

	// --- input handlers ------------------------------------------------------
	void OnMove(const FInputActionValue& Value);
	void OnAimWorld(const FInputActionValue& Value);
	void OnFireStart(const FInputActionValue& Value);
	void OnFireStop(const FInputActionValue& Value);
	void OnPrecisionAimStart(const FInputActionValue& Value);
	void OnPrecisionAimStop(const FInputActionValue& Value);
	void OnSprintStart(const FInputActionValue& Value);
	void OnSprintStop(const FInputActionValue& Value);
	void OnCrouchToggle(const FInputActionValue& Value);
	void OnReload(const FInputActionValue& Value);
	void OnGrenade(const FInputActionValue& Value);
	void OnWeaponSlot1(const FInputActionValue& Value);
	void OnWeaponSlot2(const FInputActionValue& Value);
	void OnWeaponSlot3(const FInputActionValue& Value);
	void OnWeaponSlot4(const FInputActionValue& Value);
	void OnWeaponSlot5(const FInputActionValue& Value);
	void OnCycleWeapon(const FInputActionValue& Value);

	// --- gameplay API --------------------------------------------------------
	/** Round change: full health, every magazine, reserves, grenades and armor. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Player")
	void Resupply();

	/** Field medkit: restores a fraction of max health, never overheals. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Player")
	float ApplyMedkit(float Amount);

	UFUNCTION(BlueprintCallable, Category = "Breachline|Player")
	void AddGrenade(int32 Count = 1);

	UFUNCTION(BlueprintPure, Category = "Breachline|Player")
	UWeaponManagerComponent* GetLoadout() const { return Loadout; }

	UFUNCTION(BlueprintPure, Category = "Breachline|Player")
	bool IsSprinting() const { return bSprinting; }

	UFUNCTION(BlueprintPure, Category = "Breachline|Player")
	bool IsAiming() const { return bPrecisionAim; }

	UFUNCTION(BlueprintPure, Category = "Breachline|Player")
	int32 GetGrenades() const { return Grenades; }

	/** Medkits collected this run (HUD counter). */
	UFUNCTION(BlueprintPure, Category = "Breachline|Player")
	int32 GetMedkitsUsed() const { return MedkitsUsed; }

	/** Metres of movement noise this frame: 0 idle, 12 walking, 23 sprinting. */
	UFUNCTION(BlueprintPure, Category = "Breachline|Player")
	float GetNoiseRadiusMeters() const;

	UPROPERTY(BlueprintAssignable, Category = "Breachline|Player")
	FBreachlineMedkitPicked OnMedkitPicked;

	UPROPERTY(BlueprintAssignable, Category = "Breachline|Player")
	FBreachlineSprintChanged OnSprintChanged;

	/** Where the player is aiming on the ground plane (cursor aim). */
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Player")
	FVector AimPointWorld = FVector::ZeroVector;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Player")
	int32 Grenades = 3;

protected:
	/** Runtime-generated input objects (kept alive for the session). */
	UPROPERTY(Transient) TObjectPtr<UInputMappingContext> RuntimeContext = nullptr;
	UPROPERTY(Transient) TMap<FName, TObjectPtr<UInputAction>> RuntimeActions;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Breachline|Player")
	TObjectPtr<UWeaponManagerComponent> Loadout;

	UInputAction* MakeAction(const FName Key, const TCHAR* Name, bool bValueType);
	UInputAction* MakeAxisAction(const FName Key, const TCHAR* Name);

	/** Q/E orbit (camera is the controller's rig); wheel zoom. */
	void OnCameraRotate(const FInputActionValue& Value);
	void OnZoom(const FInputActionValue& Value);
	/** Esc: hand the mouse back for a menu / panic release. */
	void OnToggleCursor(const FInputActionValue& Value);

	void FireOnce();
	void ThrowGrenade();
	void UpdateSprintState();

	int32 MedkitsUsed = 0;

	bool bSprintHeld = false;
	bool bSprinting = false;
	bool bPrecisionAim = false;
	bool bFiring = false;
	float FootstepAccumulator = 0.f;
	float LastGrenadeTime = -100.f;
};
