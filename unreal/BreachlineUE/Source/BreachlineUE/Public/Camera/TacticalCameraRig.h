// Copyright (c) Breachline UE. All rights reserved.
//
// Isometric tactical camera. Deliberately NOT a spring arm on the pawn: an
// actor that owns its own transform so the rig can stay world-aligned while the
// soldier turns, and so "shake/kick" never fights the character controller.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "TacticalCameraRig.generated.h"

class UCameraComponent;
class USpringArmComponent;
class USceneComponent;

UCLASS(Blueprintable)
class BREACHLINEUE_API ATacticalCameraRig : public AActor
{
	GENERATED_BODY()

public:
	ATacticalCameraRig();

	virtual void Tick(float DeltaSeconds) override;

	/** Follow target with damping; Y is forced to ground level for a stable rig. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Camera")
	void SetTargetLocation(const FVector& WorldLocation, bool bSnap = false);

	/** Q/E orbit, in degrees. Full 360° is allowed. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Camera")
	void RotateBy(float DeltaDegrees);

	UFUNCTION(BlueprintCallable, Category = "Breachline|Camera")
	void ResetAzimuth();

	UFUNCTION(BlueprintCallable, Category = "Breachline|Camera")
	void ZoomBy(float DeltaMeters);

	UFUNCTION(BlueprintCallable, Category = "Breachline|Camera")
	void SetDistance(float Meters);

	/** Explosion / near-miss shake. 0..1, decays exponentially. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Camera")
	void AddTrauma(float Amount);

	/** Short positional kick along a world direction (firing feedback). */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Camera")
	void Kick(const FVector& WorldDirection, float AmountMeters);

	/** Movement input is camera-relative: this is the ground-plane basis. */
	UFUNCTION(BlueprintPure, Category = "Breachline|Camera")
	FRotator GetGroundBasis() const { return FRotator(0.f, CurrentAzimuthDeg, 0.f); }

	UFUNCTION(BlueprintPure, Category = "Breachline|Camera")
	float GetAzimuthDegrees() const { return CurrentAzimuthDeg; }

	UFUNCTION(BlueprintPure, Category = "Breachline|Camera")
	UCameraComponent* GetCamera() const { return Camera; }

	/** Screen -> ground plane hit (cursor aiming). Returns false when parallel. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Camera")
	bool ScreenToGround(const FVector2D& ScreenPosition, FVector& OutWorldPoint) const;

	/** Ortho-ish bounds so the rig never leaves the compound. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Camera")
	void SetBounds(float HalfExtentMeters);

	/** Applies the settings' distance and refreshes the projection. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Camera")
	void ApplyProfileDistance(float Meters);

private:
	UPROPERTY(VisibleAnywhere, Category = "Breachline|Camera")
	TObjectPtr<USceneComponent> SceneRoot;

	UPROPERTY(VisibleAnywhere, Category = "Breachline|Camera")
	TObjectPtr<USpringArmComponent> Arm;

	UPROPERTY(VisibleAnywhere, Category = "Breachline|Camera")
	TObjectPtr<UCameraComponent> Camera;

	FVector DesiredTarget = FVector::ZeroVector;
	FVector SmoothedTarget = FVector::ZeroVector;
	FVector ShakeOffset = FVector::ZeroVector;
	FVector KickOffset = FVector::ZeroVector;

	float CurrentAzimuthDeg = 45.f;
	float TargetAzimuthDeg = 45.f;
	float DistanceM = 20.f;
	float Trauma = 0.f;
	float HalfExtentM = 88.f;
	float Time = 0.f;
};
