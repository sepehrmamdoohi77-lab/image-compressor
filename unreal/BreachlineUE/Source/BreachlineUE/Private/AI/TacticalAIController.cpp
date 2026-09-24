// Copyright (c) Breachline UE. All rights reserved.

#include "AI/TacticalAIController.h"
#include "Character/BreachlineEnemyCharacter.h"
#include "Character/BreachlinePlayerCharacter.h"
#include "Character/HealthComponent.h"
#include "Weapons/WeaponComponent.h"
#include "UI/BreachlinePlayerController.h"
#include "Combat/BreachlineCombatLibrary.h"
#include "Combat/EnemyFireModel.h"
#include "Audio/BreachlineAudioSubsystem.h"
#include "World/CoverPoint.h"
#include "Core/BreachlineBalance.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "NavigationSystem.h"
#include "Navigation/PathFollowingComponent.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "BreachlineUE.h"

using namespace Breachline;

namespace
{
	/** Vision is a cone + line of sight, not a sphere: hostiles can be flanked. */
	bool ConeContains(const FVector& From, const FVector& To, const FVector& Forward, float HalfAngleDeg)
	{
		const FVector Dir = (To - From).GetSafeNormal2D();
		if (Dir.IsNearlyZero()) return true;
		const float Dot = FVector::DotProduct(Dir, Forward.GetSafeNormal2D());
		return Dot >= FMath::Cos(FMath::DegreesToRadians(HalfAngleDeg));
	}
}

ATacticalAIController::ATacticalAIController()
{
	PrimaryActorTick.bCanEverTick = true;
	// AI ticks at 10 Hz: the FSM is decision-driven, so a per-frame brain would
	// burn CPU for no behavioural gain (and it keeps 20 enemies cheap).
	PrimaryActorTick.TickInterval = 0.05f;

	bAttachToPawn = false;
}

void ATacticalAIController::OnPossess(APawn* InPawn)
{
	Super::OnPossess(InPawn);

	Enemy = Cast<ABreachlineEnemyCharacter>(InPawn);
	if (!Enemy)
	{
		UE_LOG(LogBreachline, Warning, TEXT("%s possessed a non-enemy pawn."), *GetName());
		return;
	}

	AIState = FEnemyAIState();
	AIState.HomeLocation = Enemy->GetActorLocation();
	AIState.NextDecisionTime = GetWorld()->GetTimeSeconds() + FMath::FRandRange(0.f, AI::DecisionInterval);
	AIState.NextPerceptionTime = GetWorld()->GetTimeSeconds() + FMath::FRandRange(0.f, AI::PerceptionInterval);
	AIState.ReactionTime = GetWorld()->GetTimeSeconds() + FMath::FRandRange(0.35f, 0.9f);
	AIState.StrafeDirection = FMath::RandBool() ? 1 : -1;
	State = EEnemyState::Idle;

	if (TargetPlayer == nullptr)
	{
		TargetPlayer = Cast<ABreachlinePlayerCharacter>(UGameplayStatics::GetPlayerPawn(GetWorld(), 0));
	}

	Enemy->GetHealthComponent()->OnDied.AddDynamic(this, &ATacticalAIController::HandleEnemyDied);
}

void ATacticalAIController::HandleEnemyDied(AActor* Victim, AActor* Killer)
{
	bPossessedDead = true;
	ReleaseCover();
	SetState(EEnemyState::Dead, GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f);

	// Drop the firing line immediately: a corpse must never keep shooting.
	StopMovement();
	ClearFocus(EAIFocusPriority::Gameplay);

	// Nearby squadmates panic-shift toward the killer's position: the player who
	// just won a trade should expect the squad to converge on them.
	if (Killer)
	{
		for (TActorIterator<ATacticalAIController> It(GetWorld()); It; ++It)
		{
			ATacticalAIController* Other = *It;
			if (Other == this || !Other->Enemy || !Other->Enemy->IsAlive()) continue;

			const float DistanceM = FVector::Dist(Other->Enemy->GetActorLocation(), Enemy->GetActorLocation()) / MetersToUU(1.f);
			if (DistanceM <= AI::SquadShareRadiusM)
			{
				Other->HearNoise(Killer->GetActorLocation(), 0.7f, AI::SquadShareRadiusM);
			}
		}
	}
}

void ATacticalAIController::OnUnPossess()
{
	ReleaseCover();
	Super::OnUnPossess();
}

void ATacticalAIController::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	UWorld* World = GetWorld();
	if (!World || !Enemy || bPossessedDead || !Enemy->IsAlive()) return;

	const float Now = World->GetTimeSeconds();

	if (Now >= AIState.NextPerceptionTime)
	{
		AIState.NextPerceptionTime = Now + AI::PerceptionInterval;
		Perceive(Now);
	}

	if (Now >= AIState.NextDecisionTime)
	{
		AIState.NextDecisionTime = Now + AI::DecisionInterval * FMath::FRandRange(0.8f, 1.2f);
		Decide(Now);
	}

	Act(DeltaSeconds, Now);
}

// ---------------------------------------------------------------- perception --
void ATacticalAIController::Perceive(float Now)
{
	AIState.Confidence = ComputeConfidence(Now);

	if (CanSeeTarget(Now))
	{
		// Vision sets a hard sighting; memory decays from that moment.
		AIState.LastSeenLocation = TargetPlayer->GetActorLocation();
		AIState.LastSeenTime = Now;
		AIState.Confidence = 1.f;
		AIState.Suspicion = 1.f;
	}
	else if (Now - AIState.LastSeenTime > AI::MemoryDuration)
	{
		AIState.Suspicion = FMath::Max(0.f, AIState.Suspicion - 0.35f);
	}

	UpdateFromSquad(Now);

	// Fresh hit reaction: being shot at resets confidence even through cover.
	if (Now - AIState.LastDamageTime < 0.3f)
	{
		AIState.Suspicion = 1.f;
	}
}

float ATacticalAIController::ComputeConfidence(float Now) const
{
	if (!Enemy) return 0.f;
	// Confidence is "how sure am I where the player is": full on sight, decaying
	// memory afterwards.
	const float Seen = FMath::Max(0.f, 1.f - (Now - AIState.LastSeenTime) / AI::MemoryDuration);
	return FMath::Clamp(FMath::Max(Seen, AIState.Confidence * 0.98f), 0.f, 1.f);
}

bool ATacticalAIController::CanSeeTarget(float Now) const
{
	if (!Enemy || !TargetPlayer || !TargetPlayer->IsAlive()) return false;

	const FVector Eye = Enemy->GetChestLocation();
	const FVector TargetChest = TargetPlayer->GetChestLocation();
	const float DistanceM = FVector::Dist(Eye, TargetChest) / MetersToUU(1.f);

	// Vision range and cone come from the archetype; the Heavy is short-sighted,
	// the marksman sees far. Sprinting players are easier to spot.
	float VisionRange = 26.f;
	float HalfAngle = 55.f;
	if (Enemy->GetArchetypeId() == TEXT("heavy")) { VisionRange = 22.f; HalfAngle = 47.f; }
	else if (Enemy->GetArchetypeId() == TEXT("support")) { VisionRange = 32.f; HalfAngle = 45.f; }
	else if (Enemy->GetArchetypeId() == TEXT("assault")) { VisionRange = 23.f; HalfAngle = 60.f; }

	if (DistanceM > VisionRange) return false;
	if (!ConeContains(Eye, TargetChest, Enemy->GetActorForwardVector(), HalfAngle)) return false;

	// Line of sight: anything solid blocks it. This is what makes cover work.
	FHitResult Blocking;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(BreachlineAISight), false, Enemy);
	Params.AddIgnoredActor(TargetPlayer);
	if (GetWorld()->LineTraceSingleByChannel(Blocking, Eye, TargetChest, ECC_Visibility, Params))
	{
		return false;
	}
	(void)Now;
	return true;
}

void ATacticalAIController::ReceiveSquadIntel(const FVector& ApproximateLocation, float Confidence)
{
	if (!Enemy || !Enemy->IsAlive() || Confidence <= 0.f) return;

	// Push-style intel (a squadmate telling us directly) as opposed to the pull
	// style in UpdateFromSquad. Always approximate: soldiers point, they do not
	// radio grid references.
	const float Now = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f;
	const float Jitter = MetersToUU(AI::SquadShareNoiseM);

	AIState.LastSeenLocation = ApproximateLocation + FVector(
		FMath::FRandRange(-Jitter, Jitter), FMath::FRandRange(-Jitter, Jitter), 0.f);
	AIState.LastSeenTime = Now;
	AIState.Confidence = FMath::Max(AIState.Confidence, Confidence * AI::SquadConfFactor);
	AIState.Suspicion = FMath::Max(AIState.Suspicion, 0.6f);

	if (State == EEnemyState::Idle || State == EEnemyState::Patrol)
	{
		SetState(EEnemyState::Suspicious, Now);
	}
}

void ATacticalAIController::UpdateFromSquad(float Now)
{
	// Squad intel: if a squadmate has a fresh, confident sighting inside the
	// share radius, adopt an approximate version of it (never exact).
	if (AIState.Confidence >= 0.35f) return;

	float BestConfidence = 0.f;
	FVector BestLocation = FVector::ZeroVector;

	for (TActorIterator<ATacticalAIController> It(GetWorld()); It; ++It)
	{
		const ATacticalAIController* Other = *It;
		if (Other == this || !Other->Enemy || !Other->Enemy->IsAlive()) continue;
		if (Other->AIState.Confidence <= 0.35f) continue;

		const float DistanceM = FVector::Dist(Other->Enemy->GetActorLocation(), Enemy->GetActorLocation()) / MetersToUU(1.f);
		if (DistanceM > AI::SquadShareRadiusM) continue;

		if (Other->AIState.Confidence > BestConfidence)
		{
			BestConfidence = Other->AIState.Confidence;
			BestLocation = Other->AIState.LastSeenLocation;
		}
	}

	if (BestConfidence > 0.f)
	{
		const float Jitter = MetersToUU(AI::SquadShareNoiseM);
		AIState.LastSeenLocation = BestLocation + FVector(
			FMath::FRandRange(-Jitter, Jitter), FMath::FRandRange(-Jitter, Jitter), 0.f);
		AIState.LastSeenTime = Now;
		AIState.Confidence = FMath::Max(AIState.Confidence, BestConfidence * AI::SquadConfFactor);
		AIState.Suspicion = FMath::Max(AIState.Suspicion, 0.6f);

		if (State == EEnemyState::Idle || State == EEnemyState::Patrol)
		{
			SetState(EEnemyState::Suspicious, Now);
		}
	}
}

void ATacticalAIController::NotifyDamaged(float Amount, AActor* DamageCauser)
{
	if (!Enemy || !Enemy->IsAlive()) return;

	UWorld* World = GetWorld();
	const float Now = World ? World->GetTimeSeconds() : 0.f;

	AIState.LastDamageTime = Now;

	// Being hit is the strongest "he is over there" signal in the game: it works
	// through smoke, across cover, and even when the muzzle flash was never seen.
	AIState.Suspicion = 1.f;
	if (DamageCauser)
	{
		AIState.SuspicionLocation = DamageCauser->GetActorLocation();
	}
	AIState.Confidence = FMath::Max(AIState.Confidence, AI::HearingMemoryConf);

	// Cover is judged on what it costs: enough damage from one position and the
	// soldier relocates (see the InCover branch of Decide()).
	if (State == EEnemyState::InCover || State == EEnemyState::TakingCover)
	{
		AIState.DamagedInCover += Amount;
	}

	if (State == EEnemyState::Idle || State == EEnemyState::Patrol)
	{
		SetState(EEnemyState::Suspicious, Now);
	}

	// "Contact!" — push the bearing to everyone in the squad that can hear it. This
	// is the same intel UpdateFromSquad pulls, but immediate, so a squad reacts as
	// one body when its point man is hit.
	if (DamageCauser && GetWorld())
	{
		const FVector Bearing = DamageCauser->GetActorLocation()
			+ FVector(FMath::FRandRange(-1.f, 1.f) * MetersToUU(AI::SquadShareNoiseM),
				FMath::FRandRange(-1.f, 1.f) * MetersToUU(AI::SquadShareNoiseM), 0.f);
		const float ContactStrength = FMath::Max(AIState.Confidence, AI::HearingMemoryConf);

		for (TActorIterator<ATacticalAIController> It(GetWorld()); It; ++It)
		{
			ATacticalAIController* Squadmate = *It;
			if (Squadmate == this || !Squadmate->Enemy || !Squadmate->Enemy->IsAlive()) continue;
			if (FVector::Dist(Squadmate->Enemy->GetActorLocation(), Enemy->GetActorLocation()) > MetersToUU(AI::SquadShareRadiusM)) continue;
			Squadmate->ReceiveSquadIntel(Bearing, ContactStrength);
		}
	}
}

void ATacticalAIController::HearNoise(const FVector& Location, float Loudness, float RadiusMeters)
{
	if (!Enemy || !Enemy->IsAlive()) return;

	const float DistanceM = FVector::Dist(Location, Enemy->GetActorLocation()) / MetersToUU(1.f);
	if (DistanceM > RadiusMeters) return;

	UWorld* World = GetWorld();
	const float Now = World ? World->GetTimeSeconds() : 0.f;

	// Hearing is a weak, approximate signal: it points the squad at an area, it
	// does not grant a firing solution.
	AIState.SuspicionLocation = Location + FVector(
		FMath::FRandRange(-MetersToUU(2.f), MetersToUU(2.f)),
		FMath::FRandRange(-MetersToUU(2.f), MetersToUU(2.f)), 0.f);
	AIState.Suspicion = FMath::Min(1.f, AIState.Suspicion + Loudness);
	AIState.Confidence = FMath::Max(AIState.Confidence, AI::HearingMemoryConf * Loudness);

	if (State == EEnemyState::Idle || State == EEnemyState::Patrol)
	{
		SetState(EEnemyState::Suspicious, Now);
	}
}

// -------------------------------------------------------------------- decide --
void ATacticalAIController::SetState(EEnemyState NewState, float Now)
{
	if (State == NewState) return;

	// Leaving cover releases the claim so squadmates can use the position.
	if ((State == EEnemyState::TakingCover || State == EEnemyState::InCover)
		&& NewState != EEnemyState::TakingCover && NewState != EEnemyState::InCover)
	{
		ReleaseCover();
	}

	State = NewState;
	AIState.StateTime = Now;
	AIState.bCrouched = false;
	AIState.LeanTarget = 0.f;
	if (NewState != EEnemyState::InCover && NewState != EEnemyState::TakingCover)
	{
		AIState.DamagedInCover = 0.f;
	}
}

void ATacticalAIController::Decide(float Now)
{
	if (!Enemy || !TargetPlayer) return;

	const float Confidence = AIState.Confidence;
	const bool bSeenAndReady = Confidence > 0.55f && Now >= AIState.ReactionTime && TargetPlayer->IsAlive();

	switch (State)
	{
	case EEnemyState::Dead:
		return;

	case EEnemyState::HitReaction:
		if (Now > AIState.HideUntil)
		{
			SetState(Confidence > 0.3f ? EEnemyState::Engaging : EEnemyState::Suspicious, Now);
		}
		return;

	case EEnemyState::Idle:
		SetState(EEnemyState::Patrol, Now);
		return;

	case EEnemyState::Patrol:
		if (bSeenAndReady)
		{
			SetState(EEnemyState::Engaging, Now);
			return;
		}
		if (AIState.Suspicion > 0.5f)
		{
			SetState(EEnemyState::Suspicious, Now);
			return;
		}
		if (!AIState.bHasPatrolTarget || HasReachedPathEnd())
		{
			PickPatrolTarget(Now);
		}
		return;

	case EEnemyState::Suspicious:
		if (bSeenAndReady)
		{
			SetState(EEnemyState::Engaging, Now);
			return;
		}
		if (Now - AIState.StateTime > 1.1f)
		{
			if (Confidence > 0.25f || AIState.Suspicion > 0.35f)
			{
				const FVector Target = Confidence > AIState.Suspicion
					? AIState.LastSeenLocation
					: AIState.SuspicionLocation;
				if (MoveToLocationSafe(Target, Now, 2.f))
				{
					AIState.SearchIndex = 0;
					SetState(EEnemyState::Investigating, Now);
				}
			}
			else
			{
				SetState(EEnemyState::Patrol, Now);
			}
		}
		return;

	case EEnemyState::Investigating:
	case EEnemyState::Searching:
		if (bSeenAndReady)
		{
			SetState(EEnemyState::Engaging, Now);
			return;
		}
		if (HasReachedPathEnd())
		{
			PickSearchPoint(Now);
			if (Now - AIState.StateTime > 1.f) SetState(EEnemyState::Searching, Now);
		}
		return;

	case EEnemyState::Engaging:
		DecideCombat(Now);
		return;

	case EEnemyState::TakingCover:
	{
		if (!TargetPlayer->IsAlive())
		{
			SetState(EEnemyState::Searching, Now);
			return;
		}
		const float DistanceM = FVector::Dist(TargetPlayer->GetActorLocation(), Enemy->GetActorLocation()) / MetersToUU(1.f);
		if (DistanceM < 4.f && Confidence > 0.5f)
		{
			SetState(EEnemyState::Engaging, Now); // too close to hide: fight
			return;
		}
		if (HasReachedPathEnd() || Now - AIState.StateTime > 7.f)
		{
			AIState.HideUntil = Now + 0.6f + FMath::FRandRange(0.f, 0.8f);
			AIState.ExposeUntil = 0.f;
			SetState(EEnemyState::InCover, Now);
		}
		return;
	}

	case EEnemyState::InCover:
	{
		if (!TargetPlayer->IsAlive() || Confidence < 0.15f)
		{
			SetState(EEnemyState::Searching, Now);
			return;
		}
		const FVector Threat = TargetPlayer->GetActorLocation();
		const float DistanceM = FVector::Dist(Threat, Enemy->GetActorLocation()) / MetersToUU(1.f);
		if (DistanceM < 5.f)
		{
			SetState(EEnemyState::Engaging, Now);
			return;
		}

		// "Am I still covered?" A flanking player invalidates the position.
		if (Now - AIState.NextFlankCheckTime > AI::CoverFlankRecheck)
		{
			AIState.NextFlankCheckTime = Now;
			if (!CoverStillBlocks(AIState.CoverPointIndex, Threat))
			{
				if (TryTakeCover(Now, Threat)) return;
				SetState(EEnemyState::Engaging, Now);
				return;
			}
		}

		// Relocate on a timer, or once this position has been shot up enough.
		const bool bShotUp = AIState.DamagedInCover >= Enemy->GetHealthComponent()->GetMaxHealth() * AI::CoverRelocateDamageFrac;
		const bool bStale = Now - AIState.StateTime > AI::CoverRelocateAfter * FMath::FRandRange(0.8f, 1.3f);
		if (bShotUp || bStale)
		{
			AIState.DamagedInCover = 0.f;
			if (TryTakeCover(Now, Threat)) return;
			SetState(EEnemyState::Engaging, Now);
		}
		return;
	}

	case EEnemyState::Flanking:
	{
		if (bSeenAndReady)
		{
			const float DistanceM = FVector::Dist(TargetPlayer->GetActorLocation(), Enemy->GetActorLocation()) / MetersToUU(1.f);
			if (HasReachedPathEnd()
				|| (DistanceM > Enemy->GetPreferredMin() && DistanceM < Enemy->GetPreferredMax()))
			{
				SetState(EEnemyState::Engaging, Now);
				return;
			}
		}
		if (HasReachedPathEnd() || Now - AIState.StateTime > 10.f)
		{
			SetState(EEnemyState::Engaging, Now);
		}
		return;
	}

	case EEnemyState::Retreating:
	{
		if (HasReachedPathEnd() || Now - AIState.StateTime > 7.f)
		{
			UWeaponComponent* Weapon = Enemy->GetWeapon();
			if (Weapon && Weapon->IsEmpty() && Weapon->ReserveAmmo > 0)
			{
				Enemy->ReloadWeapon();
				SetState(EEnemyState::Reloading, Now);
			}
			else
			{
				AIState.HideUntil = Now + 1.f;
				SetState(EEnemyState::InCover, Now);
			}
		}
		return;
	}

	case EEnemyState::Reloading:
	{
		UWeaponComponent* Weapon = Enemy->GetWeapon();
		if (!Weapon || (!Weapon->IsReloading() && !Weapon->IsEmpty()))
		{
			SetState(bSeenAndReady ? EEnemyState::Engaging : EEnemyState::Searching, Now);
		}
		return;
	}
	}
}

void ATacticalAIController::DecideCombat(float Now)
{
	UWeaponComponent* Weapon = Enemy->GetWeapon();
	if (!Weapon) return;

	const FVector Threat = TargetPlayer->GetActorLocation();
	const float DistanceM = FVector::Dist(Threat, Enemy->GetActorLocation()) / MetersToUU(1.f);
	const float HealthFrac = Enemy->GetHealthComponent()->GetHealthFraction();
	const float Aggression = Enemy->GetAggression();

	// Empty magazine: reload from cover if we can, otherwise right here.
	if (Weapon->IsEmpty() && !Weapon->IsReloading())
	{
		Enemy->ReloadWeapon();
		SetState(EEnemyState::Reloading, Now);
		return;
	}

	// Badly hurt and not aggressive: break contact toward far cover.
	if (HealthFrac < AI::RetreatHealthFrac && Aggression < 0.65f && FMath::FRand() < 0.5f)
	{
		if (TryRetreat(Now, Threat)) return;
	}

	// Range management against the archetype's preferred band.
	if (DistanceM < Enemy->GetPreferredMin() * 0.75f)
	{
		if (Aggression > 0.72f) return; // assault archetypes push in
		if (TryTakeCover(Now, Threat)) return;
		return;
	}
	if (DistanceM > Enemy->GetPreferredMax())
	{
		if (TryTakeCover(Now, Threat)) return;
		// Marksmen prefer to re-position and shoot again from range.
		if (FMath::FRand() < 0.35f && TryFlank(Now, Threat)) return;
	}

	// Suppressed: hugging cover beats trading shots in the open.
	if (Now - AIState.LastDamageTime < 1.2f && FMath::FRand() < 0.55f)
	{
		if (TryTakeCover(Now, Threat)) return;
	}

	// Aggressive enemies flank instead of standing still.
	if (Aggression > 0.6f && FMath::FRand() < 0.25f && DistanceM > 8.f)
	{
		if (TryFlank(Now, Threat)) return;
	}

	// Otherwise: hold the line (the Act() path handles strafing + shooting).
	State = EEnemyState::Engaging;
	AIState.StateTime = Now;
}

// ----------------------------------------------------------------------- act --
void ATacticalAIController::Act(float DeltaSeconds, float Now)
{
	if (!Enemy || !TargetPlayer) return;

	UWorld* World = GetWorld();
	if (!World) return;

	UWeaponComponent* Weapon = Enemy->GetWeapon();
	const FVector Threat = TargetPlayer->IsAlive()
		? TargetPlayer->GetActorLocation()
		: AIState.LastSeenLocation;

	switch (State)
	{
	case EEnemyState::Idle:
	case EEnemyState::Patrol:
		// Patrols walk (not run) and look where they are going: calm body
		// language is what makes the sudden snap to combat readable.
		Enemy->GetCharacterMovement()->MaxWalkSpeed = FMath::FInterpTo(
			Enemy->GetCharacterMovement()->MaxWalkSpeed,
			MetersToUU(Enemy->GetArchetype().SpeedMps * 0.55f), DeltaSeconds, 4.f);
		FaceThreat(DeltaSeconds, AIState.bHasPatrolTarget
			? AIState.PatrolTarget
			: Enemy->GetActorLocation() + Enemy->GetActorForwardVector() * 100.f);
		break;

	case EEnemyState::Suspicious:
	case EEnemyState::Investigating:
	case EEnemyState::Searching:
		FaceThreat(DeltaSeconds, AIState.SuspicionLocation);
		break;

	case EEnemyState::Engaging:
	{
		Enemy->GetCharacterMovement()->MaxWalkSpeed = MetersToUU(Enemy->GetArchetype().SpeedMps);
		FaceThreat(DeltaSeconds, Threat);

		const float DistanceM = FVector::Dist(Threat, Enemy->GetActorLocation()) / MetersToUU(1.f);

		// Combat strafe: sidestep while shooting so a still target never exists.
		if (Now > AIState.StrafeUntil)
		{
			AIState.StrafeDirection = FMath::RandBool() ? 1 : -1;
			AIState.StrafeUntil = Now + FMath::FRandRange(0.6f, 1.6f);
		}
		const FVector Right = FRotationMatrix(FRotator(0.f, Enemy->GetActorRotation().Yaw, 0.f)).GetUnitAxis(EAxis::Y);
		Enemy->AddMovementInput(Right, AIState.StrafeDirection * 0.6f);

		// Close or open the distance toward the preferred band while firing.
		if (DistanceM > Enemy->GetPreferredMax())
		{
			Enemy->AddMovementInput((Threat - Enemy->GetActorLocation()).GetSafeNormal2D(), 1.f);
		}
		else if (DistanceM < Enemy->GetPreferredMin() * 0.6f)
		{
			Enemy->AddMovementInput((Enemy->GetActorLocation() - Threat).GetSafeNormal2D(), 0.8f);
		}

		TryShoot(Now);
		break;
	}

	case EEnemyState::TakingCover:
		Enemy->GetCharacterMovement()->MaxWalkSpeed = MetersToUU(Enemy->GetArchetype().SpeedMps * 1.05f);
		FaceThreat(DeltaSeconds, Threat);
		break;

	case EEnemyState::InCover:
	{
		FaceThreat(DeltaSeconds, Threat);

		// Lean-out rhythm: tuck in, then come up on one shoulder and fire.
		if (AIState.ExposeUntil > Now)
		{
			AIState.bCrouched = false;
			AIState.LeanTarget = AIState.PeekSide * AI::CoverLean;
			TryShoot(Now);
		}
		else if (Now > AIState.HideUntil)
		{
			AIState.ExposeUntil = Now + AI::CoverPeekMin + FMath::FRandRange(0.f, AI::CoverPeekMax - AI::CoverPeekMin);
			AIState.HideUntil = AIState.ExposeUntil + AI::CoverHideMin + FMath::FRandRange(0.f, AI::CoverHideMax - AI::CoverHideMin);
			// Alternate shoulders so the silhouette keeps changing.
			AIState.PeekSide = FMath::RandBool() ? 1 : -1;
			AIState.bCrouched = false;
			AIState.LeanTarget = AIState.PeekSide * AI::CoverLean;

			// Occasionally break cover and dash to a fresh firing position.
			if (FMath::FRand() < AI::CoverAdvanceChance)
			{
				TryAdvanceCover(Now, Threat);
			}
		}
		else
		{
			AIState.bCrouched = true;
			AIState.LeanTarget = 0.f;
		}
		break;
	}

	case EEnemyState::Flanking:
		Enemy->GetCharacterMovement()->MaxWalkSpeed = MetersToUU(Enemy->GetArchetype().SpeedMps * 0.95f);
		FaceThreat(DeltaSeconds, Threat);
		TryShoot(Now); // firing on the move, less accurate (handled by the model)
		break;

	case EEnemyState::Retreating:
		Enemy->GetCharacterMovement()->MaxWalkSpeed = MetersToUU(Enemy->GetArchetype().SpeedMps * 1.1f);
		FaceThreat(DeltaSeconds, Threat);
		break;

	case EEnemyState::Reloading:
		FaceThreat(DeltaSeconds, AIState.LastSeenLocation);
		if (AIState.CoverPointIndex != INDEX_NONE) AIState.bCrouched = true;
		break;

	case EEnemyState::HitReaction:
		FaceThreat(DeltaSeconds, Threat);
		break;

	case EEnemyState::Dead:
	default:
		break;
	}

	ApplySeparation(DeltaSeconds);
	UpdateCoverLean(DeltaSeconds);

	// Crouch state follows the FSM output (cover peek/duck, reload hiding).
	if (AIState.bCrouched && !Enemy->bIsCrouched)
	{
		Enemy->Crouch();
	}
	else if (!AIState.bCrouched && Enemy->bIsCrouched)
	{
		Enemy->UnCrouch();
	}
}

void ATacticalAIController::FaceThreat(float DeltaSeconds, const FVector& ThreatLocation, bool bInstant)
{
	if (!Enemy) return;

	const FVector ToTarget = ThreatLocation - Enemy->GetActorLocation();
	if (ToTarget.SizeSquared2D() < 1.f) return;

	const FRotator Desired(0.f, ToTarget.Rotation().Yaw, 0.f);
	const FRotator NewRotation = bInstant
		? Desired
		: FMath::RInterpTo(Enemy->GetActorRotation(), Desired, DeltaSeconds, 8.f);

	Enemy->SetActorRotation(NewRotation);
	Enemy->SetAimDirection(ToTarget);
}

void ATacticalAIController::UpdateCoverLean(float DeltaSeconds)
{
	if (!Enemy) return;

	// Lean eases in/out; the Animation Blueprint reads AIState.Lean and offsets
	// the upper body, which is what makes a peek read as motion, not a snap.
	// CoverLean is authored in radians and CoverLeanDamp in 1/s, so this needs no
	// rescaling: the lean eases in over ~0.4 s, which reads as a deliberate peek.
	AIState.Lean = FMath::FInterpTo(AIState.Lean, AIState.LeanTarget, DeltaSeconds, AI::CoverLeanDamp);
}

bool ATacticalAIController::TryShoot(float Now)
{
	if (!Enemy || !TargetPlayer || !TargetPlayer->IsAlive()) return false;
	if (AIState.Confidence < 0.35f || Now < AIState.ReactionTime) return false;

	UWeaponComponent* Weapon = Enemy->GetWeapon();
	if (!Weapon) return false;

	// Burst discipline: a soldier fires a burst, pauses, then fires again. It is
	// the single biggest contributor to "these enemies feel trained".
	if (AIState.BurstLeft <= 0)
	{
		if (Now < AIState.NextBurstTime) return false;
		AIState.BurstLeft = FMath::Max(1, FMath::RoundToInt(Enemy->GetArchetype().BurstShots));
	}
	if (!Weapon->CanFire(Now)) return false;

	const FVector Muzzle = Enemy->GetMuzzleLocation();

	FEnemyShotPlan Plan;
	float NearMissMeters = TNumericLimits<float>::Max();

	// Accuracy degrades while the shooter is moving or suppressed — both are
	// derived from live world state inside the model, so the AI only supplies
	// its archetype's base accuracy.
	const bool bEngagingOnTheMove = State == EEnemyState::Engaging || State == EEnemyState::Flanking;
	float Accuracy = Enemy->GetArchetype().Accuracy;
	if (bEngagingOnTheMove)
	{
		Accuracy *= AI::MovingFireAccuracyMult;
	}
	if (Now - AIState.LastDamageTime < AI::SuppressionWindowS)
	{
		Accuracy *= AI::SuppressedAccuracyMult;
	}

	if (!Weapon->TryFireEnemy(Muzzle, TargetPlayer, Accuracy, Enemy->GetAccuracyMult(), Plan, NearMissMeters))
	{
		return false;
	}

	AIState.BurstLeft--;
	if (AIState.BurstLeft <= 0)
	{
		AIState.NextBurstTime = Now + Enemy->GetArchetype().BurstPause * FMath::FRandRange(0.8f, 1.3f);
	}

	// Near miss: the whiz + camera shake that tells the player to move.
	if (NearMissMeters <= AI::NearMissRadiusM)
	{
		if (UBreachlineAudioSubsystem* Audio = GetWorld()->GetSubsystem<UBreachlineAudioSubsystem>())
		{
			Audio->PlayNearMiss(TargetPlayer->GetActorLocation());
		}
		if (ABreachlinePlayerController* PC = Cast<ABreachlinePlayerController>(TargetPlayer->GetController()))
		{
			PC->NotifyNearMiss(NearMissMeters);
		}
	}
	return true;
}

// ------------------------------------------------------------------- cover ----
int32 ATacticalAIController::FindCoverPoint(const FVector& ThreatLocation) const
{
	if (!Enemy) return INDEX_NONE;

	const FVector Self = Enemy->GetActorLocation();
	float BestScore = -FLT_MAX;
	int32 BestIndex = INDEX_NONE;

	// Cover scoring mirrors the web build: closeness, "is the obstacle between me
	// and the threat", preferred range band, cover height, plus penalties for
	// occupancy and for positions the squad just abandoned.
	int32 Index = 0;
	for (TActorIterator<ACoverPoint> It(GetWorld()); It; ++It)
	{
		const ACoverPoint* Point = *It;
		if (!Point) { Index++; continue; }

		const float DistanceSelfM = FVector::Dist(Self, Point->GetActorLocation()) / MetersToUU(1.f);
		if (DistanceSelfM > AI::CoverSearchRadiusM)
		{
			Index++;
			continue;
		}

		// The point's normal faces away from its obstacle: the threat must sit in
		// the opposite half-space for this position to actually protect us.
		const FVector ToThreat = (ThreatLocation - Point->GetActorLocation()).GetSafeNormal2D();
		const float Dot = FVector::DotProduct(Point->GetActorForwardVector().GetSafeNormal2D(), ToThreat);

		float Score = 30.f - FMath::Min(30.f, DistanceSelfM * 1.6f);
		Score += (0.5f - Dot * 0.5f) * 40.f;

		const float DistanceThreatM = FVector::Dist(ThreatLocation, Point->GetActorLocation()) / MetersToUU(1.f);
		if (DistanceThreatM >= Enemy->GetPreferredMin() && DistanceThreatM <= Enemy->GetPreferredMax())
		{
			Score += 18.f;
		}
		else
		{
			const float Edge = DistanceThreatM < Enemy->GetPreferredMin()
				? Enemy->GetPreferredMin() - DistanceThreatM
				: DistanceThreatM - Enemy->GetPreferredMax();
			Score -= FMath::Min(20.f, Edge * 1.2f);
		}

		Score += Point->bLowCover ? 4.f : 7.f;
		if (Point->Occupant.IsValid() && Point->Occupant.Get() != Enemy) Score -= 60.f;
		else Score += FMath::FRandRange(0.f, 4.f); // tie-breaker jitter

		// Re-use cooldown: a position the squad just left is a known firing
		// solution for the player, so it is markedly less attractive.
		if (Point->LastUsedTime > 0.f)
		{
			const float Now = GetWorld()->GetTimeSeconds();
			if (Now - Point->LastUsedTime < AI::CoverReuseCooldown) Score -= AI::CoverReusePenalty;
		}

		if (DistanceThreatM < 4.f) Score -= 25.f;
		if (Score > BestScore)
		{
			BestScore = Score;
			BestIndex = Point->CoverIndex;
		}
		Index++;
	}
	return BestIndex;
}

bool ATacticalAIController::CoverStillBlocks(int32 PointIndex, const FVector& ThreatLocation) const
{
	if (PointIndex == INDEX_NONE) return false;

	for (TActorIterator<ACoverPoint> It(GetWorld()); It; ++It)
	{
		const ACoverPoint* Point = *It;
		if (Point && Point->CoverIndex == PointIndex)
		{
			const FVector ToThreat = (ThreatLocation - Point->GetActorLocation()).GetSafeNormal2D();
			const float Dot = FVector::DotProduct(Point->GetActorForwardVector().GetSafeNormal2D(), ToThreat);
			return Dot < 0.35f;
		}
	}
	return false;
}

void ATacticalAIController::ClaimCover(int32 PointIndex)
{
	if (PointIndex == INDEX_NONE || !Enemy) return;

	for (TActorIterator<ACoverPoint> It(GetWorld()); It; ++It)
	{
		ACoverPoint* Point = *It;
		if (Point && Point->CoverIndex == PointIndex)
		{
			Point->Occupant = Enemy;
			Point->LastUsedTime = GetWorld()->GetTimeSeconds();
			break;
		}
	}
	AIState.CoverPointIndex = PointIndex;
}

void ATacticalAIController::ReleaseCover()
{
	if (!Enemy) return;

	for (TActorIterator<ACoverPoint> It(GetWorld()); It; ++It)
	{
		ACoverPoint* Point = *It;
		if (Point && Point->Occupant.Get() == Enemy)
		{
			Point->Occupant = nullptr;
			Point->LastUsedTime = GetWorld()->GetTimeSeconds(); // start the cooldown
		}
	}
	AIState.CoverPointIndex = INDEX_NONE;
}

bool ATacticalAIController::TryTakeCover(float Now, const FVector& ThreatLocation)
{
	// Immediate cover (a metre or two away) is used in place: no path needed.
	int32 Best = FindCoverPoint(ThreatLocation);
	if (Best == INDEX_NONE) return false;

	for (TActorIterator<ACoverPoint> It(GetWorld()); It; ++It)
	{
		const ACoverPoint* Point = *It;
		if (!Point || Point->CoverIndex != Best) continue;

		const float DistanceM = FVector::Dist(Point->GetActorLocation(), Enemy->GetActorLocation()) / MetersToUU(1.f);
		if (DistanceM < 2.5f)
		{
			ClaimCover(Best);
			SetState(EEnemyState::InCover, Now);
			return true;
		}

		if (MoveToLocationSafe(Point->GetActorLocation(), Now, 1.2f))
		{
			ClaimCover(Best);
			SetState(EEnemyState::TakingCover, Now);
			return true;
		}
		break;
	}
	return false;
}

bool ATacticalAIController::TryAdvanceCover(float Now, const FVector& ThreatLocation)
{
	// Advance means "keep the same threat, take a NEW position": the cooldown in
	// FindCoverPoint already de-prioritises the sandbag we are standing on.
	return TryTakeCover(Now, ThreatLocation);
}

bool ATacticalAIController::TryRetreat(float Now, const FVector& ThreatLocation)
{
	FVector BestLocation = FVector::ZeroVector;
	float BestScore = -FLT_MAX;

	for (TActorIterator<ACoverPoint> It(GetWorld()); It; ++It)
	{
		const ACoverPoint* Point = *It;
		if (!Point) continue;

		const FVector Location = Point->GetActorLocation();
		const float DistanceSelfM = FVector::Dist(Location, Enemy->GetActorLocation()) / MetersToUU(1.f);
		if (DistanceSelfM > AI::CoverSearchRadiusM) continue;

		const float DistanceThreatM = FVector::Dist(Location, ThreatLocation) / MetersToUU(1.f);
		if (DistanceThreatM < 9.f) continue; // retreating *into* the fight is not a plan

		if (Point->Occupant.IsValid() && Point->Occupant.Get() != Enemy) continue;

		// Prefer far-from-threat, close-to-self, and fresh positions.
		float Score = DistanceThreatM * 1.6f - DistanceSelfM + FMath::FRandRange(0.f, 4.f);
		if (Point->LastUsedTime > 0.f && Now - Point->LastUsedTime < AI::CoverReuseCooldown)
		{
			Score -= AI::CoverReusePenalty * 0.5f;
		}

		if (Score > BestScore)
		{
			BestScore = Score;
			BestLocation = Location;
			BestLocation.Z = 0.f;
		}
	}

	if (BestScore <= -FLT_MAX)
	{
		// No cover at all: back straight away from the threat instead.
		const FVector Away = (Enemy->GetActorLocation() - ThreatLocation).GetSafeNormal2D();
		BestLocation = Enemy->GetActorLocation() + Away * MetersToUU(10.f);
	}

	if (MoveToLocationSafe(BestLocation, Now, 1.5f))
	{
		SetState(EEnemyState::Retreating, Now);
		return true;
	}
	return false;
}

bool ATacticalAIController::TryFlank(float Now, const FVector& ThreatLocation)
{
	const float AngleRad = FMath::DegreesToRadians(AI::FlankAngleDeg) * (FMath::RandBool() ? 1.f : -1.f);
	const FVector ToSelf = (Enemy->GetActorLocation() - ThreatLocation).GetSafeNormal2D();
	const FVector FlankDir = ToSelf.RotateAngleAxis(FMath::RadiansToDegrees(AngleRad), FVector::UpVector);
	const float DistanceM = FMath::Clamp((Enemy->GetPreferredMin() + Enemy->GetPreferredMax()) * 0.5f, 7.f, 18.f);

	const FVector Destination = ThreatLocation + FlankDir * MetersToUU(DistanceM);
	if (MoveToLocationSafe(Destination, Now, 2.f))
	{
		SetState(EEnemyState::Flanking, Now);
		return true;
	}
	return false;
}

bool ATacticalAIController::MoveToLocationSafe(const FVector& Location, float Now, float AcceptanceRadiusMeters)
{
	if (!Enemy) return false;

	// Re-path on a budget: the nav system is not free, and soldiers do not need
	// a new path every frame for a target that has barely moved.
	if (Now - AIState.NextRepathTime < AI::MoveRepathInterval && !HasReachedPathEnd())
	{
		return true;
	}
	AIState.NextRepathTime = Now + AI::MoveRepathInterval * FMath::FRandRange(0.85f, 1.2f);

	FAIMoveRequest Request(Location);
	Request.SetAcceptanceRadius(MetersToUU(AcceptanceRadiusMeters));
	Request.SetUsePathfinding(true);

	const FPathFollowingRequestResult Result = MoveTo(Request);
	return Result.Code != EPathFollowingRequestResult::Failed;
}

bool ATacticalAIController::HasReachedPathEnd() const
{
	const UPathFollowingComponent* PathComponent = GetPathFollowingComponent();
	if (!PathComponent) return true;

	const EPathFollowingStatus::Type Status = PathComponent->GetStatus();
	return Status == EPathFollowingStatus::Idle
		|| Status == EPathFollowingStatus::Waiting
		|| Status == EPathFollowingStatus::Paused;
}

void ATacticalAIController::ApplySeparation(float DeltaSeconds)
{
	// Soft separation so a squad does not stack into one silhouette.
	if (!Enemy) return;

	FVector Push = FVector::ZeroVector;
	for (TActorIterator<ABreachlineEnemyCharacter> It(GetWorld()); It; ++It)
	{
		const ABreachlineEnemyCharacter* Other = *It;
		if (!Other || Other == Enemy || !Other->IsAlive()) continue;

		const FVector Delta = Enemy->GetActorLocation() - Other->GetActorLocation();
		const float DistanceM = Delta.Size2D() / MetersToUU(1.f);
		if (DistanceM > AI::SeparationRadiusM || DistanceM <= KINDA_SMALL_NUMBER) continue;

		Push += Delta.GetSafeNormal2D() * (AI::SeparationRadiusM - DistanceM) / AI::SeparationRadiusM;
	}

	if (!Push.IsNearlyZero())
	{
		Enemy->AddMovementInput(Push.GetSafeNormal2D(), FMath::Min(0.6f, Push.Size()));
	}
}

void ATacticalAIController::PickPatrolTarget(float Now)
{
	if (!Enemy) return;

	// Patrol around the spawn anchor so squads hold their own part of the map.
	const float Angle = FMath::FRandRange(0.f, 2.f * PI);
	const float RadiusM = FMath::FRandRange(4.f, 12.f);
	AIState.PatrolTarget = AIState.HomeLocation + FVector(
		FMath::Cos(Angle) * MetersToUU(RadiusM), FMath::Sin(Angle) * MetersToUU(RadiusM), 0.f);
	AIState.PatrolTarget = FVector(AIState.PatrolTarget.X, AIState.PatrolTarget.Y, 0.f);
	AIState.bHasPatrolTarget = true;

	MoveToLocationSafe(AIState.PatrolTarget, Now + AI::MoveRepathInterval * 2.f, 1.5f);
}

void ATacticalAIController::PickSearchPoint(float Now)
{
	if (!Enemy) return;

	// Four-point spiral around the last known position: predictable enough to
	// read, varied enough not to look scripted.
	const FVector Base = AIState.Confidence > 0.1f ? AIState.LastSeenLocation : AIState.SuspicionLocation;
	const float Angle = (AIState.SearchIndex / 4.f) * 2.f * PI + FMath::FRandRange(0.f, 0.8f);
	const float RadiusM = FMath::FRandRange(2.5f, 6.5f);

	const FVector Target = Base + FVector(FMath::Cos(Angle) * MetersToUU(RadiusM), FMath::Sin(Angle) * MetersToUU(RadiusM), 0.f);
	AIState.SearchIndex = (AIState.SearchIndex + 1) % 4;

	MoveToLocationSafe(Target, Now + AI::MoveRepathInterval * 2.f, 1.5f);
}
