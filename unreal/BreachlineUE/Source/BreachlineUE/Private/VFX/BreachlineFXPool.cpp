// Copyright (c) Breachline UE. All rights reserved.

#include "VFX/BreachlineFXPool.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	/** Engine primitives: always cooked, never a project dependency. */
	const TCHAR* CylinderPath = TEXT("/Engine/BasicShapes/Cylinder.Cylinder");
	const TCHAR* SpherePath = TEXT("/Engine/BasicShapes/Sphere.Sphere");
	const TCHAR* CubePath = TEXT("/Engine/BasicShapes/Cube.Cube");
	const TCHAR* BaseMaterialPath = TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial");

	constexpr float TracerThicknessUU = 2.2f;
	constexpr float TracerLifeSeconds = 0.07f;
	constexpr int32 FlashLightPoolSize = 6;
}

ABreachlineFXPool::ABreachlineFXPool()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PostPhysics;

	SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
	SetRootComponent(SceneRoot);

	auto MakeISM = [this](const TCHAR* Name, const TCHAR* MeshPath) -> UInstancedStaticMeshComponent*
	{
		UInstancedStaticMeshComponent* ISM = CreateDefaultSubobject<UInstancedStaticMeshComponent>(Name);
		ISM->SetupAttachment(SceneRoot);
		ISM->SetMobility(EComponentMobility::Movable);
		ISM->SetCastShadow(false);
		ISM->bDisableCollision = true;
		ISM->NumCustomDataFloats = 0;
		if (UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, MeshPath))
		{
			ISM->SetStaticMesh(Mesh);
		}
		return ISM;
	};

	Tracers = MakeISM(TEXT("Tracers"), CylinderPath);
	Impacts = MakeISM(TEXT("Impacts"), CubePath);
	Bursts = MakeISM(TEXT("Bursts"), SpherePath);

	// A single additive-ish material instance is shared by every tracer; per-shot
	// colour uses the vertex colour data the basic material reads.
	if (UMaterialInterface* Base = LoadObject<UMaterialInterface>(nullptr, BaseMaterialPath))
	{
		UMaterialInstanceDynamic* TracerMat = UMaterialInstanceDynamic::Create(Base, this);
		if (TracerMat)
		{
			TracerMat->SetVectorParameterValue(TEXT("Color"), FLinearColor(1.f, 0.82f, 0.45f));
			Tracers->SetMaterial(0, TracerMat);
		}
	}
}

void ABreachlineFXPool::BeginPlay()
{
	Super::BeginPlay();

	// Muzzle flash lights: small, short-lived, no shadows (MegaLights handles the
	// bright ones on the explosion path instead).
	for (int32 Index = 0; Index < FlashLightPoolSize; ++Index)
	{
		UPointLightComponent* Light = NewObject<UPointLightComponent>(this,
			*FString::Printf(TEXT("MuzzleLight_%d"), Index));
		Light->SetupAttachment(SceneRoot);
		Light->SetMobility(EComponentMobility::Movable);
		Light->SetAttenuationRadius(400.f);
		Light->SetIntensity(0.f);
		Light->SetLightColor(FLinearColor(1.f, 0.75f, 0.45f));
		Light->SetCastShadows(false);
		Light->RegisterComponent();
		FlashLights.Add(Light);
	}
}

void ABreachlineFXPool::AddTracer(
	const FVector& Start, const FVector& End, const FLinearColor& Color, float ThicknessUU, float LifeSeconds)
{
	if (!Tracers || DensityScale <= 0.f) return;

	const FVector Delta = End - Start;
	const float Length = Delta.Size();
	if (Length < 1.f) return;

	// Basic cylinder is 100 uu tall along Z: scale Z to the shot length and
	// orient Z onto the shot direction.
	const FQuat Rotation = FRotationMatrix::MakeFromZ(Delta).ToQuat();
	const FVector Scale(ThicknessUU / 50.f * 0.5f, ThicknessUU / 50.f * 0.5f, Length / 100.f);
	const FTransform Xform(Rotation, Start + Delta * 0.5f, Scale);

	const int32 Index = Tracers->AddInstance(Xform, /*bWorldSpace*/ true);
	TracerSlots.Add({ Index, GetWorld()->GetTimeSeconds() + FMath::Max(0.02f, LifeSeconds) });
	(void)Color; // per-instance colour hooks in when the tracer material is authored
}

void ABreachlineFXPool::AddMuzzleFlash(
	const FVector& Location, const FVector& Direction, const FLinearColor& Color, float Scale)
{
	if (DensityScale <= 0.f || FlashLights.Num() == 0) return;

	UPointLightComponent* Light = FlashLights[NextFlashLight];
	NextFlashLight = (NextFlashLight + 1) % FlashLights.Num();
	if (!Light) return;

	Light->SetWorldLocation(Location + Direction.GetSafeNormal() * 30.f);
	Light->SetLightColor(Color);
	Light->SetIntensity(6000.f * FMath::Clamp(Scale, 0.4f, 2.f) * DensityScale);
	Light->SetAttenuationRadius(500.f * FMath::Clamp(Scale, 0.5f, 2.f));
	// Light decay is a courtesy: the pool reuses lights, so a long tail would
	// bleed into the next shot.
	Light->SetVisibility(true);
}

void ABreachlineFXPool::AddImpact(const FVector& Location, const FVector& Normal, bool bFlesh, const FLinearColor& Color)
{
	if (!Impacts || DensityScale <= 0.f) return;

	const int32 Count = bFlesh ? 2 : 4;
	for (int32 Index = 0; Index < Count; ++Index)
	{
		const FVector Jitter(
			FMath::FRandRange(-12.f, 12.f),
			FMath::FRandRange(-12.f, 12.f),
			FMath::FRandRange(-6.f, 18.f));
		const FQuat Rot = FRotationMatrix::MakeFromZ(Normal).ToQuat() * FQuat(FVector::UpVector, FMath::FRandRange(0.f, PI));
		const FVector Scale = bFlesh ? FVector(0.05f) : FVector(0.035f);
		Impacts->AddInstance(FTransform(Rot, Location + Jitter, Scale), true);
	}
	(void)Color;
}

void ABreachlineFXPool::AddBurst(const FVector& Location, float RadiusMeters, const FLinearColor& Color, float LifeSeconds)
{
	if (!Bursts || DensityScale <= 0.f) return;

	const float RadiusUU = RadiusMeters * BREACHLINE_CM_PER_M;
	const int32 Index = Bursts->AddInstance(FTransform(FRotator::ZeroRotator, Location, FVector(0.01f)), true);
	BurstSlots.Add({ Index, GetWorld()->GetTimeSeconds() + LifeSeconds, GetWorld()->GetTimeSeconds(), RadiusUU });
	(void)Color;
}

void ABreachlineFXPool::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	UWorld* World = GetWorld();
	if (!World) return;
	const double Now = World->GetTimeSeconds();

	// Retire tracers (front-swap so the loop stays O(n) with no reallocation).
	for (int32 Index = TracerSlots.Num() - 1; Index >= 0; --Index)
	{
		if (Now >= TracerSlots[Index].ExpireAt)
		{
			if (Tracers && TracerSlots[Index].InstanceIndex != INDEX_NONE)
			{
				Tracers->RemoveInstance(TracerSlots[Index].InstanceIndex);
			}
			TracerSlots.RemoveAtSwap(Index, 1, EAllowShrinking::No);
		}
	}

	// Animate bursts: expand and fade over their life.
	for (int32 Index = BurstSlots.Num() - 1; Index >= 0; --Index)
	{
		FBreachlineBurstSlot& Slot = BurstSlots[Index];
		const float Life = float(Slot.ExpireAt - Slot.SpawnedAt);
		const float T = Life > 0.f ? float((Now - Slot.SpawnedAt) / Life) : 1.f;
		if (T >= 1.f)
		{
			if (Bursts && Slot.InstanceIndex != INDEX_NONE)
			{
				Bursts->RemoveInstance(Slot.InstanceIndex);
			}
			BurstSlots.RemoveAtSwap(Index, 1, EAllowShrinking::No);
			continue;
		}
		if (Bursts && Slot.InstanceIndex != INDEX_NONE)
		{
			const float Radius = Slot.RadiusUU * (0.15f + 0.85f * T);
			FTransform Xform;
			Bursts->GetInstanceTransform(Slot.InstanceIndex, Xform, true);
			Xform.SetScale3D(FVector(Radius / 50.f));
			Bursts->UpdateInstanceTransform(Slot.InstanceIndex, Xform, true, true, true);
		}
	}

	// Muzzle lights fade every frame: cheap, and keeps flashes snappy.
	for (UPointLightComponent* Light : FlashLights)
	{
		if (!Light) continue;
		const float Intensity = Light->Intensity;
		if (Intensity > 0.f)
		{
			Light->SetIntensity(FMath::Max(0.f, Intensity - DeltaSeconds * 45000.f));
		}
	}
}
