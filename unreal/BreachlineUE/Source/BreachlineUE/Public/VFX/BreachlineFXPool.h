// Copyright (c) Breachline UE. All rights reserved.
//
// Pooled, asset-free combat VFX. Every effect is an instance in a fixed pool, so
// sustained fire allocates nothing and the frame cost is flat:
//
//   tracers  -> one InstancedStaticMeshComponent of thin cylinders
//   muzzle   -> a small pool of point lights (MegaLights-friendly)
//   impacts  -> one ISM of small sparks/debris chunks
//   bursts   -> one ISM of expanding spheres (explosions, shockwaves)
//
// When the project has Niagara systems assigned in Project Settings, the
// subsystem spawns those instead and this pool stays idle — same call site, so
// swapping in authored VFX is a settings change.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Core/BreachlineTypes.h"
#include "BreachlineFXPool.generated.h"

class USceneComponent;

class UInstancedStaticMeshComponent;
class UPointLightComponent;

USTRUCT()
struct FBreachlineTracerSlot
{
	GENERATED_BODY()
	int32 InstanceIndex = INDEX_NONE;
	double ExpireAt = 0.0;
};

USTRUCT()
struct FBreachlineBurstSlot
{
	GENERATED_BODY()
	int32 InstanceIndex = INDEX_NONE;
	double ExpireAt = 0.0;
	double SpawnedAt = 0.0;
	float RadiusUU = 100.f;
};

UCLASS(NotBlueprintable)
class BREACHLINEUE_API ABreachlineFXPool : public AActor
{
	GENERATED_BODY()

public:
	ABreachlineFXPool();

	virtual void Tick(float DeltaSeconds) override;

	void AddTracer(const FVector& Start, const FVector& End, const FLinearColor& Color, float ThicknessUU, float LifeSeconds);
	void AddMuzzleFlash(const FVector& Location, const FVector& Direction, const FLinearColor& Color, float Scale);
	void AddImpact(const FVector& Location, const FVector& Normal, bool bFlesh, const FLinearColor& Color);
	void AddBurst(const FVector& Location, float RadiusMeters, const FLinearColor& Color, float LifeSeconds);

	/** Caps how many effects are drawn (quality tier / accessibility). */
	void SetDensityScale(float InScale) { DensityScale = FMath::Clamp(InScale, 0.f, 1.f); }

protected:
	virtual void BeginPlay() override;

private:
	UPROPERTY(VisibleAnywhere) TObjectPtr<USceneComponent> SceneRoot;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> Tracers;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> Impacts;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> Bursts;
	UPROPERTY(VisibleAnywhere) TArray<TObjectPtr<UPointLightComponent>> FlashLights;

	UPROPERTY() TArray<FBreachlineTracerSlot> TracerSlots;
	UPROPERTY() TArray<FBreachlineBurstSlot> BurstSlots;

	int32 NextFlashLight = 0;
	float DensityScale = 1.f;
};
