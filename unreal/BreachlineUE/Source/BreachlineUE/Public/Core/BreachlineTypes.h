// Copyright (c) Breachline UE. All rights reserved.
//
// Shared gameplay types. This header is intentionally asset-free and
// engine-light: every other system (weapons, AI, HUD, analytics) speaks these
// types, which keeps the data contract in one place — the UE equivalent of the
// web prototype's `src/game/data/config.ts` types.

#pragma once

#include "CoreMinimal.h"
#include "BreachlineTypes.generated.h"

// Engine classes referenced only through pointers / soft pointers in the USTRUCTs
// below. They have to be named here: this header pulls in nothing but CoreMinimal,
// and an undeclared name inside a TSoftObjectPtr member is a compile error.
class AActor;
class ACharacter;
class UStaticMesh;
class UNiagaraSystem;

/** 1 Unreal unit = 1 cm. All gameplay numbers below are authored in metres. */
#define BREACHLINE_CM_PER_M 100.f

/** Biquad filter mode used by the procedural audio synth. */
UENUM(BlueprintType)
enum class ENoiseFilterType : uint8
{
	LowPass,
	HighPass,
	BandPass
};

UENUM(BlueprintType)
enum class EWeaponSlotId : uint8
{
	Rifle		UMETA(DisplayName = "Rifle"),
	SMG			UMETA(DisplayName = "SMG"),
	Shotgun		UMETA(DisplayName = "Shotgun"),
	DMR			UMETA(DisplayName = "DMR"),
	Pistol		UMETA(DisplayName = "Pistol"),
	MAX			UMETA(Hidden)
};

UENUM(BlueprintType)
enum class EFireMode : uint8
{
	Auto,
	Semi
};

UENUM(BlueprintType)
enum class EHitZone : uint8
{
	Head,
	Torso,
	Arms,
	Legs
};

UENUM(BlueprintType)
enum class EEnemyArchetype : uint8
{
	Rifleman,
	Assault,
	Heavy,
	Support
};

/** Mirror of the web prototype's FSM (`EnemyStateName`). */
UENUM(BlueprintType)
enum class EEnemyState : uint8
{
	Idle,
	Patrol,
	Suspicious,
	Investigating,
	Searching,
	Engaging,
	TakingCover,
	InCover,
	Flanking,
	Retreating,
	Reloading,
	HitReaction,
	Dead
};

/** Acoustic signature of a weapon — drives UBreachlineSfxSynth (no assets). */
USTRUCT(BlueprintType)
struct FWeaponSoundSignature
{
	GENERATED_BODY()

	/** Noise-burst centre frequency of the muzzle crack (Hz). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Sound")
	float CrackFreq = 265.f;

	/** Square-wave body thump (Hz). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Sound")
	float BodyFreq = 112.f;

	/** Centre frequency of the noise layer (Hz): the "air" of the shot. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Sound")
	float NoiseFreq = 2100.f;

	/** Filter type for the crack layer. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Sound")
	ENoiseFilterType NoiseFilter = ENoiseFilterType::BandPass;

	/** Noise burst length (seconds). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Sound")
	float Duration = 0.13f;

	/** Tail/reverb send length (seconds) — reads as distance down the block. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Sound")
	float Tail = 0.24f;

	/** Mechanical layer (bolt/pump/mag) loudness 0..1. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Sound")
	float Mech = 0.5f;

	/** 12-gauge boom: extra sub oscillator + longer decay. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Sound")
	bool bBig = false;
};

/** A weapon, fully described by data (`DA_Weapon_*` assets or C++ defaults). */
USTRUCT(BlueprintType)
struct FBreachlineWeaponDef
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Identity")
	FName Id = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Identity")
	FText DisplayName;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
	float Damage = 24.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
	float ArmorDamageMult = 1.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
	float RoundsPerMinute = 640.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
	EFireMode FireMode = EFireMode::Auto;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
	int32 MagSize = 30;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
	int32 StartReserve = 180;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
	int32 MaxReserve = 300;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
	int32 Pellets = 1;

	/** Hard range cap (metres): beyond this a shot cannot connect. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
	float Range = 60.f;

	/** Falloff curve: full damage to FalloffStart, then lerp to FalloffMin at FalloffEnd. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
	float FalloffStart = 16.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
	float FalloffEnd = 38.f;

	/** Damage multiplier at FalloffEnd. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
	float FalloffMin = 0.55f;

	/** How much reserve ammo the squad hands back on a round change. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
	int32 AutoRefillReservePerRound = 90;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
	float ReloadTime = 2.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Ballistics")
	float ZoomFov = 38.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Handling")
	float RecoilVertical = 0.5f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Handling")
	float RecoilHorizontal = 0.25f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Handling")
	float RecoilRecovery = 8.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Handling")
	float SpreadBase = 0.006f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Handling")
	float SpreadMove = 0.012f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Handling")
	float SpreadBloomPerShot = 0.004f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Handling")
	float SpreadAimMult = 0.5f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Handling")
	float MovePenalty = 0.05f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Handling")
	float HeadshotMult = 2.25f;

	/** Reload cadence: magazine (rifle/smg/pistol), pump (shotgun) or bolt (DMR). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Handling")
	bool bPump = false;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Handling")
	bool bBolt = false;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Sound")
	FWeaponSoundSignature Sound;

	/** Barrels/assets — soft, because the gun still works without them. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Presentation")
	TSoftObjectPtr<UStaticMesh> BodyMesh;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Presentation")
	TSoftObjectPtr<UNiagaraSystem> MuzzleFX;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Presentation")
	FLinearColor TracerColor = FLinearColor(1.f, 0.82f, 0.45f);
};

/** A hostile template (health, weapon, brain personality, economy). */
USTRUCT(BlueprintType)
struct FEnemyArchetypeDef
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	FName Id = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	FText DisplayName;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	float MaxHealth = 100.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	float Armor = 0.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	EWeaponSlotId Weapon = EWeaponSlotId::Rifle;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	float Accuracy = 0.5f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	float Aggression = 0.5f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	float SpeedMps = 3.4f;

	/** Preferred engagement band (metres). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	float PreferredMin = 8.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	float PreferredMax = 22.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	float BurstShots = 3.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	float BurstPause = 0.9f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	float Scale = 1.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	int32 ScoreValue = 100;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	FLinearColor Tint = FLinearColor::White;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	TSoftClassPtr<ACharacter> CharacterClass;
};

/** One wave of the run. */
USTRUCT(BlueprintType)
struct FRoundDef
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	FText Label;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	FText Briefing;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	int32 TotalEnemies = 8;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	int32 MaxAlive = 4;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	float HealthMult = 1.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	float AccuracyMult = 1.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	float AggressionMult = 1.f;

	/** Archetype weights, index-matched to the spawn table order. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite)
	TArray<float> ArchetypeWeights;
};

/** Result of one bullet resolution. */
USTRUCT(BlueprintType)
struct FBulletResult
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Breachline") bool bHit = false;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") bool bKilled = false;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") EHitZone Zone = EHitZone::Torso;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") float Damage = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") FVector ImpactPoint = FVector::ZeroVector;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") FVector ImpactNormal = FVector::UpVector;
	/**
	 * Weak on purpose: a bullet report outlives the frame it was produced in, and a
	 * hit actor may be destroyed before the HUD consumes it. Not Blueprint-exposed
	 * because UHT rejects weak pointers on BlueprintReadOnly properties.
	 */
	UPROPERTY() TWeakObjectPtr<AActor> HitActor;
};

/** One hostile contact, as the danger telegraph and radar consume it. */
USTRUCT(BlueprintType)
struct FThreatContact
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Breachline") int32 Id = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") FVector Location = FVector::ZeroVector;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") bool bAlive = true;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") float Confidence = 0.f;
};

USTRUCT(BlueprintType)
struct FRadarBlip
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Breachline") FVector2D Location = FVector2D::ZeroVector;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") float Weight = 0.f;
};

/** Everything the HUD needs for one frame (mirrors the web `HudSnapshot`). */
USTRUCT(BlueprintType)
struct FHudSnapshot
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Breachline") float Health = 100.f;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") float MaxHealth = 100.f;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") float Armor = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") float MaxArmor = 100.f;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") int32 MagAmmo = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") int32 ReserveAmmo = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") bool bReloading = false;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") FName WeaponId;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") FText WeaponName;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") int32 Grenades = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") int32 Score = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") int32 Kills = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") int32 Headshots = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") int32 ShotsFired = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") int32 ShotsHit = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") int32 RoundIndex = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") FText RoundLabel;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") int32 EnemiesRemaining = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") bool bSprinting = false;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") bool bAiming = false;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") bool bCrouched = false;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") int32 MedkitsUsed = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") float LastHeal = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") float ThreatLevel = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") float ThreatAngleDeg = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") int32 ThreatCount = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") float ThreatDistance = -1.f;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") float ResupplyFade = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") TArray<FRadarBlip> RadarContacts;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline") TArray<FVector2D> RadarPickups;
};
