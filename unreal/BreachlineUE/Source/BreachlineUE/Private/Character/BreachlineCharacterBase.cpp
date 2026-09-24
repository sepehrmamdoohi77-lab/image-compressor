// Copyright (c) Breachline UE. All rights reserved.

#include "Character/BreachlineCharacterBase.h"
#include "Character/HealthComponent.h"
#include "Core/BreachlineBalance.h"
#include "Components/CapsuleComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Engine/World.h"
#include "BreachlineUE.h"

using namespace Breachline;

ABreachlineCharacterBase::ABreachlineCharacterBase()
{
	PrimaryActorTick.bCanEverTick = true;

	UCapsuleComponent* Capsule = GetCapsuleComponent();
	Capsule->InitCapsuleSize(
		MetersToUU(World::CharacterRadiusM),
		MetersToUU(World::CharacterHeightM) * 0.5f);
	Capsule->SetCollisionProfileName(TEXT("BreachlineCharacter"));

	// Movement defaults: tactical shooter pacing, no air control, no instant turns.
	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->MaxWalkSpeed = MetersToUU(Player::WalkSpeedMps);
	Move->MaxAcceleration = MetersToUU(Player::Accel * 0.4f);
	Move->BrakingDecelerationWalking = MetersToUU(Player::Decel * 0.5f);
	Move->GroundFriction = 8.f;
	Move->bOrientRotationToMovement = true;
	Move->RotationRate = FRotator(0.f, 480.f, 0.f);
	Move->AirControl = 0.05f;
	Move->SetWalkableFloorAngle(44.f);
	Move->MaxStepHeight = 45.f;
	Move->NavAgentProps.bCanCrouch = true;
	Move->SetCrouchedHalfHeight(MetersToUU(1.0f) * 0.5f + MetersToUU(0.6f));

	// The camera is a separate rig, so the pawn never rotates with the mouse.
	bUseControllerRotationYaw = false;
	bUseControllerRotationPitch = false;
	bUseControllerRotationRoll = false;

	Health = CreateDefaultSubobject<UHealthComponent>(TEXT("Health"));

	// Blockout-friendly: a capsule with no mesh still plays the game.
	GetMesh()->SetCollisionProfileName(TEXT("NoCollision"));
	GetMesh()->SetRelativeLocation(FVector(0.f, 0.f, -MetersToUU(World::CharacterHeightM) * 0.5f));
	GetMesh()->SetRelativeRotation(FRotator(0.f, -90.f, 0.f));
}

void ABreachlineCharacterBase::BeginPlay()
{
	Super::BeginPlay();

	if (Health)
	{
		Health->OnDied.AddDynamic(this, &ABreachlineCharacterBase::HandleDeathFromHealth);
	}

	FallRollDeg = FMath::FRandRange(-38.f, 38.f);
}

void ABreachlineCharacterBase::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
}

float ABreachlineCharacterBase::GetTimeSinceDeath() const
{
	const UWorld* World = GetWorld();
	if (!World || DeathTime < 0.f) return -1.f;
	return World->GetTimeSeconds() - DeathTime;
}

FVector ABreachlineCharacterBase::GetMuzzleLocation() const
{
	if (const USkeletalMeshComponent* Mesh = GetMesh())
	{
		if (Mesh->DoesSocketExist(MuzzleSocketName))
		{
			return Mesh->GetSocketLocation(MuzzleSocketName);
		}
	}
	// Blockout / no-mesh path: offset in the character's own space so the tracer
	// still leaves the barrel area rather than the navel.
	return GetActorTransform().TransformPosition(MuzzleFallbackOffset);
}

FVector ABreachlineCharacterBase::GetChestLocation() const
{
	return GetActorLocation() + FVector(0.f, 0.f, GetCapsuleComponent()
		? GetCapsuleComponent()->GetScaledCapsuleHalfHeight() * 0.55f
		: MetersToUU(1.2f));
}

void ABreachlineCharacterBase::SetAimDirection(const FVector& WorldDirection)
{
	const FVector Dir = WorldDirection.GetSafeNormal2D();
	if (!Dir.IsNearlyZero())
	{
		AimDirection = Dir;
	}
}

void ABreachlineCharacterBase::HandleDeath(AActor* Killer)
{
	if (DeathTime >= 0.f) return; // already dead: never double-fire

	DeathTime = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f;

	// Stop fighting immediately.
	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		Move->StopMovementImmediately();
		Move->DisableMovement();
	}
	GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	// Ragdoll when the project has a physics asset (production characters);
	// otherwise the Animation Blueprint drives a procedural two-stage collapse
	// (impact recoil -> fold -> topple) from the Dead state.
	if (bUseRagdoll && GetMesh() && GetMesh()->GetPhysicsAsset())
	{
		GetMesh()->SetCollisionProfileName(TEXT("Ragdoll"));
		GetMesh()->SetAllBodiesSimulatePhysics(true);
		GetMesh()->SetSimulatePhysics(true);
		GetMesh()->WakeAllRigidBodies();
		// A little push in the killer's direction so bodies fall away from fire.
		if (Killer)
		{
			const FVector Impulse = (GetActorLocation() - Killer->GetActorLocation()).GetSafeNormal()
				* MetersToUU(2.2f) + FVector(0.f, 0.f, MetersToUU(1.1f));
			GetMesh()->AddImpulse(Impulse, NAME_None, /*bVelChange*/ true);
		}
	}

	OnCharacterDied.Broadcast(this, Killer);
}

void ABreachlineCharacterBase::HandleDeathFromHealth(AActor* Victim, AActor* Killer)
{
	HandleDeath(Killer);
}
