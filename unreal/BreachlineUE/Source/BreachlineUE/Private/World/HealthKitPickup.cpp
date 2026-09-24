// Copyright (c) Breachline UE. All rights reserved.

#include "World/HealthKitPickup.h"
#include "Character/BreachlinePlayerCharacter.h"
#include "Character/HealthComponent.h"
#include "UI/BreachlinePlayerController.h"
#include "Core/BreachlineBalance.h"
#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "BreachlineUE.h"

using namespace Breachline;

AHealthKitPickup::AHealthKitPickup()
{
	PrimaryActorTick.bCanEverTick = true;

	Collision = CreateDefaultSubobject<USphereComponent>(TEXT("Collision"));
	Collision->InitSphereRadius(MetersToUU(0.45f));
	Collision->SetCollisionEnabled(ECollisionEnabled::NoCollision); // proximity, not physics
	SetRootComponent(Collision);

	// A white box with a green cross is the universal "medkit" read — legible
	// from the isometric height without any texture work.
	if (UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube")))
	{
		Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
		Body->SetupAttachment(Collision);
		Body->SetStaticMesh(Cube);
		Body->SetRelativeScale3D(FVector(0.45f, 0.45f, 0.2f));
		Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);

		Cross = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Cross"));
		Cross->SetupAttachment(Body);
		Cross->SetStaticMesh(Cube);
		Cross->SetRelativeScale3D(FVector(0.22f, 0.75f, 1.35f));
		Cross->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	}

	Glow = CreateDefaultSubobject<UPointLightComponent>(TEXT("Glow"));
	Glow->SetupAttachment(Collision);
	Glow->SetRelativeLocation(FVector(0.f, 0.f, MetersToUU(0.35f)));
	Glow->SetIntensity(1600.f);
	Glow->SetAttenuationRadius(MetersToUU(4.5f));
	Glow->SetLightColor(FLinearColor(0.35f, 1.f, 0.45f));
	Glow->SetCastShadows(false);

	Lifetime = Pickups::Lifetime;
	HealthFraction = Pickups::HealthFraction;
}

void AHealthKitPickup::BeginPlay()
{
	Super::BeginPlay();

	SpawnTime = GetWorld()->GetTimeSeconds();
	DespawnTime = SpawnTime + Lifetime;
	BaseLocation = GetActorLocation();

	// Tint the body/glow so the kit reads green in a grey compound.
	if (Body)
	{
		if (UMaterialInterface* Base = Body->GetMaterial(0))
		{
			if (UMaterialInstanceDynamic* Dynamic = UMaterialInstanceDynamic::Create(Base, this))
			{
				Dynamic->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.92f, 0.98f, 0.92f));
				Body->SetMaterial(0, Dynamic);
			}
		}
	}
	if (Cross)
	{
		if (UMaterialInterface* Base = Cross->GetMaterial(0))
		{
			if (UMaterialInstanceDynamic* Dynamic = UMaterialInstanceDynamic::Create(Base, this))
			{
				Dynamic->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.1f, 0.85f, 0.35f));
				Cross->SetMaterial(0, Dynamic);
			}
		}
	}
}

void AHealthKitPickup::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	UWorld* World = GetWorld();
	if (!World || bCollected) return;

	const float Now = World->GetTimeSeconds();

	// Bob + slow spin so it is spottable at the edge of the frame.
	const float Bob = FMath::Sin(Now * 2.1f) * MetersToUU(Pickups::BobAmplitudeM);
	SetActorLocation(BaseLocation + FVector(0.f, 0.f, Bob + MetersToUU(0.35f)));
	AddActorLocalRotation(FRotator(0.f, Pickups::SpinRate * 60.f * DeltaSeconds, 0.f));

	if (Glow)
	{
		Glow->SetIntensity(1400.f + 500.f * (0.5f + 0.5f * FMath::Sin(Now * 3.2f)));
	}

	// Last two seconds: blink as a "this is about to go" warning.
	if (DespawnTime - Now < 2.f)
	{
		const bool bVisible = FMath::Fmod(Now, 0.3f) < 0.15f;
		SetActorHiddenInGame(!bVisible);
	}

	if (Now >= DespawnTime)
	{
		Destroy();
		return;
	}

	ABreachlinePlayerCharacter* Player = Cast<ABreachlinePlayerCharacter>(UGameplayStatics::GetPlayerPawn(World, 0));
	if (!Player || !Player->IsAlive()) return;

	const float DistanceUU = FVector::Dist(Player->GetActorLocation(), GetActorLocation());
	if (DistanceUU <= MetersToUU(Pickups::PickupRadiusM))
	{
		Collect(Player);
	}
}

void AHealthKitPickup::Collect(ABreachlinePlayerCharacter* Player)
{
	if (bCollected || !Player) return;
	bCollected = true;

	// ApplyMedkit works in hit points: a kit is worth a fraction of MAX health,
	// so a 30% kit is 30 HP at 100 max and 45 HP once max health is upgraded.
	const float MaxHealth = Player->GetHealthComponent() ? Player->GetHealthComponent()->GetMaxHealth() : 100.f;
	const float Healed = Player->ApplyMedkit(MaxHealth * HealthFraction);

	if (ABreachlinePlayerController* PC = Cast<ABreachlinePlayerController>(Player->GetController()))
	{
		PC->NotifyHeal(Healed);
	}

	UE_LOG(LogBreachline, Verbose, TEXT("Medkit collected: +%.1f health (%.0f%% of max)."),
		Healed, HealthFraction * 100.f);

	Destroy();
}
