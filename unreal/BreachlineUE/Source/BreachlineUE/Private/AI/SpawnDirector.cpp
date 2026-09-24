// Copyright (c) Breachline UE. All rights reserved.

#include "AI/SpawnDirector.h"
#include "AI/TacticalAIController.h"
#include "Character/BreachlineEnemyCharacter.h"
#include "Character/BreachlinePlayerCharacter.h"
#include "Core/BreachlineBalance.h"
#include "Core/BreachlineSettings.h"
#include "Game/BreachlineGameMode.h"
#include "UI/BreachlinePlayerController.h"
#include "NavigationSystem.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "BreachlineUE.h"

using namespace Breachline;

ASpawnDirector::ASpawnDirector()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickInterval = 0.2f; // the wave logic is second-scale
}

void ASpawnDirector::BeginRound(const FRoundDef& InRound, ABreachlineGameMode* InOwner)
{
	Round = InRound;
	Owner = InOwner;
	Player = Cast<ABreachlinePlayerCharacter>(UGameplayStatics::GetPlayerPawn(GetWorld(), 0));

	PruneDead();
	LiveEnemies.Reset();

	TotalToSpawn = FMath::Max(1, Round.TotalEnemies);
	SpawnedCount = 0;
	bRunning = true;

	const float Now = GetWorld()->GetTimeSeconds();
	TelegraphEndTime = Now + Spawn::TelegraphS;
	NextSpawnTime = TelegraphEndTime;

	if (ABreachlinePlayerController* PC = Player ? Cast<ABreachlinePlayerController>(Player->GetController()) : nullptr)
	{
		PC->NotifyWaveIncoming(TotalToSpawn);
	}

	UE_LOG(LogBreachline, Log, TEXT("Round wave: %d hostiles, max %d alive, health x%.2f accuracy x%.2f."),
		TotalToSpawn, FMath::Max(1, Round.MaxAlive), Round.HealthMult, Round.AccuracyMult);
}

void ASpawnDirector::EndRound()
{
	bRunning = false;
	LiveEnemies.Reset();
	TotalToSpawn = 0;
	SpawnedCount = 0;
}

void ASpawnDirector::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	PruneDead();
	if (!bRunning) return;

	UWorld* World = GetWorld();
	if (!World) return;

	if (!Player)
	{
		Player = Cast<ABreachlinePlayerCharacter>(UGameplayStatics::GetPlayerPawn(World, 0));
	}

	const float Now = World->GetTimeSeconds();
	if (Now < TelegraphEndTime) return;

	// MaxAlive caps simultaneous pressure: the compound is 176 m across, so more
	// than a handful of shooters at once is chaos rather than tactics.
	const int32 MaxAlive = FMath::Max(1, Round.MaxAlive);
	if (SpawnedCount < TotalToSpawn && LiveEnemies.Num() < MaxAlive && Now >= NextSpawnTime)
	{
		SpawnOne();
		NextSpawnTime = Now + Spawn::StaggerIntervalS;
	}
}

void ASpawnDirector::PruneDead()
{
	LiveEnemies.RemoveAll([](const ABreachlineEnemyCharacter* Enemy)
	{
		return !IsValid(Enemy) || !Enemy->IsAlive();
	});
}

bool ASpawnDirector::IsWaveCleared() const
{
	return bRunning && SpawnedCount >= TotalToSpawn && LiveEnemies.Num() == 0;
}

int32 ASpawnDirector::GetEnemiesRemaining() const
{
	return FMath::Max(0, TotalToSpawn - SpawnedCount) + LiveEnemies.Num();
}

int32 ASpawnDirector::GetAliveCount() const
{
	return LiveEnemies.Num();
}

float ASpawnDirector::GetTelegraphRemaining() const
{
	const UWorld* World = GetWorld();
	if (!World || !bRunning) return 0.f;
	return FMath::Max(0.f, TelegraphEndTime - World->GetTimeSeconds());
}

int32 ASpawnDirector::DrawArchetypeIndex() const
{
	const TArray<FEnemyArchetypeDef>& Archetypes = Breachline::DefaultEnemyArchetypes();

	// Weights are index-matched to the archetype table; a short/empty array falls
	// back to a rifleman-heavy default so a malformed table still plays.
	float Total = 0.f;
	for (int32 i = 0; i < Archetypes.Num(); ++i)
	{
		Total += Round.ArchetypeWeights.IsValidIndex(i)
			? FMath::Max(0.f, Round.ArchetypeWeights[i])
			: (i == 0 ? 1.f : 0.f);
	}
	if (Total <= KINDA_SMALL_NUMBER) return 0;

	float Roll = FMath::FRandRange(0.f, Total);
	for (int32 i = 0; i < Archetypes.Num(); ++i)
	{
		const float Weight = Round.ArchetypeWeights.IsValidIndex(i)
			? FMath::Max(0.f, Round.ArchetypeWeights[i])
			: (i == 0 ? 1.f : 0.f);
		Roll -= Weight;
		if (Roll <= 0.f) return i;
	}
	return Archetypes.Num() - 1;
}

bool ASpawnDirector::IsLocationFree(const FVector& Location, float MinDistanceM) const
{
	const float MinUU = MetersToUU(MinDistanceM);

	if (Player && FVector::Dist(Player->GetActorLocation(), Location) < MinUU)
	{
		return false;
	}
	for (const ABreachlineEnemyCharacter* Enemy : LiveEnemies)
	{
		if (IsValid(Enemy) && FVector::Dist(Enemy->GetActorLocation(), Location) < MinUU)
		{
			return false;
		}
	}
	return true;
}

bool ASpawnDirector::FindSpawnLocation(FVector& OutLocation) const
{
	UNavigationSystemV1* Nav = FNavigationSystem::GetCurrent<UNavigationSystemV1>(GetWorld());
	if (!Nav) return false;

	// Anchors are biased away from the player: the squad should always arrive
	// with some approach distance, never materialise in the operator's face.
	const FVector PlayerLocation = Player ? Player->GetActorLocation() : FVector::ZeroVector;
	float RequiredDistanceM = Spawn::MinDistanceFromPlayerM;

	for (int32 Attempt = 0; Attempt < Spawn::PlacementAttempts; ++Attempt)
	{
		// Relax the distance requirement gradually so a cramped map still plays.
		if (Attempt == Spawn::PlacementAttempts / 2)
		{
			RequiredDistanceM *= 0.6f;
		}
		else if (Attempt == (Spawn::PlacementAttempts * 3) / 4)
		{
			RequiredDistanceM *= 0.6f;
		}

		const FVector Origin = PlayerLocation
			+ FVector(FMath::FRandRange(-1.f, 1.f), FMath::FRandRange(-1.f, 1.f), 0.f)
				* MetersToUU(FMath::FRandRange(Spawn::RingMinM, Spawn::RingMaxM));

		FNavLocation Projected;
		if (!Nav->ProjectPointToNavigation(Origin, Projected, FVector(MetersToUU(6.f)))) continue;

		if (!IsLocationFree(Projected.Location, FMath::Max(RequiredDistanceM, Spawn::MinDistanceBetweenM)))
		{
			continue;
		}

		OutLocation = Projected.Location;
		return true;
	}
	return false;
}

void ASpawnDirector::SpawnOne()
{
	UWorld* World = GetWorld();
	if (!World) return;

	const TArray<FEnemyArchetypeDef>& Archetypes = Breachline::DefaultEnemyArchetypes();
	const int32 ArchetypeIndex = DrawArchetypeIndex();
	if (!Archetypes.IsValidIndex(ArchetypeIndex)) return;

	const FEnemyArchetypeDef& Archetype = Archetypes[ArchetypeIndex];

	FVector SpawnLocation;
	if (!FindSpawnLocation(SpawnLocation))
	{
		// No valid navmesh point (blockout level without a baked volume): spawn at
		// the ring anyway so the game still functions — a graceful degradation.
		const FVector PlayerLocation = Player ? Player->GetActorLocation() : FVector::ZeroVector;
		const FVector Offset(FMath::FRandRange(-1.f, 1.f), FMath::FRandRange(-1.f, 1.f), 0.f);
		SpawnLocation = PlayerLocation + Offset.GetSafeNormal() * MetersToUU(Spawn::RingMaxM);
		SpawnLocation.Z = PlayerLocation.Z + MetersToUU(World::CharacterHeightM * 0.5f);
		UE_LOG(LogBreachline, Warning, TEXT("Spawn: navmesh projection failed, using fallback ring position."));
	}

	// Prefer the archetype's authored class (a real MetaHuman/skeletal enemy);
	// fall back to the C++ class so the project runs with zero content.
	UClass* SpawnClass = ABreachlineEnemyCharacter::StaticClass();
	if (!Archetype.CharacterClass.IsNull())
	{
		if (UClass* Authored = Archetype.CharacterClass.LoadSynchronous())
		{
			SpawnClass = Authored;
		}
	}

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
	Params.AIControllerClass = ATacticalAIController::StaticClass();

	ABreachlineEnemyCharacter* Enemy = World->SpawnActor<ABreachlineEnemyCharacter>(
		SpawnClass, SpawnLocation, FRotator(0.f, FMath::FRandRange(0.f, 360.f), 0.f), Params);
	if (!Enemy) return;

	Enemy->Configure(Archetype, Round.HealthMult, Round.AccuracyMult, Round.AggressionMult);

	// Freshly spawned enemies face the player's general area: arriving already
	// oriented removes the "spin in place" tell that makes spawns obvious.
	if (Player)
	{
		const FVector ToPlayer = (Player->GetActorLocation() - SpawnLocation).GetSafeNormal2D();
		Enemy->SetActorRotation(FRotator(0.f, ToPlayer.Rotation().Yaw, 0.f));
		Enemy->SetAimDirection(ToPlayer);
	}

	// Controllers are created by SpawnActor for a Pawn with AIControllerClass set;
	// tell the brain who it is hunting.
	if (ATacticalAIController* AI = Cast<ATacticalAIController>(Enemy->GetController()))
	{
		AI->SetTargetPlayer(Player);
	}

	LiveEnemies.Add(Enemy);
	SpawnedCount++;
}
