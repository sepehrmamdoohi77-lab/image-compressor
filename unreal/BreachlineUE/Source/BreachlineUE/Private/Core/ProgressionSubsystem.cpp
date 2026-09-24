// Copyright (c) Breachline UE. All rights reserved.

#include "Core/ProgressionSubsystem.h"
#include "Core/BreachlineBalance.h"
#include "Core/BreachlineSettings.h"
#include "Engine/DataTable.h"
#include "BreachlineUE.h"

void UProgressionSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	Rounds = Breachline::DefaultRounds();

	// A DataTable in Project Settings overrides the C++ defaults: designers tune
	// waves without a recompile, and a missing/partial table just loses the rows
	// it does not override.
	if (const UDataTable* Table = UBreachlineSettings::Get()->ResolveRoundTable())
	{
		const TArray<FName> RowNames = Table->GetRowNames();
		if (RowNames.Num() > 0)
		{
			TArray<FRoundDef> Overridden;
			Overridden.Reserve(RowNames.Num());
			for (const FName& Row : RowNames)
			{
				if (const FRoundDef* Def = Table->FindRow<FRoundDef>(Row, TEXT("Progression"), false))
				{
					Overridden.Add(*Def);
				}
			}
			if (Overridden.Num() > 0)
			{
				Rounds = MoveTemp(Overridden);
				UE_LOG(LogBreachline, Log, TEXT("Round table override: %d rounds."), Rounds.Num());
			}
		}
	}
}

int32 UProgressionSubsystem::MultikillBonusFor(const FBreachlineScoring& S, int32 Chain)
{
	if (S.MultikillBonus.Num() == 0) return 0;
	return S.MultikillBonus[FMath::Min(Chain, S.MultikillBonus.Num() - 1)];
}

int32 UProgressionSubsystem::RoundClearBonusFor(const FBreachlineScoring& S, int32 Idx)
{
	if (S.RoundClearBonus.Num() == 0) return 0;
	return S.RoundClearBonus[FMath::Min(Idx + 1, S.RoundClearBonus.Num() - 1)];
}

FRoundDef UProgressionSubsystem::GetRoundDef() const
{
	static const FRoundDef Fallback;
	return Rounds.IsValidIndex(RoundIndex) ? Rounds[RoundIndex] : Fallback;
}

void UProgressionSubsystem::StartRun()
{
	RoundIndex = 0;
	Score = 0;
	Kills = 0;
	Headshots = 0;
	ShotsFired = 0;
	ShotsHit = 0;
	GrenadeKills = 0;
	LastKillTime = -1000.f;
	BeginRound(0);
}

void UProgressionSubsystem::BeginRound(int32 Index)
{
	RoundIndex = FMath::Clamp(Index, 0, FMath::Max(0, Rounds.Num() - 1));
	RoundKills = 0;
	RoundTotal = GetRoundDef().TotalEnemies;
	RoundDamageTaken = 0.f;
	RoundShots = 0;
	RoundHits = 0;
	KillChain = 0;
	LastBonus = 0;
	LastBonusLabel = FText::GetEmpty();
	OnRoundChanged.Broadcast(RoundIndex, GetRoundDef());
}

void UProgressionSubsystem::OnShotFired(bool bHit)
{
	ShotsFired++;
	RoundShots++;
	if (bHit)
	{
		ShotsHit++;
		RoundHits++;
	}
}

int32 UProgressionSubsystem::OnEnemyKilled(int32 ScoreValue, bool bHeadshot, bool bWithGrenade)
{
	Kills++;
	RoundKills++;

	int32 Gained = ScoreValue;
	if (bHeadshot)
	{
		Headshots++;
		Gained += Scoring.HeadshotBonus;
	}
	if (bWithGrenade)
	{
		GrenadeKills++;
		Gained += Scoring.GrenadeBonus;
	}

	const UWorld* World = GetWorld();
	const float Now = World ? World->GetTimeSeconds() : 0.f;
	KillChain = (Now - LastKillTime <= Scoring.MultikillWindow) ? KillChain + 1 : 1;
	LastKillTime = Now;

	const int32 Multi = MultikillBonusFor(Scoring, KillChain);
	Gained += Multi;
	LastBonus = Multi;
	LastBonusLabel = KillChain >= 2
		? FText::FromString(FString::Printf(TEXT("MULTI-KILL x%d"), KillChain))
		: FText::GetEmpty();

	Score += Gained;
	OnKillScored.Broadcast(NAME_None, bHeadshot, Gained);
	return Gained;
}

void UProgressionSubsystem::OnPlayerDamaged(float Amount)
{
	RoundDamageTaken += FMath::Max(0.f, Amount);
}

int32 UProgressionSubsystem::CompleteRound()
{
	int32 Bonus = RoundClearBonusFor(Scoring, RoundIndex);
	const float Acc = RoundShots > 0 ? float(RoundHits) / float(RoundShots) : 0.f;
	if (Acc >= Scoring.AccuracyBonusThreshold && RoundShots >= 10) Bonus += Scoring.AccuracyBonus;
	if (RoundDamageTaken <= 0.f) Bonus += Scoring.NoDamageBonus;
	Score += Bonus;
	return Bonus;
}

int32 UProgressionSubsystem::AdvanceRound()
{
	if (IsFinalRound())
	{
		OnRunFinished.Broadcast(true);
		return INDEX_NONE;
	}
	BeginRound(RoundIndex + 1);
	return RoundIndex;
}
