// Copyright (c) Breachline UE. All rights reserved.
//
// The run: five rounds of escalating pressure on one 176 m compound.
//   round start  -> full heal + full ammo (a deliberate reset between rounds)
//                -> telegraph -> staggered wave -> clear -> score + bonus
//   player death -> defeat, restart; final round cleared -> victory.
//
// Everything the HUD needs (enemies left, round label, pickup positions) is
// exposed as a read, never pushed: the controller polls once per frame.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "Core/BreachlineTypes.h"
#include "BreachlineGameMode.generated.h"

class ASpawnDirector;
class AHealthKitPickup;
class ABreachlinePlayerCharacter;
class UProgressionSubsystem;

UCLASS()
class BREACHLINEUE_API ABreachlineGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	ABreachlineGameMode();

	/**
	 * Runs before the player controller/pawn exist, which is the only window in
	 * which a runtime-generated level can place a PlayerStart and have it used.
	 */
	virtual void InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage) override;

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	/** Starts a round: resupply, wave, celebration of the previous result. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Game")
	void StartRound(int32 Index);

	UFUNCTION(BlueprintCallable, Category = "Breachline|Game")
	void EndRound(bool bCleared);

	/** Restarts the whole run (defeat, or the player pressing R on the banner). */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Game")
	void RestartRun();

	// --- reads for the HUD ---------------------------------------------------
	UFUNCTION(BlueprintPure, Category = "Breachline|Game")
	int32 GetEnemiesRemaining() const;

	UFUNCTION(BlueprintPure, Category = "Breachline|Game")
	FText GetRoundLabel() const;

	UFUNCTION(BlueprintPure, Category = "Breachline|Game")
	int32 GetRoundIndex() const;

	UFUNCTION(BlueprintPure, Category = "Breachline|Game")
	bool IsVictory() const { return bVictory; }

	UFUNCTION(BlueprintPure, Category = "Breachline|Game")
	bool IsDefeat() const { return bDefeat; }

	/** Active medkit world positions (XY), for the radar. */
	UFUNCTION(BlueprintPure, Category = "Breachline|Game")
	const TArray<FVector2D>& GetPickupLocations() const { return PickupLocations; }

	UFUNCTION(BlueprintPure, Category = "Breachline|Game")
	ASpawnDirector* GetSpawnDirector() const { return Director; }

protected:
	/**
	 * Authored level present -> nothing happens. Empty level -> the compound is
	 * generated so "press Play in a fresh checkout" is a supported workflow.
	 */
	void EnsureCompound();

	void RebuildNavigation();

	void SpawnPickup();
	void RefreshPickupLocations();
	void HandlePlayerDied(AActor* Victim, AActor* Killer);
	void HandleRoundChanged(int32 RoundIndex, FRoundDef RoundDef);

	UPROPERTY() TObjectPtr<ASpawnDirector> Director = nullptr;
	UPROPERTY() TObjectPtr<ABreachlinePlayerCharacter> Player = nullptr;
	UPROPERTY() TArray<TObjectPtr<AHealthKitPickup>> Pickups;
	UPROPERTY() TArray<FVector2D> PickupLocations;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Game")
	bool bAutoRestartOnDefeat = true;

	/** Seconds between medkit spawn attempts, randomised inside the authored band. */
	float NextPickupTime = 0.f;
	bool bRoundActive = false;
	bool bVictory = false;
	bool bDefeat = false;
	float DefeatTime = -1.f;
};
