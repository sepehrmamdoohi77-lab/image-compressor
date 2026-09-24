// Copyright (c) Breachline UE. All rights reserved.

#include "Core/BreachlineGameInstance.h"
#include "Core/BreachlineBalance.h"
#include "BreachlineUE.h"
#include "Kismet/GameplayStatics.h"
#include "HAL/IConsoleManager.h"

const FString UBreachlineGameInstance::ProfileSlot = TEXT("BreachlineProfile");

UBreachlineGameInstance::UBreachlineGameInstance()
{
	// Nothing to construct: the profile is created on Init so a missing save
	// never blocks construction (dedicated servers / headless tests).
}

void UBreachlineGameInstance::Init()
{
	Super::Init();

	if (UGameplayStatics::DoesSaveGameExist(ProfileSlot, 0))
	{
		Profile = Cast<UBreachlineSaveGame>(UGameplayStatics::LoadGameFromSlot(ProfileSlot, 0));
	}
	if (!Profile)
	{
		Profile = Cast<UBreachlineSaveGame>(UGameplayStatics::CreateSaveGameObject(UBreachlineSaveGame::StaticClass()));
		UE_LOG(LogBreachline, Log, TEXT("No profile found — created defaults."));
	}

	SanitizeProfile();
	ApplySettings();
}

void UBreachlineGameInstance::SanitizeProfile()
{
	if (!Profile)
	{
		Profile = Cast<UBreachlineSaveGame>(UGameplayStatics::CreateSaveGameObject(UBreachlineSaveGame::StaticClass()));
	}
	if (!Profile) return; // engine without SaveGame support: fail soft.

	auto Clamp01Or = [](float Value, float Fallback)
	{
		return FMath::IsFinite(Value) ? FMath::Clamp(Value, 0.f, 1.f) : Fallback;
	};

	Profile->MasterVolume = Clamp01Or(Profile->MasterVolume, 1.f);
	Profile->SfxVolume = Clamp01Or(Profile->SfxVolume, 0.9f);
	Profile->AmbientVolume = Clamp01Or(Profile->AmbientVolume, 0.6f);
	Profile->UiVolume = Clamp01Or(Profile->UiVolume, 0.7f);
	Profile->MouseSensitivity = FMath::IsFinite(Profile->MouseSensitivity)
		? FMath::Clamp(Profile->MouseSensitivity, 0.1f, 4.f) : 1.f;
	Profile->CameraDistance = FMath::Clamp(
		Profile->CameraDistance, Breachline::Camera::MinDistanceM, Breachline::Camera::MaxDistanceM);
	Profile->BestScore = FMath::Max(0, Profile->BestScore);
	Profile->BestRound = FMath::Max(0, Profile->BestRound);
	Profile->TotalKills = FMath::Max(0, Profile->TotalKills);

	if (Profile->Quality != EBreachlineQuality::Low
		&& Profile->Quality != EBreachlineQuality::Medium
		&& Profile->Quality != EBreachlineQuality::High)
	{
		Profile->Quality = EBreachlineQuality::High;
	}
}

void UBreachlineGameInstance::ApplySettings()
{
	if (!Profile) return;

	ApplyQualityTier(Profile->Quality);

	// Audio volumes are read by UBreachlineAudioSubsystem each time it mixes.
	OnSettingsChanged.Broadcast(Profile);
}

void UBreachlineGameInstance::SaveProfile()
{
	if (!Profile) return;
	SanitizeProfile();
	if (!UGameplayStatics::SaveGameToSlot(Profile, ProfileSlot, 0))
	{
		UE_LOG(LogBreachline, Warning, TEXT("Failed to write profile slot '%s'."), *ProfileSlot);
	}
}

void UBreachlineGameInstance::ApplyQualityTier(EBreachlineQuality Quality)
{
	// Set through CVars so the tier applies immediately *and* is inspector-visible,
	// instead of being hidden inside a scalability preset.
	struct FSetting { const TCHAR* CVar; float Value; };
	TArray<FSetting> Settings;

	switch (Quality)
	{
	case EBreachlineQuality::Low:
		// Handheld / integrated: Lumen off, no VSM, TSR at 66%, no volumetrics.
		Settings = {
			{ TEXT("r.DynamicGlobalIlluminationMethod"), 0.f },
			{ TEXT("r.ReflectionMethod"), 0.f },
			{ TEXT("r.Shadow.Virtual.Enable"), 0.f },
			{ TEXT("r.Shadow.CSM.MaxCascades"), 2.f },
			{ TEXT("r.ScreenPercentage"), 66.f },
			{ TEXT("r.MegaLights.EnableForProject"), 0.f },
			{ TEXT("r.VolumetricFog"), 0.f },
			{ TEXT("r.Nanite.ProjectEnabled"), 1.f },
			{ TEXT("r.Lumen.HardwareRayTracing"), 0.f },
		};
		break;

	case EBreachlineQuality::Medium:
		// Console / laptop: Lumen Lite (5.8 irradiance fields), VSM on, MegaLights off.
		Settings = {
			{ TEXT("r.DynamicGlobalIlluminationMethod"), 1.f },
			{ TEXT("r.ReflectionMethod"), 1.f },
			{ TEXT("r.Lumen.HardwareRayTracing"), 0.f },
			{ TEXT("r.Lumen.Quality"), 1.f },        // Lumen Lite
			{ TEXT("r.Shadow.Virtual.Enable"), 1.f },
			{ TEXT("r.Shadow.CSM.MaxCascades"), 3.f },
			{ TEXT("r.ScreenPercentage"), 80.f },
			{ TEXT("r.MegaLights.EnableForProject"), 0.f },
			{ TEXT("r.VolumetricFog"), 1.f },
			{ TEXT("r.Nanite.ProjectEnabled"), 1.f },
		};
		break;

	case EBreachlineQuality::High:
	default:
		// High-end desktop: Lumen HW RT + MegaLights + full virtual shadow maps.
		Settings = {
			{ TEXT("r.DynamicGlobalIlluminationMethod"), 1.f },
			{ TEXT("r.ReflectionMethod"), 1.f },
			{ TEXT("r.Lumen.HardwareRayTracing"), 1.f },
			{ TEXT("r.Lumen.Quality"), 2.f },
			{ TEXT("r.Shadow.Virtual.Enable"), 1.f },
			{ TEXT("r.Shadow.CSM.MaxCascades"), 4.f },
			{ TEXT("r.ScreenPercentage"), 100.f },
			{ TEXT("r.MegaLights.EnableForProject"), 1.f },
			{ TEXT("r.VolumetricFog"), 1.f },
			{ TEXT("r.Nanite.ProjectEnabled"), 1.f },
		};
		break;
	}

	for (const FSetting& S : Settings)
	{
		if (IConsoleVariable* CVar = IConsoleManager::Get().FindConsoleVariable(S.CVar))
		{
			CVar->Set(S.Value, ECVF_SetByGameSetting);
		}
	}

	UE_LOG(LogBreachline, Log, TEXT("Quality tier applied: %d"), static_cast<int32>(Quality));
}
