// Copyright (c) Breachline UE. All rights reserved.
//
// The squad brain. Deliberately NOT a Behaviour Tree: the web prototype's FSM
// (perceive -> decide -> act at 0.55 s decision ticks) is ported verbatim so the
// two builds fight identically, and so the "why did they do that?" question is
// always answerable from one file.
//
// Behaviours: patrol, investigate, search, engage with range management, take
// cover, lean-out cover rhythm with alternating shoulders, flank, retreat,
// tactical reload, hit reaction — plus shared squad intel and hearing.

#pragma once

#include "CoreMinimal.h"
#include "AIController.h"
#include "Core/BreachlineTypes.h"
#include "TacticalAIController.generated.h"

class ABreachlineEnemyCharacter;
class ACoverPoint;
class ABreachlinePlayerCharacter;

/** Per-enemy AI scratch (mirrors the web build's `ai` block). */
USTRUCT()
struct FEnemyAIState
{
	GENERATED_BODY()

	UPROPERTY() FVector LastSeenLocation = FVector::ZeroVector;
	UPROPERTY() FVector SuspicionLocation = FVector::ZeroVector;
	UPROPERTY() float LastSeenTime = -1000.f;
	UPROPERTY() float Confidence = 0.f;
	UPROPERTY() float Suspicion = 0.f;
	UPROPERTY() float StateTime = 0.f;
	UPROPERTY() float NextDecisionTime = 0.f;
	UPROPERTY() float NextPerceptionTime = 0.f;
	UPROPERTY() float NextRepathTime = 0.f;
	UPROPERTY() float ReactionTime = 0.f;
	UPROPERTY() float LastDamageTime = -1000.f;
	UPROPERTY() int32 BurstLeft = 0;
	UPROPERTY() float NextBurstTime = 0.f;
	UPROPERTY() int32 CoverPointIndex = INDEX_NONE;
	UPROPERTY() bool bCrouched = false;
	/** -1..1 lean while peeking: which shoulder is exposed. */
	UPROPERTY() float Lean = 0.f;
	UPROPERTY() float LeanTarget = 0.f;
	UPROPERTY() int32 PeekSide = 1;
	UPROPERTY() float ExposeUntil = 0.f;
	UPROPERTY() float HideUntil = 0.f;
	UPROPERTY() float NextFlankCheckTime = 0.f;
	UPROPERTY() float DamagedInCover = 0.f;
	UPROPERTY() float StrafeUntil = 0.f;
	UPROPERTY() int32 StrafeDirection = 1;
	UPROPERTY() int32 SearchIndex = 0;
	UPROPERTY() FVector HomeLocation = FVector::ZeroVector;
	UPROPERTY() FVector PatrolTarget = FVector::ZeroVector;
	UPROPERTY() bool bHasPatrolTarget = false;
};

UCLASS()
class BREACHLINEUE_API ATacticalAIController : public AAIController
{
	GENERATED_BODY()

public:
	ATacticalAIController();

	virtual void OnPossess(APawn* InPawn) override;
	virtual void OnUnPossess() override;
	virtual void Tick(float DeltaSeconds) override;

	/** Called by the combat path when this enemy takes damage. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|AI")
	void NotifyDamaged(float Amount, AActor* DamageCauser);

	/** A noise event reached this enemy (footsteps, gunfire, grenade). */
	UFUNCTION(BlueprintCallable, Category = "Breachline|AI")
	void HearNoise(const FVector& Location, float Loudness, float RadiusMeters);

	UFUNCTION(BlueprintPure, Category = "Breachline|AI")
	EEnemyState GetState() const { return State; }

	UFUNCTION(BlueprintPure, Category = "Breachline|AI")
	float GetConfidence() const { return AIState.Confidence; }

	UFUNCTION(BlueprintPure, Category = "Breachline|AI")
	FVector GetLastSeenLocation() const { return AIState.LastSeenLocation; }

	UFUNCTION(BlueprintPure, Category = "Breachline|AI")
	bool IsEngaged() const { return State == EEnemyState::Engaging || State == EEnemyState::Flanking; }

	/** Death hook: the FSM stops deciding as soon as the body drops. */
	UFUNCTION()
	void HandleEnemyDied(AActor* Victim, AActor* Killer);

	/** Set by the game mode so the AI knows what it is hunting. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|AI")
	void SetTargetPlayer(ABreachlinePlayerCharacter* InPlayer) { TargetPlayer = InPlayer; }

	/** Squad intel: a squadmate saw the player here. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|AI")
	void ReceiveSquadIntel(const FVector& ApproximateLocation, float Confidence);

protected:
	// --- pipeline ------------------------------------------------------------
	void Perceive(float Now);
	void Decide(float Now);
	void Act(float DeltaSeconds, float Now);
	void SetState(EEnemyState NewState, float Now);

	// --- perception helpers --------------------------------------------------
	bool CanSeeTarget(float Now) const;
	float ComputeConfidence(float Now) const;
	void UpdateFromSquad(float Now);

	// --- behaviour helpers ---------------------------------------------------
	void DecideCombat(float Now);
	bool TryTakeCover(float Now, const FVector& ThreatLocation);
	bool TryAdvanceCover(float Now, const FVector& ThreatLocation);
	bool TryRetreat(float Now, const FVector& ThreatLocation);
	bool TryFlank(float Now, const FVector& ThreatLocation);
	bool TryShoot(float Now);
	void PickPatrolTarget(float Now);
	void PickSearchPoint(float Now);
	bool MoveToLocationSafe(const FVector& Location, float Now, float AcceptanceRadiusMeters = 1.2f);
	bool HasReachedPathEnd() const;
	void ApplySeparation(float DeltaSeconds);
	void UpdateCoverLean(float DeltaSeconds);
	void FaceThreat(float DeltaSeconds, const FVector& ThreatLocation, bool bInstant = false);

	/** Nearest cover point that shields this enemy from the threat. */
	int32 FindCoverPoint(const FVector& ThreatLocation) const;
	bool CoverStillBlocks(int32 PointIndex, const FVector& ThreatLocation) const;
	void ClaimCover(int32 PointIndex);
	void ReleaseCover();

	UPROPERTY() TObjectPtr<ABreachlineEnemyCharacter> Enemy = nullptr;
	UPROPERTY() TObjectPtr<ABreachlinePlayerCharacter> TargetPlayer = nullptr;

	UPROPERTY() FEnemyAIState AIState;
	UPROPERTY() EEnemyState State = EEnemyState::Idle;

	/** True once the possessed pawn died: Tick short-circuits from here on. */
	bool bPossessedDead = false;
};
