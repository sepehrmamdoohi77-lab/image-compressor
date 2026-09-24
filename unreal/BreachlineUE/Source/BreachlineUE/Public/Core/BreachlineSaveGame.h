// Copyright (c) Breachline UE. All rights reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/SaveGame.h"
#include "Core/BreachlineSettings.h"
#include "BreachlineSaveGame.generated.h"

/**
 * Player settings + run stats. Written to the "BreachlineProfile" slot.
 * Validation lives in UBreachlineGameInstance so a corrupted or hand-edited
 * file can never produce NaN volumes or an out-of-range camera.
 */
UCLASS()
class BREACHLINEUE_API UBreachlineSaveGame : public USaveGame
{
	GENERATED_BODY()

public:
	UPROPERTY(BlueprintReadWrite, Category = "Audio")
	float MasterVolume = 1.f;

	UPROPERTY(BlueprintReadWrite, Category = "Audio")
	float SfxVolume = 0.9f;

	UPROPERTY(BlueprintReadWrite, Category = "Audio")
	float AmbientVolume = 0.6f;

	UPROPERTY(BlueprintReadWrite, Category = "Audio")
	float UiVolume = 0.7f;

	UPROPERTY(BlueprintReadWrite, Category = "Camera")
	float MouseSensitivity = 1.f;

	UPROPERTY(BlueprintReadWrite, Category = "Camera")
	float CameraDistance = 20.f;

	UPROPERTY(BlueprintReadWrite, Category = "Camera")
	EBreachlineQuality Quality = EBreachlineQuality::High;

	UPROPERTY(BlueprintReadWrite, Category = "Camera")
	bool bInvertY = false;

	// --- lifetime stats (leaderboard fodder, not gameplay) -------------------
	UPROPERTY(BlueprintReadWrite, Category = "Stats")
	int32 BestScore = 0;

	UPROPERTY(BlueprintReadWrite, Category = "Stats")
	int32 BestRound = 0;

	UPROPERTY(BlueprintReadWrite, Category = "Stats")
	int32 TotalKills = 0;
};
