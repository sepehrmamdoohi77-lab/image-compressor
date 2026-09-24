// Copyright (c) Breachline UE. All rights reserved.
//
// CENTRAL BALANCE TABLE — one place for every tuning number, exactly like the
// web prototype's `src/game/data/config.ts`. Gameplay code must read from here
// (or from a DataAsset that starts life as these values) rather than using
// magic numbers, so a designer can retune the game without touching logic.
//
// Units: metres, seconds, degrees. Values are converted to Unreal centimetres
// at the point of use (see MetersToUU).

#pragma once

#include "CoreMinimal.h"
#include "Core/BreachlineTypes.h"

namespace Breachline
{
	/** Metres -> Unreal units. */
	FORCEINLINE constexpr float MetersToUU(float Meters) { return Meters * BREACHLINE_CM_PER_M; }

	// ---------------------------------------------------------------- world ----
	namespace World
	{
		/** Grid size in cells (the compound is 44 x 44 cells). */
		constexpr int32 SizeCells = 44;
		/** One gameplay cell in metres. UE uses 4 m cells for a real-map scale. */
		constexpr float CellMeters = 4.f;
		constexpr float CellUU = CellMeters * BREACHLINE_CM_PER_M;
		constexpr float HalfExtentMeters = (SizeCells * CellMeters) * 0.5f;

		constexpr float WallHeightM = 4.0f;
		constexpr float BuildingHeightM = 5.2f;
		constexpr float LowCoverHeightM = 1.1f;
		constexpr float MidCoverHeightM = 1.45f;
		constexpr float EyeHeightM = 1.65f;
		constexpr float CharacterRadiusM = 0.4f;
		constexpr float CharacterHeightM = 1.85f;
		constexpr float GroundThicknessM = 0.4f;
	}

	// --------------------------------------------------------------- camera ----
	namespace Camera
	{
		constexpr float ElevationDeg = 40.f;   // lowered twice: 55 -> 46 -> 40
		constexpr float AzimuthDeg = 45.f;
		constexpr float DistanceM = 20.f;
		constexpr float MinDistanceM = 12.f;
		constexpr float MaxDistanceM = 30.f;
		constexpr float Fov = 38.f;
		constexpr float FollowSmoothing = 7.5f;
		constexpr float LookAhead = 1.6f;
		constexpr float ShakeDecay = 2.6f;
		constexpr float MaxShakeOffsetM = 0.45f;
		constexpr float FireKickM = 0.05f;
		constexpr float ExplosionKickM = 0.6f;
		constexpr float BoundaryMarginM = 8.f;
		constexpr float BoundaryHeightM = 40.f;
	}

	// --------------------------------------------------------------- player ----
	namespace Player
	{
		constexpr float MaxHealth = 100.f;
		constexpr float MaxArmor = 100.f;
		constexpr float StartArmor = 50.f;
		constexpr float WalkSpeedMps = 4.6f;
		constexpr float SprintMultiplier = 1.62f;
		constexpr float SprintAccelBonus = 1.35f;
		constexpr float AimMoveMultiplier = 0.55f;
		constexpr float CrouchMultiplier = 0.5f;
		constexpr float Accel = 26.f;
		constexpr float Decel = 30.f;
		constexpr int32 Grenades = 3;
		constexpr int32 MaxGrenades = 4;
		constexpr float ResupplyArmor = 40.f;
		constexpr float NoiseRadiusWalkM = 12.f;
		constexpr float NoiseRadiusSprintM = 23.f;
		constexpr float StandingEyeHeightM = 1.65f;
		constexpr float CrouchedEyeHeightM = 1.05f;
	}

	// --------------------------------------------------- enemy fallibility -----
	namespace AI
	{
		constexpr float MemoryDuration = 7.f;
		constexpr float SuspicionDuration = 4.f;
		constexpr float DecisionInterval = 0.55f;
		constexpr float PerceptionInterval = 0.18f;
		constexpr float CoverSearchRadiusM = 20.f;
		constexpr float FlankAngleDeg = 55.f;
		constexpr float RetreatHealthFrac = 0.28f;
		constexpr float MoveRepathInterval = 1.4f;
		constexpr float SeparationRadiusM = 1.2f;
		constexpr float AimErrorBase = 0.055f;      // radians at accuracy 0
		constexpr float AimErrorMoveTarget = 0.05f;
		constexpr float AimErrorMoveSelf = 0.035f;
		constexpr float HearingMemoryConf = 0.45f;
		constexpr float SquadShareRadiusM = 30.f;
		constexpr float SquadShareNoiseM = 3.5f;
		constexpr float SquadConfFactor = 0.6f;

		// Deliberate near misses: the round cracks past the player instead of
		// being scattered randomly, so a miss reads as "close", not "broken".
		constexpr float MissChanceBase = 0.08f;
		constexpr float MissChanceAccuracyScale = 0.3f;
		constexpr float MissChanceMoving = 0.1f;
		constexpr float MissChanceDistance = 0.07f;
		constexpr float MissChanceSuppressed = 0.08f;
		constexpr float MissLateralM = 1.0f;
		constexpr float MissVerticalM = 0.45f;
		constexpr float NearMissRadiusM = 1.8f;

		// Cover discipline.
		constexpr float CoverPeekMin = 1.2f;
		constexpr float CoverPeekMax = 2.4f;
		constexpr float CoverHideMin = 1.0f;
		constexpr float CoverHideMax = 2.0f;
		constexpr float CoverLean = 0.42f;          // radians
		constexpr float CoverLeanDamp = 6.5f;       // per second
		constexpr float CoverRelocateAfter = 7.5f;
		constexpr float CoverRelocateDamageFrac = 0.35f;
		constexpr float CoverReuseCooldown = 16.f;
		constexpr float CoverReusePenalty = 45.f;
		constexpr float CoverFlankRecheck = 1.1f;
		constexpr float SuppressedHoldChance = 0.75f;
		/** Accuracy multipliers applied on top of the archetype's base skill. */
		constexpr float MovingFireAccuracyMult = 0.78f;
		constexpr float SuppressedAccuracyMult = 0.62f;
		constexpr float SuppressionWindowS = 1.6f;
		constexpr float CoverAdvanceChance = 0.3f;
		constexpr float CoverLeanOffsetM = 0.75f;
		constexpr float PeekCrouchHeightM = 1.0f;
	}

	// --------------------------------------------------- danger telegraph -----
	namespace Threats
	{
		constexpr float RadiusM = 21.f;
		constexpr int32 MaxIndicators = 6;
		constexpr float HudCloseRadiusM = 8.f;
		constexpr float HudFarRadiusM = 26.f;
		constexpr float AwareBoost = 1.4f;
		constexpr float PulseHz = 2.4f;
		constexpr float RingMinM = 0.45f;
		constexpr float RingMaxM = 1.1f;
		/** Awareness above this weight lights the danger line and the radar blips. */
		constexpr float AwareThreshold = 0.55f;
		/** Unaware enemies only appear up close (and faintly). */
		constexpr float FaintContactRangeM = 12.f;
		constexpr float CorpseBlipRangeM = 8.f;
		constexpr float FaintWeight = 0.3f;
		constexpr float CorpseWeight = 0.12f;
		/** Threat picture refresh + the pulse of the danger beep. */
		constexpr float RefreshInterval = 0.1f;
		constexpr float BeepInterval = 1.35f;
	}

	// ---------------------------------------------------------- field kits ----
	namespace Pickups
	{
		constexpr float HealthFraction = 0.3f;
		constexpr int32 MaxActive = 2;
		constexpr float SpawnEveryMin = 11.f;
		constexpr float SpawnEveryMax = 18.f;
		constexpr float Lifetime = 34.f;
		constexpr float PickupRadiusM = 1.35f;
		constexpr float MinDistanceFromPlayerM = 9.f;
		constexpr float MinDistanceBetweenM = 5.f;
		constexpr float BobAmplitudeM = 0.12f;
		constexpr float SpinRate = 0.9f;
	}

	// --------------------------------------------------------------- radar ----
	namespace Radar
	{
		constexpr float SpanMeters = 52.f;
		constexpr float BlipRangeM = 26.f;
	}

	// -------------------------------------------------------- damage model ----
	namespace Damage
	{
		constexpr float ZoneHead = 2.1f;    // weapon headshot multipliers override
		constexpr float ZoneTorso = 1.f;
		constexpr float ZoneArms = 0.75f;
		constexpr float ZoneLegs = 0.65f;
		constexpr float ArmorAbsorb = 0.65f;   // fraction of damage armor eats
		constexpr float ArmorDepletion = 0.5f; // armor points per absorbed hit
		constexpr float GrenadeRadiusM = 6.f;
		constexpr float GrenadeDamage = 110.f;
		constexpr float GrenadeSelfMult = 0.55f;
		constexpr float GrenadeFuseS = 2.2f;
	}

	// ---------------------------------------------------------- HUD feel --------
	namespace Hud
	{
		/** Camera kick/shake authored beside the HUD that reacts to it. */
		constexpr float FireTrauma = 0.045f;
		constexpr float NearMissTrauma = 0.16f;
		constexpr float ExplosionTrauma = 0.55f;
		constexpr float DamageTraumaScale = 0.4f;
		/** Banners (resupply / heal / score) linger this long. */
		constexpr float BannerSeconds = 1.9f;
		/** Directional damage indicator lifetime. */
		constexpr float DamageIndicatorSeconds = 0.9f;
		/** Radar canvas size in pixels (square), as specified for the web build. */
		constexpr float RadarSizePx = 158.f;
	}

	// ------------------------------------------------------------ spawning ------
	namespace Spawn
	{
		constexpr float MinDistanceFromPlayerM = 34.f;
		constexpr float MinDistanceBetweenM = 6.f;
		/** Spawn placement gives up after this many tries and relaxes the rules. */
		constexpr int32 PlacementAttempts = 24;
		/** Enemies of one wave enter staggered, so a wave is a firefight not a wall. */
		constexpr float StaggerIntervalS = 0.85f;
		/** "Reinforcements inbound" telegraph before the staggered entry. */
		constexpr float TelegraphS = 2.2f;
		/** Ground ring used to place a squad: inner/outer radius from a chosen anchor. */
		constexpr float RingMinM = 20.f;
		constexpr float RingMaxM = 40.f;
	}

	// ------------------------------------------------------------ FX ------------
	namespace FX
	{
		constexpr float MuzzleFlashScale = 0.42f;
		constexpr float MuzzleFlashLightIntensity = 12000.f;
		constexpr float TracerThickness = 2.2f;
		constexpr float TracerThicknessEnemy = 3.4f;
		constexpr float CorpseFadeS = 3.5f;
	}

	// ------------------------------------------------------- authored data ----
	/** Five weapons, tuned for distinct feel (identical numbers to the web build). */
	TArray<FBreachlineWeaponDef> DefaultWeapons();

	/** Four archetypes with their own gear, personality and economy. */
	TArray<FEnemyArchetypeDef> DefaultEnemyArchetypes();

	/** Five rounds of escalation. */
	TArray<FRoundDef> DefaultRounds();

	/** Index into the archetype array for an id (INDEX_NONE when unknown). */
	int32 ArchetypeIndex(FName Id);
}
