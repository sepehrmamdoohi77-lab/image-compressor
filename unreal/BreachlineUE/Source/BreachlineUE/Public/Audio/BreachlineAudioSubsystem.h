// Copyright (c) Breachline UE. All rights reserved.

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "Core/BreachlineTypes.h"
#include "BreachlineAudioSubsystem.generated.h"

class AActor;
class UBreachlineSfxSynth;
class UBreachlineGameInstance;
class UBreachlineSaveGame;

/**
 * Mixes the game. Owns:
 *   - two synth "buses" (world SFX + UI) so settings volumes apply per bus,
 *   - distance attenuation and stereo panning computed here (the synth has no
 *     spatialiser of its own: one component, many sources),
 *   - the ambient bed toggle.
 *
 * Sound designers can replace any cue with a MetaSound/SoundCue: the Play*
 * functions are the single funnel, so there is exactly one place to swap.
 */
UCLASS()
class BREACHLINEUE_API UBreachlineAudioSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	// --- gameplay cues -------------------------------------------------------
	void PlayShot(const FBreachlineWeaponDef& Weapon, const FVector& Location, bool bEnemy);
	void PlayReloadStart(AActor* Shooter, const FBreachlineWeaponDef& Weapon);
	void PlayReloadEnd(AActor* Shooter, const FBreachlineWeaponDef& Weapon);
	void PlayFootstep(AActor* Walker, bool bRunning);
	void PlayImpact(const FVector& Location, bool bFlesh, bool bMetal);
	void PlayNearMiss(const FVector& Location);
	void PlayExplosion(const FVector& Location);
	void PlayPickup(const FVector& Location);
	void PlayDryFire(AActor* Shooter);
	void PlayUi(bool bConfirm);

	/** Called when the settings change; re-reads the profile volumes. */
	void RefreshVolumes();

	UFUNCTION(BlueprintPure, Category = "Breachline|Audio")
	UBreachlineSfxSynth* GetWorldSynth() const { return WorldSynth; }

	/** Maximum simultaneous voices; Low quality clamps this. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Audio")
	void SetVoiceBudgetScale(float Scale);

	/** Bound to the GameInstance broadcast so menu volume changes apply live. */
	UFUNCTION()
	void HandleSettingsChanged(UBreachlineSaveGame* Settings);

private:
	/** Distance attenuation curve: full inside 6 m, silent past MaxDist. */
	float DistanceGain(const FVector& Location) const;
	/** Stereo pan relative to the listener's right vector. */
	float PanFor(const FVector& Location) const;
	FVector ListenerLocation() const;
	FVector ListenerRight() const;

	/** Resolves a cue into (gain, pan, distance) and plays it. */
	void PlayOnWorld(const TFunctionRef<void(UBreachlineSfxSynth&, float, float, float)>& Fn, const FVector& Location);

	UPROPERTY(Transient) TObjectPtr<UBreachlineSfxSynth> WorldSynth = nullptr;
	UPROPERTY(Transient) TObjectPtr<UBreachlineSfxSynth> UiSynth = nullptr;

	float MasterVolume = 1.f;
	float SfxVolume = 0.9f;
	float AmbientVolume = 0.6f;
	float UiVolume = 0.7f;
	float VoiceBudgetScale = 1.f;

	/** Cached listener so panning is stable across a frame's many cues. */
	mutable FVector CachedListener = FVector::ZeroVector;
	mutable FVector CachedRight = FVector::RightVector;
	mutable bool bListenerValid = false;
};
