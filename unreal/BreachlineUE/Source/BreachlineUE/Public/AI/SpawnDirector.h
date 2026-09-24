// Copyright (c) Breachline UE. All rights reserved.
//
// Wave director. Decides WHAT spawns, WHERE and WHEN:
//   * composition  — weighted archetype draw from the round table,
//   * placement    — navmesh-validated anchors, never inside the player's lap,
//   * pacing       — a telegraph, then a staggered entry capped by MaxAlive.
//
// The AI controller owns how a soldier fights; this owns when there is one.
// Splitting them means difficulty can be retuned without touching behaviour.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Core/BreachlineTypes.h"
#include "SpawnDirector.generated.h"

class ABreachlineEnemyCharacter;
class ABreachlinePlayerCharacter;
class ABreachlineGameMode;

UCLASS()
class BREACHLINEUE_API ASpawnDirector : public AActor
{
	GENERATED_BODY()

public:
	ASpawnDirector();

	virtual void Tick(float DeltaSeconds) override;

	/** Starts a wave for this round definition. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Spawn")
	void BeginRound(const FRoundDef& InRound, ABreachlineGameMode* InOwner);

	/** Stops the wave and clears state (between rounds). */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Spawn")
	void EndRound();

	/** True when every enemy of the wave has spawned and died. */
	UFUNCTION(BlueprintPure, Category = "Breachline|Spawn")
	bool IsWaveCleared() const;

	/** Queued + alive. Drives the HUD's "hostiles remaining". */
	UFUNCTION(BlueprintPure, Category = "Breachline|Spawn")
	int32 GetEnemiesRemaining() const;

	UFUNCTION(BlueprintPure, Category = "Breachline|Spawn")
	int32 GetAliveCount() const;

	UFUNCTION(BlueprintPure, Category = "Breachline|Spawn")
	float GetTelegraphRemaining() const;

	UFUNCTION(BlueprintPure, Category = "Breachline|Spawn")
	const TArray<ABreachlineEnemyCharacter*>& GetLiveEnemies() const { return LiveEnemies; }

protected:
	/** One enemy per call, using the weighted composition. */
	void SpawnOne();
	void PruneDead();

	/** Weighted archetype draw from Round.ArchetypeWeights. */
	int32 DrawArchetypeIndex() const;

	/** Navmesh point that is far enough from the player; false when none found. */
	bool FindSpawnLocation(FVector& OutLocation) const;

	/** Finds a spot that is not already occupied by a squadmate or the player. */
	bool IsLocationFree(const FVector& Location, float MinDistanceM) const;

	UPROPERTY() TObjectPtr<ABreachlineGameMode> Owner = nullptr;
	UPROPERTY() TObjectPtr<ABreachlinePlayerCharacter> Player = nullptr;

	UPROPERTY() TArray<ABreachlineEnemyCharacter*> LiveEnemies;

	FRoundDef Round;

	int32 TotalToSpawn = 0;
	int32 SpawnedCount = 0;
	float TelegraphEndTime = 0.f;
	float NextSpawnTime = 0.f;
	bool bRunning = false;
};
