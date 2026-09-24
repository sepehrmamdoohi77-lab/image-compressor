// Copyright (c) Breachline UE. All rights reserved.

#include "Game/BreachlineGameMode.h"
#include "AI/SpawnDirector.h"
#include "Character/BreachlinePlayerCharacter.h"
#include "Character/HealthComponent.h"
#include "UI/BreachlinePlayerController.h"
#include "UI/BreachlineHUD.h"
#include "World/HealthKitPickup.h"
#include "Core/BreachlineBalance.h"
#include "Core/BreachlineSettings.h"
#include "Core/ProgressionSubsystem.h"
#include "World/CompoundBuilder.h"
#include "NavigationSystem.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "EngineUtils.h"
#include "BreachlineUE.h"

using namespace Breachline;

ABreachlineGameMode::ABreachlineGameMode()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickInterval = 0.1f;

	PlayerControllerClass = ABreachlinePlayerController::StaticClass();
	DefaultPawnClass = ABreachlinePlayerCharacter::StaticClass();
	HUDClass = ABreachlineHUD::StaticClass();
}

void ABreachlineGameMode::InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage)
{
	Super::InitGame(MapName, Options, ErrorMessage);

	UE_LOG(LogBreachline, Display, TEXT("[boot 1/5] InitGame (%s)"), *MapName);

	// Before any player exists: generate the arena if the level is empty, so the
	// default pawn spawns on the generated PlayerStart instead of at the origin.
	EnsureCompound();

	UE_LOG(LogBreachline, Display, TEXT("[boot 2/5] arena ready"));
}

void ABreachlineGameMode::EnsureCompound()
{
	UWorld* World = GetWorld();
	if (!World) return;

	bool bHasCompound = false;
	for (TActorIterator<AActor> It(World); It; ++It)
	{
		if (It->ActorHasTag(ACompoundBuilder::CompoundTag))
		{
			bHasCompound = true;
			break;
		}
	}

	if (bHasCompound)
	{
		UE_LOG(LogBreachline, Log, TEXT("Compound found in level: using the authored layout."));
		return;
	}

	UE_LOG(LogBreachline, Log, TEXT("No compound in level: building the arena at runtime."));
	FActorSpawnParameters Params;
	Params.ObjectFlags |= RF_Transient;
	if (ACompoundBuilder* Builder = World->SpawnActor<ACompoundBuilder>(
		ACompoundBuilder::StaticClass(), FTransform::Identity, Params))
	{
		Builder->Build();
	}
}

void ABreachlineGameMode::RebuildNavigation()
{
	// With dynamic generation enabled this is usually a no-op, but an explicit
	// build guarantees the first AI path request succeeds on frame one.
	if (UNavigationSystemV1* Nav = FNavigationSystem::GetCurrent<UNavigationSystemV1>(GetWorld()))
	{
		Nav->Build();
	}
}

void ABreachlineGameMode::BeginPlay()
{
	Super::BeginPlay();

	UE_LOG(LogBreachline, Display, TEXT("[boot 3/5] game mode BeginPlay"));

	RebuildNavigation();

	// The wave director is simulation state owned by the mode: spawned here so it
	// exists exactly once and dies with the match.
	FActorSpawnParameters Params;
	Params.ObjectFlags |= RF_Transient;
	Director = GetWorld()->SpawnActor<ASpawnDirector>(ASpawnDirector::StaticClass(), FTransform::Identity, Params);

	if (!Director)
	{
		UE_LOG(LogBreachline, Error, TEXT("Spawn director could not be spawned: no hostiles will appear."));
	}

	Player = Cast<ABreachlinePlayerCharacter>(UGameplayStatics::GetPlayerPawn(GetWorld(), 0));
	if (Player && Player->GetHealthComponent())
	{
		Player->GetHealthComponent()->OnDied.AddDynamic(this, &ABreachlineGameMode::HandlePlayerDied);
	}

	if (UProgressionSubsystem* Progression = GetWorld()->GetSubsystem<UProgressionSubsystem>())
	{
		Progression->OnRoundChanged.AddDynamic(this, &ABreachlineGameMode::HandleRoundChanged);
		Progression->StartRun();
		StartRound(0);
	}
	else
	{
		UE_LOG(LogBreachline, Error, TEXT("No progression subsystem: the round loop will not run."));
	}

	UE_LOG(LogBreachline, Display, TEXT("[boot 5/5] round loop running (operator: %s)"),
		Player ? *Player->GetName() : TEXT("NONE — the pawn was not spawned yet"));

	NextPickupTime = GetWorld()->GetTimeSeconds() + FMath::FRandRange(Pickups::SpawnEveryMin, Pickups::SpawnEveryMax);
}

void ABreachlineGameMode::StartRound(int32 Index)
{
	UProgressionSubsystem* Progression = GetWorld()->GetSubsystem<UProgressionSubsystem>();
	if (!Progression || !Director) return;

	Progression->BeginRound(Index);

	const FRoundDef& Round = Progression->GetRoundDef();

	// Round transition rule: the operator is restored to full health and full
	// ammo, and grenades top back up. This is a hard requirement of the design —
	// a round is a self-contained fight, not a war of attrition.
	if (Player)
	{
		if (UHealthComponent* Health = Player->GetHealthComponent())
		{
			Health->Resupply(1.f, Player::StartArmor);
		}
		Player->Resupply();

		if (ABreachlinePlayerController* PC = Cast<ABreachlinePlayerController>(Player->GetController()))
		{
			PC->NotifyResupply();
		}
	}

	Director->BeginRound(Round, this);
	bRoundActive = true;
}

void ABreachlineGameMode::EndRound(bool bCleared)
{
	bRoundActive = false;
	if (Director) Director->EndRound();

	if (!bCleared)
	{
		RestartRun();
		return;
	}

	UProgressionSubsystem* Progression = GetWorld()->GetSubsystem<UProgressionSubsystem>();
	if (!Progression) return;

	const int32 Bonus = Progression->CompleteRound();
	if (Player)
	{
		if (ABreachlinePlayerController* PC = Cast<ABreachlinePlayerController>(Player->GetController()))
		{
			PC->NotifyScore(Bonus, FText::FromString(TEXT("ROUND CLEAR")));
		}
	}

	if (Progression->IsFinalRound())
	{
		bVictory = true;
		UE_LOG(LogBreachline, Log, TEXT("MISSION COMPLETE. Final score %d."), Progression->Score);
		return;
	}

	StartRound(Progression->RoundIndex + 1);
}

void ABreachlineGameMode::RestartRun()
{
	// Full restart rather than a soft reset: the level generator rebuilds the
	// compound, so every run gets a fresh layout for free.
	UGameplayStatics::OpenLevel(this, FName(*GetWorld()->GetName()), false);
}

void ABreachlineGameMode::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	UWorld* World = GetWorld();
	if (!World) return;

	const float Now = World->GetTimeSeconds();

	if (!Player)
	{
		Player = Cast<ABreachlinePlayerCharacter>(UGameplayStatics::GetPlayerPawn(World, 0));
	}

	// Wave cleared: close the round (which starts the next one, or wins the run).
	if (bRoundActive && Director && Director->IsWaveCleared())
	{
		EndRound(/*bCleared*/ true);
	}

	// Medkits: at most Pickups::MaxActive on the map, spawned on a randomised
	// cadence inside the authored band and never next to the player.
	RefreshPickupLocations();
	if (!bDefeat && Now >= NextPickupTime)
	{
		NextPickupTime = Now + FMath::FRandRange(Pickups::SpawnEveryMin, Pickups::SpawnEveryMax);
		if (Pickups.Num() < Pickups::MaxActive)
		{
			SpawnPickup();
		}
	}

	if (bDefeat && bAutoRestartOnDefeat && DefeatTime > 0.f && Now - DefeatTime > 5.f)
	{
		RestartRun();
	}
}

void ABreachlineGameMode::SpawnPickup()
{
	UWorld* World = GetWorld();
	if (!World || !Player) return;

	// Reuse the spawn director's "far from the player and reachable" rule so field
	// kits never appear under the operator's feet.
	UNavigationSystemV1* Nav = FNavigationSystem::GetCurrent<UNavigationSystemV1>(World);
	if (!Nav) return;

	FVector Location = FVector::ZeroVector;
	bool bFound = false;
	const FVector PlayerLocation = Player->GetActorLocation();

	for (int32 Attempt = 0; Attempt < Spawn::PlacementAttempts && !bFound; ++Attempt)
	{
		const float Angle = FMath::FRandRange(0.f, 2.f * PI);
		const float DistanceM = FMath::FRandRange(Pickups::MinDistanceFromPlayerM, Pickups::MinDistanceFromPlayerM + 18.f);
		const FVector Candidate = PlayerLocation + FVector(FMath::Cos(Angle), FMath::Sin(Angle), 0.f) * MetersToUU(DistanceM);

		FNavLocation Projected;
		if (!Nav->ProjectPointToNavigation(Candidate, Projected, FVector(MetersToUU(8.f)))) continue;

		bool bClashes = false;
		for (const AHealthKitPickup* Existing : Pickups)
		{
			if (IsValid(Existing)
				&& FVector::Dist(Existing->GetActorLocation(), Projected.Location) < MetersToUU(Pickups::MinDistanceBetweenM))
			{
				bClashes = true;
				break;
			}
		}
		if (bClashes) continue;

		Location = Projected.Location + FVector(0.f, 0.f, MetersToUU(World::GroundThicknessM * 0.5f));
		bFound = true;
	}

	if (!bFound) return;

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	AHealthKitPickup* Pickup = World->SpawnActor<AHealthKitPickup>(
		AHealthKitPickup::StaticClass(), Location, FRotator::ZeroRotator, Params);
	if (Pickup)
	{
		Pickups.Add(Pickup);
	}
}

void ABreachlineGameMode::RefreshPickupLocations()
{
	PickupLocations.Reset();
	Pickups.RemoveAll([](const TObjectPtr<AHealthKitPickup>& Pickup) { return !IsValid(Pickup); });

	for (const AHealthKitPickup* Pickup : Pickups)
	{
		if (IsValid(Pickup) && !Pickup->bCollected)
		{
			const FVector Location = Pickup->GetActorLocation();
			PickupLocations.Add(FVector2D(Location.X, Location.Y));
		}
	}
}

void ABreachlineGameMode::HandlePlayerDied(AActor* Victim, AActor* Killer)
{
	if (bDefeat) return;

	bDefeat = true;
	bRoundActive = false;
	DefeatTime = GetWorld()->GetTimeSeconds();
	if (Director) Director->EndRound();

	UE_LOG(LogBreachline, Log, TEXT("Operator down — run over."));
}

void ABreachlineGameMode::HandleRoundChanged(int32 RoundIndex, FRoundDef RoundDef)
{
	if (!Player) return;
	if (ABreachlinePlayerController* PC = Cast<ABreachlinePlayerController>(Player->GetController()))
	{
		PC->NotifyScore(0, RoundDef.Label);
	}
	UE_LOG(LogBreachline, Log, TEXT("Round %d: %s — %d hostiles, max %d alive."),
		RoundIndex + 1, *RoundDef.Label.ToString(), RoundDef.TotalEnemies, RoundDef.MaxAlive);
}

int32 ABreachlineGameMode::GetEnemiesRemaining() const
{
	return Director ? Director->GetEnemiesRemaining() : 0;
}

FText ABreachlineGameMode::GetRoundLabel() const
{
	if (const UProgressionSubsystem* Progression = GetWorld() ? GetWorld()->GetSubsystem<UProgressionSubsystem>() : nullptr)
	{
		return Progression->GetRoundDef().Label;
	}
	return FText::GetEmpty();
}

int32 ABreachlineGameMode::GetRoundIndex() const
{
	const UProgressionSubsystem* Progression = GetWorld() ? GetWorld()->GetSubsystem<UProgressionSubsystem>() : nullptr;
	return Progression ? Progression->RoundIndex : 0;
}
