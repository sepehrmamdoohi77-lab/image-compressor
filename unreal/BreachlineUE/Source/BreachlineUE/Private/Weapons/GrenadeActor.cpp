// Copyright (c) Breachline UE. All rights reserved.

#include "Weapons/GrenadeActor.h"
#include "Combat/BreachlineCombatLibrary.h"
#include "UI/BreachlinePlayerController.h"
#include "Core/BreachlineBalance.h"
#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "GameFramework/ProjectileMovementComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "BreachlineUE.h"

using namespace Breachline;

ABreachlineGrenade::ABreachlineGrenade()
{
	PrimaryActorTick.bCanEverTick = true;

	Collision = CreateDefaultSubobject<USphereComponent>(TEXT("Collision"));
	Collision->InitSphereRadius(MetersToUU(0.12f));
	Collision->SetCollisionProfileName(TEXT("PhysicsActor"));
	Collision->SetCollisionResponseToChannel(ECC_Pawn, ECR_Ignore); // rolls past friends
	SetRootComponent(Collision);

	Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
	Body->SetupAttachment(Collision);
	Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Body->SetCastShadow(true);
	if (UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere")))
	{
		Body->SetStaticMesh(Mesh);
		Body->SetRelativeScale3D(FVector(0.24f));
	}

	Blink = CreateDefaultSubobject<UPointLightComponent>(TEXT("Blink"));
	Blink->SetupAttachment(Collision);
	Blink->SetIntensity(2500.f);
	Blink->SetAttenuationRadius(260.f);
	Blink->SetLightColor(FLinearColor(1.f, 0.25f, 0.2f));
	Blink->SetCastShadows(false);

	Movement = CreateDefaultSubobject<UProjectileMovementComponent>(TEXT("Movement"));
	Movement->UpdatedComponent = Collision;
	Movement->bShouldBounce = true;
	Movement->Bounciness = 0.35f;
	Movement->Friction = 0.6f;
	Movement->ProjectileGravityScale = 1.f;
	Movement->bRotationFollowsVelocity = true;

	FuseSeconds = Damage::GrenadeFuseS;
}

void ABreachlineGrenade::BeginPlay()
{
	Super::BeginPlay();
	ThrowTime = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f;
}

void ABreachlineGrenade::Launch(const FVector& Velocity, AActor* Thrower, float InRadiusMeters, float InDamage)
{
	ThrowerActor = Thrower;
	RadiusMeters = InRadiusMeters;
	Damage = InDamage;

	if (Thrower)
	{
		IgnoreActors.Add(Thrower);
	}
	if (Movement)
	{
		Movement->Velocity = Velocity;
		Movement->Activate(true);
	}
}

void ABreachlineGrenade::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	UpdateBlink();

	UWorld* World = GetWorld();
	if (!World) return;

	if (World->GetTimeSeconds() - ThrowTime >= FuseSeconds)
	{
		Explode();
	}
}

void ABreachlineGrenade::UpdateBlink()
{
	if (!Blink) return;

	const UWorld* World = GetWorld();
	if (!World) return;

	// Blink rate accelerates from a lazy 4 Hz to a frantic 16 Hz, which is the
	// clearest possible "move now" telegraph without any UI.
	const float Elapsed = World->GetTimeSeconds() - ThrowTime;
	const float Progress = FMath::Clamp(Elapsed / FMath::Max(0.1f, FuseSeconds), 0.f, 1.f);
	const float Rate = FMath::Lerp(4.f, 16.f, Progress);
	const float BlinkPhase = FMath::Sin(Elapsed * Rate * 2.f * PI);
	Blink->SetIntensity(BlinkPhase > 0.f ? 2800.f * (0.6f + 0.7f * Progress) : 300.f);
}

void ABreachlineGrenade::Explode()
{
	if (bExploded) return;
	bExploded = true;

	UWorld* World = GetWorld();
	if (!World) return;

	TArray<AActor*> Ignore;
	Ignore.Add(this);
	if (ThrowerActor) Ignore.Add(ThrowerActor);

	UBreachlineCombatLibrary::ApplyExplosion(World, GetActorLocation(), RadiusMeters, Damage, ThrowerActor, Ignore);

	// Presentation: shake and shove the camera, scaled by distance. The damage was
	// already resolved above, so this cannot affect the outcome.
	for (FConstPlayerControllerIterator It = World->GetPlayerControllerIterator(); It; ++It)
	{
		if (ABreachlinePlayerController* PC = Cast<ABreachlinePlayerController>(It->Get()))
		{
			PC->NotifyExplosion(GetActorLocation(), RadiusMeters);
		}
	}

	Destroy();
}
