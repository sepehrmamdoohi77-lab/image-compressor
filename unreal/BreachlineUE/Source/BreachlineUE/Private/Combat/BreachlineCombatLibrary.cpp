// Copyright (c) Breachline UE. All rights reserved.

#include "Combat/BreachlineCombatLibrary.h"
#include "Character/BreachlineEnemyCharacter.h"
#include "AI/TacticalAIController.h"
#include "Core/ProgressionSubsystem.h"
#include "UI/BreachlinePlayerController.h"
#include "Character/HealthComponent.h"
#include "Combat/DamageModel.h"
#include "Core/BreachlineBalance.h"
#include "VFX/BreachlineFXSubsystem.h"
#include "Audio/BreachlineAudioSubsystem.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/World.h"
#include "Engine/OverlapResult.h"
#include "PhysicalMaterials/PhysicalMaterial.h"
#include "CollisionQueryParams.h"
#include "BreachlineUE.h"

using namespace Breachline;

namespace
{
	/** Socket names that count as a head hit on the humanoid rig. */
	bool IsHeadBone(const FName Bone)
	{
		static const FName Head(TEXT("head"));
		static const FName Neck(TEXT("neck"));
		const FString Name = Bone.ToString().ToLower();
		return Name.Contains(TEXT("head")) || Name.Contains(TEXT("neck")) || Name == TEXT("neck_01");
	}

	bool IsLimbBone(const FName Bone)
	{
		const FString Name = Bone.ToString().ToLower();
		return Name.Contains(TEXT("leg")) || Name.Contains(TEXT("foot"))
			|| Name.Contains(TEXT("hand")) || Name.Contains(TEXT("arm"))
			|| Name.Contains(TEXT("clavicle"));
	}
}

namespace
{
	/**
	 * Award a kill exactly once per victim. Several pellets can land on the same
	 * corpse in one frame, so this uses the health component's claim latch rather
	 * than testing IsDead(). Binds the score, the headshot bonus and the HUD banner
	 * in the one place that knows both who died and how.
	 */
	void AwardKill(UWorld* World, AActor* Victim, AActor* Instigator, bool bGrenade)
	{
		if (!World || !Victim) return;

		UHealthComponent* Health = UBreachlineCombatLibrary::FindHealth(Victim);
		if (!Health || !Health->IsDead() || !Health->TryClaimKillAward()) return;

		const ABreachlineEnemyCharacter* Enemy = Cast<ABreachlineEnemyCharacter>(Victim);
		const int32 ScoreValue = Enemy ? Enemy->GetScoreValue() : 100;
		const bool bHeadshot = Health->GetLastHitZone() == EHitZone::Head;

		int32 Gained = 0;
		if (UProgressionSubsystem* Progression = World->GetSubsystem<UProgressionSubsystem>())
		{
			Gained = Progression->OnEnemyKilled(ScoreValue, bHeadshot, bGrenade);
		}

		if (ABreachlinePlayerController* PC = Cast<ABreachlinePlayerController>(
			Instigator ? Instigator->GetInstigatorController() : nullptr))
		{
			PC->NotifyScore(Gained, FText::FromString(
				bGrenade ? TEXT("GRENADE KILL") : (bHeadshot ? TEXT("HEADSHOT KILL") : TEXT("KILL"))));
		}
	}
}

UHealthComponent* UBreachlineCombatLibrary::FindHealth(AActor* Actor)
{
	return Actor ? Actor->FindComponentByClass<UHealthComponent>() : nullptr;
}

FVector UBreachlineCombatLibrary::PerturbDirection(const FVector& Direction, float SpreadRadians, const FBreachlineRng& Rng)
{
	if (SpreadRadians <= KINDA_SMALL_NUMBER)
	{
		return Direction.GetSafeNormal();
	}

	const FVector Dir = Direction.GetSafeNormal();
	// Build an orthonormal basis and offset inside the cone. A square-root on
	// the radius keeps the distribution even across the disc instead of
	// clustering in the middle.
	FVector Right = FVector::CrossProduct(Dir, FVector::UpVector);
	if (Right.SizeSquared() < KINDA_SMALL_NUMBER)
	{
		Right = FVector::CrossProduct(Dir, FVector::ForwardVector);
	}
	Right.Normalize();
	const FVector Up = FVector::CrossProduct(Right, Dir).GetSafeNormal();

	const float Angle = Rng.Next01() * 2.f * PI;
	const float Radius = FMath::Sqrt(Rng.Next01()) * SpreadRadians;
	const float OffsetX = FMath::Cos(Angle) * Radius;
	const float OffsetY = FMath::Sin(Angle) * Radius;

	return (Dir + Right * OffsetX + Up * OffsetY).GetSafeNormal();
}

FHitResult UBreachlineCombatLibrary::TraceBullet(
	UWorld* World, const FVector& Start, const FVector& Direction, float RangeMeters, AActor* IgnoreActor)
{
	FHitResult Hit;
	if (!World) return Hit;

	const FVector End = Start + Direction.GetSafeNormal() * MetersToUU(RangeMeters);

	FCollisionQueryParams Params(SCENE_QUERY_STAT(BreachlineBullet), /*bTraceComplex*/ true);
	if (IgnoreActor)
	{
		Params.AddIgnoredActor(IgnoreActor);
	}

	// The Weapon channel blocks on characters and cover, ignores decals/foliage.
	World->LineTraceSingleByChannel(Hit, Start, End, ECollisionChannel::ECC_GameTraceChannel1, Params);
	return Hit;
}

EHitZone UBreachlineCombatLibrary::ClassifyHitZone(const FHitResult& Hit, AActor* Target)
{
	if (!Target) return EHitZone::Torso;

	const FName Bone = Hit.BoneName;
	if (!Bone.IsNone())
	{
		if (IsHeadBone(Bone)) return EHitZone::Head;
		if (IsLimbBone(Bone)) return EHitZone::Legs;
	}

	// No bone data (blockout capsule / static target): fall back to height, which
	// is what the web prototype used and keeps the rules identical.
	FVector Origin, Extent;
	Target->GetActorBounds(false, Origin, Extent);
	const float FeetZ = Origin.Z - Extent.Z;
	const float Height = FMath::Max(50.f, Extent.Z * 2.f);
	const float LateralOffset = FVector::Dist2D(Hit.ImpactPoint, Target->GetActorLocation()) / MetersToUU(0.5f);

	return ZoneFromHeight(Hit.ImpactPoint.Z, FeetZ, Height, LateralOffset);
}

bool UBreachlineCombatLibrary::ResolveShot(UWorld* World, const FBreachlineShotContext& Context)
{
	if (!World || !Context.Instigator) return false;

	/** Counts a trigger pull that connected with a living target (accuracy stat). */
	bool bAnyHit = false;

	UBreachlineFXSubsystem* FX = World->GetSubsystem<UBreachlineFXSubsystem>();
	UBreachlineAudioSubsystem* Audio = World->GetSubsystem<UBreachlineAudioSubsystem>();

	if (FX)
	{
		FX->SpawnMuzzleFlash(Context.MuzzleLocation, Context.AimDirection, Context.Weapon, Context.bEnemyShot);
	}

	// The shot event is what the AI hears; sprinting/walking noise is separate.
	if (Audio)
	{
		Audio->PlayShot(Context.Weapon, Context.MuzzleLocation, Context.bEnemyShot);
	}

	FBreachlineRng Rng = FBreachlineRng::Seeded(
		FMath::Rand() ^ static_cast<int32>(World->GetTimeSeconds() * 1000.f));

	// Deliberate near miss: shift the whole cone sideways/up so the round passes
	// close to the target instead of hitting it. Applied once, not per pellet.
	FVector BaseDir = Context.AimDirection.GetSafeNormal();
	if (Context.bDeliberateMiss)
	{
		FVector Right = FVector::CrossProduct(BaseDir, FVector::UpVector).GetSafeNormal();
		if (Right.IsNearlyZero())
		{
			Right = FVector::RightVector;
		}
		BaseDir = (BaseDir
			+ Right * (Context.MissLateralM / FMath::Max(4.f, Context.Weapon.Range * 0.5f))
			+ FVector::UpVector * (Context.MissVerticalM / FMath::Max(4.f, Context.Weapon.Range * 0.5f))).GetSafeNormal();
	}

	for (int32 Pellet = 0; Pellet < FMath::Max(1, Context.Pellets); ++Pellet)
	{
		// Shotguns pattern wider per pellet; single-projectile guns use the
		// computed spread as-is.
		const float PelletSpread = Context.Pellets > 1
			? Context.SpreadRadians * 1.6f
			: Context.SpreadRadians;
		const FVector Dir = PerturbDirection(BaseDir, PelletSpread, Rng);

		const FHitResult Hit = TraceBullet(World, Context.MuzzleLocation, Dir, Context.Weapon.Range, Context.Instigator);
		const FVector EndPoint = Hit.bBlockingHit
			? Hit.ImpactPoint
			: Context.MuzzleLocation + Dir * MetersToUU(Context.Weapon.Range);

		if (FX)
		{
			FX->SpawnTracer(Context.MuzzleLocation, EndPoint, Context.Weapon, Context.bEnemyShot);
		}

		if (!Hit.bBlockingHit) continue;

		AActor* HitActor = Hit.GetActor();
		UHealthComponent* Health = FindHealth(HitActor);

		if (FX)
		{
			FX->SpawnImpact(Hit, /*bFlesh*/ Health != nullptr, Context.Weapon, Context.bEnemyShot);
		}

		if (!Health) continue;

		const float DistanceM = FVector::Dist(Context.MuzzleLocation, Hit.ImpactPoint) / MetersToUU(1.f);

		FDamageInput Input;
		Input.BaseDamage = Context.Weapon.Damage;
		Input.HeadshotMult = Context.Weapon.HeadshotMult;
		Input.Zone = ClassifyHitZone(Hit, HitActor);
		Input.DistanceM = DistanceM;
		Input.FalloffStartM = Context.Weapon.FalloffStart;
		Input.FalloffEndM = Context.Weapon.FalloffEnd;
		Input.MinDamageMult = Context.Weapon.FalloffMin;
		Input.ArmorDamageMult = Context.Weapon.ArmorDamageMult;

		bAnyHit = true;

		FBulletResult Report;
		Report.bHit = true;
		Report.Zone = Input.Zone;
		Report.ImpactPoint = Hit.ImpactPoint;
		Report.ImpactNormal = Hit.ImpactNormal;
		Report.HitActor = HitActor;

		const float Applied = Health->ApplyBullet(Report, Context.Instigator, Input);
		Report.Damage = Applied;
		Report.bKilled = Health->IsDead();

		// Tell the victim's brain it is being shot at: suppression, relocation and
		// the "who is over there" update all key off this.
		if (const ATacticalAIController* VictimAI = Cast<ATacticalAIController>(HitActor->GetInstigatorController()))
		{
			const_cast<ATacticalAIController*>(VictimAI)->NotifyDamaged(Applied, Context.Instigator);
		}

		// Player-side hits drive hitmarkers, damage numbers and the kill pipeline.
		// Enemy-on-enemy damage still resolves, it just is not scored.
		if (!Context.bEnemyShot)
		{
			if (ABreachlinePlayerController* PC =
				Cast<ABreachlinePlayerController>(Context.Instigator->GetInstigatorController()))
			{
				PC->NotifyShotResolved(Report);
			}
			AwardKill(World, HitActor, Context.Instigator, /*bGrenade*/ false);
		}
	}

	// Firing kick on the player's own rig (hostiles have no camera).
	if (!Context.bEnemyShot)
	{
		if (ABreachlinePlayerController* PC =
			Cast<ABreachlinePlayerController>(Context.Instigator->GetInstigatorController()))
		{
			PC->NotifyWeaponFired(Context.Weapon);
		}
	}

	return bAnyHit;
}

bool UBreachlineCombatLibrary::ResolveEnemyShot(
	UWorld* World,
	AActor* Shooter,
	const FBreachlineWeaponDef& Weapon,
	const FVector& MuzzleLocation,
	AActor* Target,
	float Accuracy,
	float AccuracyMult,
	const FBreachlineRng& Rng,
	FEnemyShotPlan& OutPlan,
	float& OutNearMissMeters)
{
	OutPlan = FEnemyShotPlan();
	OutNearMissMeters = TNumericLimits<float>::Max();
	if (!World || !Shooter || !Target) return false;

	const float DistanceM = FVector::Dist(MuzzleLocation, Target->GetActorLocation()) / MetersToUU(1.f);

	// Build the model input from the real world so "why did they miss?" is always
	// answerable: movement, crouch, suppression and range all feed the number.
	FEnemyShotInput Input;
	Input.Accuracy = Accuracy;
	Input.AccuracyMult = AccuracyMult;
	Input.DistanceM = DistanceM;
	Input.WeaponRangeM = Weapon.Range;

	if (const APawn* ShooterPawn = Cast<APawn>(Shooter))
	{
		Input.bShooterMoving = ShooterPawn->GetVelocity().Size2D() > MetersToUU(0.5f);
	}
	if (const APawn* TargetPawn = Cast<APawn>(Target))
	{
		const float Speed = TargetPawn->GetVelocity().Size2D();
		Input.bPlayerMoving = Speed > MetersToUU(0.6f);
		Input.PlayerSpeedMps = Speed / MetersToUU(1.f);
		Input.bPlayerCrouched = TargetPawn->bIsCrouched;
	}

	OutPlan = PlanEnemyShot(Input, Rng);

	FBreachlineShotContext Context;
	Context.Weapon = Weapon;
	Context.MuzzleLocation = MuzzleLocation;
	Context.AimDirection = (Target->GetActorLocation() - MuzzleLocation).GetSafeNormal();
	Context.SpreadRadians = OutPlan.AimError;
	Context.Instigator = Shooter;
	Context.Pellets = FMath::Max(1, Weapon.Pellets);
	Context.bEnemyShot = true;
	Context.bDeliberateMiss = OutPlan.bMiss;
	Context.MissLateralM = OutPlan.LateralM;
	Context.MissVerticalM = OutPlan.VerticalM;
	Context.ShooterAccuracy = Accuracy;

	// Near-miss measurement: closest approach of the (perturbed) shot line to the
	// player's chest. Anything inside NearMissRadiusM gets a whiz + shake.
	const APawn* TargetPawn = Cast<APawn>(Target);
	const FVector TargetPoint = TargetPawn
		? TargetPawn->GetActorLocation() + FVector(0.f, 0.f, TargetPawn->BaseEyeHeight * 0.6f)
		: Target->GetActorLocation();

	FVector ShotDir = Context.AimDirection;
	if (OutPlan.bMiss)
	{
		FVector Right = FVector::CrossProduct(ShotDir, FVector::UpVector).GetSafeNormal();
		if (Right.IsNearlyZero()) Right = FVector::RightVector;
		const float Normalizer = FMath::Max(4.f, Weapon.Range * 0.5f);
		ShotDir = (ShotDir
			+ Right * (OutPlan.LateralM / Normalizer)
			+ FVector::UpVector * (OutPlan.VerticalM / Normalizer)).GetSafeNormal();
	}
	OutNearMissMeters = RayPointDistance(MuzzleLocation, ShotDir, TargetPoint, MetersToUU(Weapon.Range));

	ResolveShot(World, Context);
	return true;
}

void UBreachlineCombatLibrary::ApplyExplosion(
	UWorld* World,
	const FVector& Origin,
	float RadiusMeters,
	float BaseDamage,
	AActor* Instigator,
	const TArray<AActor*>& IgnoreActors)
{
	if (!World) return;

	const float RadiusUU = MetersToUU(RadiusMeters);
	TArray<FOverlapResult> Overlaps;

	FCollisionQueryParams Params(SCENE_QUERY_STAT(BreachlineExplosion), false);
	for (AActor* Ignored : IgnoreActors)
	{
		Params.AddIgnoredActor(Ignored);
	}
	Params.AddIgnoredActor(Instigator);

	World->OverlapMultiByObjectType(
		Overlaps,
		Origin,
		FQuat::Identity,
		FCollisionObjectQueryParams(ECC_Pawn),
		FCollisionShape::MakeSphere(RadiusUU),
		Params);

	TSet<AActor*> Processed;
	for (const FOverlapResult& Overlap : Overlaps)
	{
		AActor* Actor = Overlap.GetActor();
		if (!Actor || Processed.Contains(Actor)) continue;
		Processed.Add(Actor);

		UHealthComponent* Health = FindHealth(Actor);
		if (!Health) continue;

		const float DistanceM = FVector::Dist(Origin, Actor->GetActorLocation()) / MetersToUU(1.f);

		// Walls stop frag: no damage if the geometry blocks the line to the torso.
		FHitResult Blocking;
		FCollisionQueryParams LosParams(SCENE_QUERY_STAT(BreachlineExplosionLos), false, Instigator);
		if (World->LineTraceSingleByChannel(
			Blocking, Origin, Actor->GetActorLocation(), ECC_GameTraceChannel1, LosParams))
		{
			if (Blocking.GetActor() != Actor) continue;
		}

		const float Falloff = GrenadeFalloff(DistanceM, RadiusMeters, FBreachlineDamageTuning::Get().GrenadeFalloffPower);
		if (Falloff <= 0.f) continue;

		Health->ApplyExplosiveDamage(BaseDamage * Falloff, Instigator);
		AwardKill(World, Actor, Instigator, /*bGrenade*/ true);
	}

	if (UBreachlineFXSubsystem* FX = World->GetSubsystem<UBreachlineFXSubsystem>())
	{
		FX->SpawnExplosion(Origin, RadiusMeters);
	}
	if (UBreachlineAudioSubsystem* Audio = World->GetSubsystem<UBreachlineAudioSubsystem>())
	{
		Audio->PlayExplosion(Origin);
	}
}
