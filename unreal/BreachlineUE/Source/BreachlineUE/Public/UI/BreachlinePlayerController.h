// Copyright (c) Breachline UE. All rights reserved.
//
// Owns the view: creates the isometric rig, keeps it on the operator, and
// computes the two pieces of information the HUD cannot work out for itself —
// the camera-relative cursor point and the THREAT picture (who is aware of the
// player, from where, at what range). Everything else the HUD draws comes
// straight out of the gameplay systems.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "Core/BreachlineTypes.h"
#include "BreachlinePlayerController.generated.h"

class ATacticalCameraRig;
class ABreachlinePlayerCharacter;
class ABreachlineEnemyCharacter;
class UInputMappingContext;
class ABreachlineGameMode;

/** What the player last shot at, for the hit marker + damage numbers. */
USTRUCT()
struct FBreachlineHitMarker
{
	GENERATED_BODY()

	UPROPERTY() bool bHeadshot = false;
	UPROPERTY() bool bKill = false;
	UPROPERTY() float Time = -1000.f;
	UPROPERTY() int32 Damage = 0;
};

UCLASS()
class BREACHLINEUE_API ABreachlinePlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	ABreachlinePlayerController();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void OnPossess(APawn* InPawn) override;

	// --- input plumbing ------------------------------------------------------
	/** The single runtime mapping context, created once and shared with the pawn. */
	UFUNCTION(BlueprintPure, Category = "Breachline|Input")
	UInputMappingContext* GetInputContext() const { return InputContext; }

	// --- camera --------------------------------------------------------------
	UFUNCTION(BlueprintPure, Category = "Breachline|Camera")
	ATacticalCameraRig* GetRig() const { return Rig; }

	UFUNCTION(BlueprintCallable, Category = "Breachline|Camera")
	void RotateCamera(float DeltaDegrees);

	UFUNCTION(BlueprintCallable, Category = "Breachline|Camera")
	void ZoomCamera(float DeltaMeters);

	/** Ground point under the mouse cursor (cursor aiming, web-build style). */
	UFUNCTION(BlueprintPure, Category = "Breachline|Camera")
	bool GetCursorGroundPoint(FVector& OutPoint) const;

	/** Where the operator is currently aiming, in world space (cursor point). */
	UFUNCTION(BlueprintPure, Category = "Breachline|Camera")
	FVector GetAimPointWorld() const { return CursorGroundPoint; }

	UFUNCTION(BlueprintCallable, Category = "Breachline|Input")
	void ToggleCursorMode();

	// --- feedback notifications (called by weapons, AI and combat) ------------
	/** Recoil kick + shake for a player shot. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Feedback")
	void NotifyWeaponFired(const FBreachlineWeaponDef& Weapon);

	/** Origin + spread, so the HUD can size its dynamic reticle. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Feedback")
	void NotifySpread(float SpreadRadians);

	/** Damage applied to an enemy: hit marker, damage number, kill banner. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Feedback")
	void NotifyHitConfirmed(AActor* Victim, bool bHeadshot, bool bKill, int32 Damage);

	/**
	 * One resolved player bullet: hit marker, damage number and the kill feed.
	 * Scoring (score/headshots/kills) is claimed by the combat library the moment
	 * the victim dies, so this is presentation only.
	 */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Feedback")
	void NotifyShotResolved(const FBulletResult& Report);

	/** A round cracked past the player's head. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Feedback")
	void NotifyNearMiss(float Meters);

	/** The player took damage: red flash + directional indicator. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Feedback")
	void NotifyPlayerDamaged(float Amount, AActor* Causer);

	UFUNCTION(BlueprintCallable, Category = "Breachline|Feedback")
	void NotifyExplosion(const FVector& Location, float RadiusMeters);

	/** Round transition: full heal + full ammo, with an on-screen banner. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Feedback")
	void NotifyResupply();

	UFUNCTION(BlueprintCallable, Category = "Breachline|Feedback")
	void NotifyHeal(float Amount);

	UFUNCTION(BlueprintCallable, Category = "Breachline|Feedback")
	void NotifyScore(int32 Amount, const FText& Label);

	UFUNCTION(BlueprintCallable, Category = "Breachline|Feedback")
	void NotifyWaveIncoming(int32 Enemies);

	// --- HUD data ------------------------------------------------------------
	UFUNCTION(BlueprintPure, Category = "Breachline|HUD")
	FHudSnapshot GetSnapshot() const { return Snapshot; }

	/** Rebuilt every frame; the HUD reads it in DrawHUD(). */
	void BuildSnapshot();

	UFUNCTION(BlueprintPure, Category = "Breachline|HUD")
	FBreachlineHitMarker GetHitMarker() const { return HitMarker; }

	UFUNCTION(BlueprintPure, Category = "Breachline|HUD")
	float GetThreatPulse() const;

	/** True when an aware hostile is tracking the player: radar lights up. */
	UFUNCTION(BlueprintPure, Category = "Breachline|HUD")
	bool IsDangerActive() const { return Snapshot.ThreatLevel > Threats::AwareThreshold; }

	/** BlueprintCallable, not BlueprintPure: it only produces output parameters. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|HUD")
	void GetReticlePoints(TArray<FVector2D>& OutPoints) const;

	/** Last damage taken, as (world direction, seconds ago) for the indicator. */
	bool GetDamageDirection(FVector& OutDirection, float& OutAge) const;

	/** Screen-space project of a world point, in pixels. */
	UFUNCTION(BlueprintPure, Category = "Breachline|HUD")
	bool ProjectWorldToScreenPixels(const FVector& World, FVector2D& OutPixels) const;

protected:
	/** Bound to the possessed pawn's health: damage flash, direction, no-hit bonus. */
	UFUNCTION()
	void HandlePlayerHealthChanged(float NewHealth, float Delta, AActor* Instigator);

	void RefreshThreatPicture(float DeltaSeconds);
	void SpawnRig();
	void ApplyProfile();
	ABreachlineGameMode* GetBreachlineGameMode() const;

	UPROPERTY() TObjectPtr<UInputMappingContext> InputContext = nullptr;
	UPROPERTY() TObjectPtr<ATacticalCameraRig> Rig = nullptr;
	UPROPERTY() TObjectPtr<ABreachlinePlayerCharacter> Player = nullptr;

	UPROPERTY() FHudSnapshot Snapshot;
	UPROPERTY() FBreachlineHitMarker HitMarker;

	/** Hostiles the radar is currently tracking (rebuilt each frame). */
	UPROPERTY() TArray<FThreatContact> Threats;

	float ReticleSpreadRadians = 0.01f;
	float ThreatRefreshAccumulator = 0.f;
	float LastThreatBeepTime = -1000.f;
	float ResupplyFade = 0.f;
	float HealFade = 0.f;
	float HealAmount = 0.f;
	float ScoreFade = 0.f;
	FText ScoreLabel;
	FVector LastDamageDirection = FVector::ZeroVector;
	float LastDamageTime = -1000.f;
	FVector CursorGroundPoint = FVector::ZeroVector;
	bool bCursorFree = false;
};
