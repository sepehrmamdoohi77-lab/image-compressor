// Copyright (c) Breachline UE. All rights reserved.

#pragma once

#include "CoreMinimal.h"
#include "Engine/GameInstance.h"
#include "Core/BreachlineSaveGame.h"
#include "BreachlineGameInstance.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FBreachlineSettingsChanged, UBreachlineSaveGame*, Settings);

/**
 * Owns the persistent profile (settings + lifetime stats) and applies them to
 * the running world: audio bus levels, camera distance and the quality tier.
 * Corrupted storage degrades to defaults instead of breaking the boot.
 */
UCLASS()
class BREACHLINEUE_API UBreachlineGameInstance : public UGameInstance
{
	GENERATED_BODY()

public:
	UBreachlineGameInstance();

	virtual void Init() override;

	UFUNCTION(BlueprintPure, Category = "Breachline|Settings")
	UBreachlineSaveGame* GetProfile() const { return Profile; }

	UFUNCTION(BlueprintCallable, Category = "Breachline|Settings")
	void ApplySettings();

	UFUNCTION(BlueprintCallable, Category = "Breachline|Settings")
	void SaveProfile();

	/** Clamps every field into its legal range; safe for hand-edited saves. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Settings")
	void SanitizeProfile();

	/** Quality tier -> scalability CVars (Lumen Lite on Medium, MegaLights on High). */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Settings")
	void ApplyQualityTier(EBreachlineQuality Quality);

	UPROPERTY(BlueprintAssignable, Category = "Breachline|Settings")
	FBreachlineSettingsChanged OnSettingsChanged;

	static const FString ProfileSlot;

private:
	UPROPERTY(Transient)
	TObjectPtr<UBreachlineSaveGame> Profile = nullptr;
};
