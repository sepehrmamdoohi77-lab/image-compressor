// Copyright (c) Breachline UE. All rights reserved.

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "Core/BreachlineTypes.h"
#include "ProgressionSubsystem.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FBreachlineKillScored, FName, ArchetypeId, bool, bHeadshot, int32, ScoreGained);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FBreachlineRoundChanged, int32, RoundIndex, FRoundDef, RoundDef);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FBreachlineRunFinished, bool, bVictory);

/** Scoring constants, kept beside the events that emit them. */
USTRUCT(BlueprintType)
struct FBreachlineScoring
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Scoring") int32 HeadshotBonus = 50;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Scoring") int32 GrenadeBonus = 75;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Scoring") float MultikillWindow = 3.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Scoring") TArray<int32> MultikillBonus = { 0, 0, 100, 200, 350, 500 };
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Scoring") TArray<int32> RoundClearBonus = { 0, 250, 350, 500, 700, 1000 };
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Scoring") float AccuracyBonusThreshold = 0.5f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Scoring") int32 AccuracyBonus = 300;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Scoring") int32 NoDamageBonus = 500;
};

/**
 * Rounds, objectives and scoring. Pure lookups (MultikillBonusFor /
 * RoundClearBonusFor) are static so they are testable without a world —
 * the same layout the web prototype used.
 */
UCLASS()
class BREACHLINEUE_API UProgressionSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;

	// --- pure helpers -------------------------------------------------------
	static int32 MultikillBonusFor(const FBreachlineScoring& S, int32 Chain);
	static int32 RoundClearBonusFor(const FBreachlineScoring& S, int32 RoundIndex);

	// --- run lifecycle ------------------------------------------------------
	UFUNCTION(BlueprintCallable, Category = "Breachline|Progression")
	void StartRun();

	UFUNCTION(BlueprintCallable, Category = "Breachline|Progression")
	void BeginRound(int32 Index);

	/** Returns the next round index, or INDEX_NONE when the run is won. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Progression")
	int32 AdvanceRound();

	UFUNCTION(BlueprintCallable, Category = "Breachline|Progression")
	int32 CompleteRound();

	// --- scoring -------------------------------------------------------------
	UFUNCTION(BlueprintCallable, Category = "Breachline|Progression")
	void OnShotFired(bool bHit);

	UFUNCTION(BlueprintCallable, Category = "Breachline|Progression")
	int32 OnEnemyKilled(int32 ScoreValue, bool bHeadshot, bool bWithGrenade);

	UFUNCTION(BlueprintCallable, Category = "Breachline|Progression")
	void OnPlayerDamaged(float Amount);

	// --- reads ---------------------------------------------------------------
	UFUNCTION(BlueprintPure, Category = "Breachline|Progression")
	int32 GetRoundIndex() const { return RoundIndex; }

	UFUNCTION(BlueprintPure, Category = "Breachline|Progression")
	bool IsFinalRound() const { return RoundIndex >= Rounds.Num() - 1; }

	UFUNCTION(BlueprintPure, Category = "Breachline|Progression")
	int32 GetTotalRounds() const { return Rounds.Num(); }

	UFUNCTION(BlueprintPure, Category = "Breachline|Progression")
	const FRoundDef& GetRoundDef() const;

	UFUNCTION(BlueprintPure, Category = "Breachline|Progression")
	float GetAccuracy() const { return ShotsFired > 0 ? float(ShotsHit) / float(ShotsFired) : 0.f; }

	UFUNCTION(BlueprintPure, Category = "Breachline|Progression")
	const TArray<FRoundDef>& GetRounds() const { return Rounds; }

	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Progression") int32 RoundIndex = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Progression") int32 Score = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Progression") int32 Kills = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Progression") int32 Headshots = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Progression") int32 ShotsFired = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Progression") int32 ShotsHit = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Progression") int32 GrenadeKills = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Progression") int32 RoundKills = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Progression") int32 RoundTotal = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Progression") float RoundDamageTaken = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Progression") int32 LastBonus = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Progression") FText LastBonusLabel;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Progression") int32 KillChain = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Progression")
	FBreachlineScoring Scoring;

	UPROPERTY(BlueprintAssignable, Category = "Breachline|Progression")
	FBreachlineKillScored OnKillScored;

	UPROPERTY(BlueprintAssignable, Category = "Breachline|Progression")
	FBreachlineRoundChanged OnRoundChanged;

	UPROPERTY(BlueprintAssignable, Category = "Breachline|Progression")
	FBreachlineRunFinished OnRunFinished;

private:
	UPROPERTY()
	TArray<FRoundDef> Rounds;

	float LastKillTime = -1000.f;
	int32 RoundShots = 0;
	int32 RoundHits = 0;
};
