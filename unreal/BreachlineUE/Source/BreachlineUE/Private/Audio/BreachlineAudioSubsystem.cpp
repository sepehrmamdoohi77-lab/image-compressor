// Copyright (c) Breachline UE. All rights reserved.

#include "Audio/BreachlineAudioSubsystem.h"
#include "Audio/BreachlineSfxSynth.h"
#include "Core/BreachlineSaveGame.h"
#include "Core/BreachlineGameInstance.h"
#include "Core/BreachlineBalance.h"
#include "Engine/World.h"
#include "Engine/GameInstance.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/Pawn.h"
#include "BreachlineUE.h"

using namespace Breachline;

namespace
{
	constexpr float MaxAudibleDistanceM = 140.f;
	constexpr float FullVolumeDistanceM = 6.f;
}

void UBreachlineAudioSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	UWorld* World = GetWorld();
	if (!World) return;

	// World synth: everything positional. UI synth: menus and interface.
	WorldSynth = NewObject<UBreachlineSfxSynth>(World);
	WorldSynth->RegisterComponent();
	WorldSynth->Start();
	WorldSynth->SetAmbientEnabled(true);

	UiSynth = NewObject<UBreachlineSfxSynth>(World);
	UiSynth->RegisterComponent();
	UiSynth->Start();
	UiSynth->SetAmbientEnabled(false);

	if (UGameInstance* GameInstance = World->GetGameInstance())
	{
		if (UBreachlineGameInstance* BreachlineGI = Cast<UBreachlineGameInstance>(GameInstance))
		{
			BreachlineGI->OnSettingsChanged.AddDynamic(this, &UBreachlineAudioSubsystem::HandleSettingsChanged);
		}
	}

	RefreshVolumes();
}

void UBreachlineAudioSubsystem::Deinitialize()
{
	if (IsValid(WorldSynth))
	{
		WorldSynth->Stop();
		WorldSynth->DestroyComponent();
	}
	WorldSynth = nullptr;
	if (IsValid(UiSynth))
	{
		UiSynth->Stop();
		UiSynth->DestroyComponent();
	}
	UiSynth = nullptr;

	Super::Deinitialize();
}

void UBreachlineAudioSubsystem::RefreshVolumes()
{
	const UBreachlineSaveGame* Profile = nullptr;
	if (const UWorld* World = GetWorld())
	{
		if (const UBreachlineGameInstance* GI = Cast<UBreachlineGameInstance>(World->GetGameInstance()))
		{
			Profile = GI->GetProfile();
		}
	}
	if (Profile)
	{
		MasterVolume = Profile->MasterVolume;
		SfxVolume = Profile->SfxVolume;
		AmbientVolume = Profile->AmbientVolume;
		UiVolume = Profile->UiVolume;
	}

	if (WorldSynth)
	{
		WorldSynth->SetMasterGain(MasterVolume * SfxVolume);
		WorldSynth->SetAmbientLevel(MasterVolume * AmbientVolume);
	}
	if (UiSynth)
	{
		UiSynth->SetMasterGain(MasterVolume * UiVolume);
	}
}

FVector UBreachlineAudioSubsystem::ListenerLocation() const
{
	if (!bListenerValid)
	{
		if (const UWorld* World = GetWorld())
		{
			if (const APlayerController* PC = World->GetFirstPlayerController())
			{
				if (const APawn* Pawn = PC->GetPawn())
				{
					CachedListener = Pawn->GetActorLocation();
					CachedRight = Pawn->GetActorRightVector();
				}
			}
		}
		bListenerValid = true;
	}
	return CachedListener;
}

FVector UBreachlineAudioSubsystem::ListenerRight() const
{
	ListenerLocation();
	return CachedRight;
}

float UBreachlineAudioSubsystem::DistanceGain(const FVector& Location) const
{
	const float DistanceM = FVector::Dist(Location, ListenerLocation()) / MetersToUU(1.f);
	if (DistanceM <= FullVolumeDistanceM) return 1.f;
	if (DistanceM >= MaxAudibleDistanceM) return 0.f;

	// Inverse-distance-ish curve: loud near, believable tail far away.
	const float T = (DistanceM - FullVolumeDistanceM) / (MaxAudibleDistanceM - FullVolumeDistanceM);
	return FMath::Square(1.f - T);
}

float UBreachlineAudioSubsystem::PanFor(const FVector& Location) const
{
	const FVector ToSource = (Location - ListenerLocation()).GetSafeNormal();
	return FMath::Clamp(FVector::DotProduct(ToSource, ListenerRight()), -1.f, 1.f);
}

void UBreachlineAudioSubsystem::PlayOnWorld(
	const TFunctionRef<void(UBreachlineSfxSynth&, float, float, float)>& Fn, const FVector& Location)
{
	if (!WorldSynth) return;

	// One listener cache fill per cue batch keeps panning consistent.
	bListenerValid = false;

	const float Distance = DistanceGain(Location);
	if (Distance <= 0.001f) return; // inaudible: never spend a voice on it

	Fn(*WorldSynth, SfxVolume * FMath::Min(1.f, VoiceBudgetScale + 0.25f), PanFor(Location), Distance);
}

void UBreachlineAudioSubsystem::PlayShot(const FBreachlineWeaponDef& Weapon, const FVector& Location, bool bEnemy)
{
	PlayOnWorld([&](UBreachlineSfxSynth& Synth, float Gain, float Pan, float Dist)
	{
		// Hostile fire is slightly hotter in the mix so incoming rounds read.
		Synth.PlayShot(Weapon.Sound, Gain * (bEnemy ? 1.15f : 1.f), Pan, Dist);
	}, Location);
}

void UBreachlineAudioSubsystem::PlayReloadStart(AActor* Shooter, const FBreachlineWeaponDef& Weapon)
{
	const FVector Location = Shooter ? Shooter->GetActorLocation() : ListenerLocation();
	PlayOnWorld([&](UBreachlineSfxSynth& Synth, float Gain, float Pan, float Dist)
	{
		Synth.PlayReload(Weapon, /*bStart*/ true, Gain, Pan);
		(void)Dist;
	}, Location);
}

void UBreachlineAudioSubsystem::PlayReloadEnd(AActor* Shooter, const FBreachlineWeaponDef& Weapon)
{
	const FVector Location = Shooter ? Shooter->GetActorLocation() : ListenerLocation();
	PlayOnWorld([&](UBreachlineSfxSynth& Synth, float Gain, float Pan, float Dist)
	{
		Synth.PlayReload(Weapon, /*bStart*/ false, Gain, Pan);
		(void)Dist;
	}, Location);
}

void UBreachlineAudioSubsystem::PlayFootstep(AActor* Walker, bool bRunning)
{
	const FVector Location = Walker ? Walker->GetActorLocation() : ListenerLocation();
	PlayOnWorld([&](UBreachlineSfxSynth& Synth, float Gain, float Pan, float Dist)
	{
		Synth.PlayFootstep(bRunning, Gain * Dist, Pan);
	}, Location);
}

void UBreachlineAudioSubsystem::PlayImpact(const FVector& Location, bool bFlesh, bool bMetal)
{
	PlayOnWorld([&](UBreachlineSfxSynth& Synth, float Gain, float Pan, float Dist)
	{
		Synth.PlayImpact(bFlesh, bMetal, Gain, Pan);
		(void)Dist;
	}, Location);
}

void UBreachlineAudioSubsystem::PlayNearMiss(const FVector& Location)
{
	// Always played: a whiz is a survivability cue, never attenuated to nothing.
	if (WorldSynth)
	{
		bListenerValid = false;
		WorldSynth->PlayNearMiss(SfxVolume, 0.f);
	}
	(void)Location;
}

void UBreachlineAudioSubsystem::PlayExplosion(const FVector& Location)
{
	PlayOnWorld([&](UBreachlineSfxSynth& Synth, float Gain, float Pan, float Dist)
	{
		Synth.PlayExplosion(Gain, Pan);
		(void)Dist;
	}, Location);
}

void UBreachlineAudioSubsystem::PlayPickup(const FVector& Location)
{
	PlayOnWorld([&](UBreachlineSfxSynth& Synth, float Gain, float Pan, float Dist)
	{
		Synth.PlayPickup(Gain, Pan);
		(void)Dist;
	}, Location);
}

void UBreachlineAudioSubsystem::PlayDryFire(AActor* Shooter)
{
	const FVector Location = Shooter ? Shooter->GetActorLocation() : ListenerLocation();
	PlayOnWorld([&](UBreachlineSfxSynth& Synth, float Gain, float Pan, float Dist)
	{
		Synth.PlayDryFire(Gain, Pan);
		(void)Dist;
	}, Location);
}

void UBreachlineAudioSubsystem::PlayUi(bool bConfirm)
{
	if (UiSynth)
	{
		UiSynth->PlayUi(bConfirm, UiVolume);
	}
}

void UBreachlineAudioSubsystem::SetVoiceBudgetScale(float Scale)
{
	VoiceBudgetScale = FMath::Clamp(Scale, 0.f, 1.f);
	if (WorldSynth)
	{
		WorldSynth->SetMasterGain(MasterVolume * SfxVolume * FMath::Max(0.25f, VoiceBudgetScale));
	}
}

void UBreachlineAudioSubsystem::HandleSettingsChanged(UBreachlineSaveGame* Settings)
{
	(void)Settings;
	RefreshVolumes();
}
