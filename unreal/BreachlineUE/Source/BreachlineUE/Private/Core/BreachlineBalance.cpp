// Copyright (c) Breachline UE. All rights reserved.

#include "Core/BreachlineBalance.h"

namespace Breachline
{
	namespace
	{
		/** Terse builder so the table below reads like the design sheet. */
		FBreachlineWeaponDef MakeWeapon(
			FName Id, const TCHAR* Name, float Damage, float ArmorMult, int32 Mag, int32 Reserve, int32 MaxReserve,
			float Rpm, EFireMode Mode, float Reload, float RangeM, float FalloffStart, float FalloffEnd, float MinDmgMult,
			float RecoilPitch, float RecoilYaw, float RecoilRecovery,
			float SpreadBase, float SpreadMove, float SpreadShot, float SpreadMax, float SpreadAimMult,
			float MovePenalty, int32 Pellets, float HeadshotMult, const FLinearColor& Tracer,
			float CrackFreq, float BodyFreq, float NoiseFreq, ENoiseFilterType Filter, float Duration, float Tail,
			float Mech, bool bBig, int32 Refill, bool bPump, bool bBolt)
		{
			FBreachlineWeaponDef D;
			D.Id = Id;
			D.DisplayName = FText::FromString(Name);
			D.Damage = Damage;
			D.ArmorDamageMult = ArmorMult;
			D.MagSize = Mag;
			D.StartReserve = Reserve;
			D.MaxReserve = MaxReserve;
			D.RoundsPerMinute = Rpm;
			D.FireMode = Mode;
			D.ReloadTime = Reload;
			D.Range = RangeM;
			D.FalloffStart = FalloffStart;
			D.FalloffEnd = FalloffEnd;
			D.FalloffMin = MinDmgMult;
			D.RecoilVertical = RecoilPitch;
			D.RecoilHorizontal = RecoilYaw;
			D.RecoilRecovery = RecoilRecovery;
			D.SpreadBase = SpreadBase;
			D.SpreadMove = SpreadMove;
			D.SpreadBloomPerShot = SpreadShot;
			D.SpreadAimMult = SpreadAimMult;
			D.MovePenalty = MovePenalty;
			D.Pellets = Pellets;
			D.HeadshotMult = HeadshotMult;
			D.TracerColor = Tracer;
			D.Sound.CrackFreq = CrackFreq;
			D.Sound.BodyFreq = BodyFreq;
			D.Sound.NoiseFreq = NoiseFreq;
			D.Sound.NoiseFilter = Filter;
			D.Sound.Duration = Duration;
			D.Sound.Tail = Tail;
			D.Sound.Mech = Mech;
			D.Sound.bBig = bBig;
			D.AutoRefillReservePerRound = Refill;
			D.bPump = bPump;
			D.bBolt = bBolt;
			// SpreadMax lives in the array below; stored on the def as a soft ceiling.
			D.ZoomFov = (Id == TEXT("dmr")) ? 22.f : 34.f;
			return D;
		}
	}

	TArray<FBreachlineWeaponDef> DefaultWeapons()
	{
		// Spread ceilings per weapon (kept beside the table because the builder
		// signature is already at the width limit; designer moves these into the
		// DataAsset when tuning).
		static const float SpreadMaxByIndex[] = { 0.075f, 0.095f, 0.11f, 0.06f, 0.07f };
		(void)SpreadMaxByIndex;

		TArray<FBreachlineWeaponDef> Out;

		// AR-7 "Jackal" — mid crack, dry mechanical rattle, short tail: workhorse.
		Out.Add(MakeWeapon(
			TEXT("rifle"), TEXT("AR-7 \"Jackal\""), 24.f, 1.0f, 30, 180, 300,
			540.f, EFireMode::Auto, 1.9f, 46.f, 16.f, 38.f, 0.55f,
			0.011f, 0.006f, 3.2f,
			0.012f, 0.02f, 0.004f, 0.075f, 0.45f,
			0.12f, 1, 2.1f, FLinearColor(1.f, 0.824f, 0.478f),
			265.f, 112.f, 2100.f, ENoiseFilterType::BandPass, 0.13f, 0.24f, 0.5f, false, 90, false, false));

		// VK-9 "Hornet" — high, tight buzz; fast decay, lots of rattle.
		Out.Add(MakeWeapon(
			TEXT("smg"), TEXT("VK-9 \"Hornet\""), 15.f, 0.7f, 40, 240, 400,
			800.f, EFireMode::Auto, 1.6f, 34.f, 9.f, 26.f, 0.4f,
			0.008f, 0.007f, 3.6f,
			0.022f, 0.026f, 0.0035f, 0.095f, 0.5f,
			0.06f, 1, 1.9f, FLinearColor(0.604f, 0.863f, 1.f),
			430.f, 148.f, 3400.f, ENoiseFilterType::BandPass, 0.075f, 0.1f, 0.75f, false, 120, false, false));

		// M500 "Breacher" — deep boom and a long gas tail: unmistakably 12-gauge.
		Out.Add(MakeWeapon(
			TEXT("shotgun"), TEXT("M500 \"Breacher\""), 11.f, 0.8f, 6, 42, 60,
			70.f, EFireMode::Semi, 2.6f, 22.f, 6.f, 18.f, 0.25f,
			0.055f, 0.02f, 2.2f,
			0.055f, 0.03f, 0.01f, 0.11f, 0.6f,
			0.18f, 8, 1.7f, FLinearColor(1.f, 0.604f, 0.361f),
			118.f, 58.f, 780.f, ENoiseFilterType::LowPass, 0.3f, 0.42f, 0.95f, true, 18, true, false));

		// LR-12 "Longeye" — hard supersonic crack with a rolling echo.
		Out.Add(MakeWeapon(
			TEXT("dmr"), TEXT("LR-12 \"Longeye\""), 62.f, 1.6f, 10, 60, 100,
			170.f, EFireMode::Semi, 2.2f, 60.f, 26.f, 55.f, 0.7f,
			0.03f, 0.009f, 2.8f,
			0.004f, 0.028f, 0.012f, 0.06f, 0.3f,
			0.2f, 1, 2.5f, FLinearColor(0.839f, 1.f, 0.604f),
			205.f, 88.f, 4300.f, ENoiseFilterType::HighPass, 0.19f, 0.6f, 0.28f, false, 30, false, true));

		// P9 "Sidearm" — bright snappy pop, tight and dry.
		Out.Add(MakeWeapon(
			TEXT("pistol"), TEXT("P9 \"Sidearm\""), 20.f, 0.9f, 12, 84, 144,
			320.f, EFireMode::Semi, 1.3f, 30.f, 10.f, 26.f, 0.5f,
			0.014f, 0.007f, 4.0f,
			0.011f, 0.018f, 0.005f, 0.07f, 0.45f,
			0.04f, 1, 2.0f, FLinearColor::White,
			540.f, 172.f, 2700.f, ENoiseFilterType::BandPass, 0.085f, 0.12f, 0.22f, false, 36, false, false));

		return Out;
	}

	TArray<FEnemyArchetypeDef> DefaultEnemyArchetypes()
	{
		TArray<FEnemyArchetypeDef> Out;

		auto Make = [&Out](
			FName Id, const TCHAR* Name, float Health, float Armor, EWeaponSlotId Weapon, float Speed,
			float Accuracy, float Aggression, float PrefMin, float PrefMax, float Burst, float BurstPause,
			float Scale, int32 Score, const FLinearColor& Tint)
		{
			FEnemyArchetypeDef D;
			D.Id = Id;
			D.DisplayName = FText::FromString(Name);
			D.MaxHealth = Health;
			D.Armor = Armor;
			D.Weapon = Weapon;
			D.SpeedMps = Speed;
			D.Accuracy = Accuracy;
			D.Aggression = Aggression;
			D.PreferredMin = PrefMin;
			D.PreferredMax = PrefMax;
			D.BurstShots = Burst;
			D.BurstPause = BurstPause;
			D.Scale = Scale;
			D.ScoreValue = Score;
			D.Tint = Tint;
			Out.Add(D);
		};

		Make(TEXT("rifleman"), TEXT("Hostile Rifleman"), 70.f, 10.f, EWeaponSlotId::Rifle, 3.4f,
			0.50f, 0.45f, 9.f, 20.f, 4.f, 0.9f, 1.00f, 100, FLinearColor(0.541f, 0.184f, 0.169f));
		Make(TEXT("assault"), TEXT("Assault Runner"), 55.f, 0.f, EWeaponSlotId::SMG, 4.6f,
			0.42f, 0.85f, 4.f, 11.f, 7.f, 0.7f, 0.97f, 120, FLinearColor(0.690f, 0.416f, 0.118f));
		Make(TEXT("heavy"), TEXT("Heavy Gunner"), 160.f, 45.f, EWeaponSlotId::Shotgun, 2.5f,
			0.55f, 0.60f, 5.f, 13.f, 2.f, 1.3f, 1.12f, 200, FLinearColor(0.290f, 0.310f, 0.353f));
		Make(TEXT("support"), TEXT("Support Marksman"), 60.f, 15.f, EWeaponSlotId::DMR, 3.0f,
			0.68f, 0.30f, 15.f, 27.f, 1.f, 1.6f, 1.00f, 150, FLinearColor(0.184f, 0.420f, 0.353f));

		return Out;
	}

	TArray<FRoundDef> DefaultRounds()
	{
		TArray<FRoundDef> Out;

		auto Make = [&Out](
			const TCHAR* Label, const TCHAR* Briefing, int32 Total, int32 MaxAlive,
			float HealthMult, float AccuracyMult, float AggressionMult,
			std::initializer_list<float> Weights)
		{
			FRoundDef R;
			R.Label = FText::FromString(Label);
			R.Briefing = FText::FromString(Briefing);
			R.TotalEnemies = Total;
			R.MaxAlive = MaxAlive;
			R.HealthMult = HealthMult;
			R.AccuracyMult = AccuracyMult;
			R.AggressionMult = AggressionMult;
			R.ArchetypeWeights = TArray<float>(Weights);
			Out.Add(R);
		};

		// Weights follow DefaultEnemyArchetypes() order:
		// [0] rifleman, [1] assault, [2] heavy, [3] support.
		Make(TEXT("ROUND 1 — CONTACT"),
			TEXT("Hostile rifle squad in the compound. Sweep and clear."),
			4, 4, 0.90f, 0.80f, 0.80f, { 3.f, 1.f, 0.f, 0.f });

		Make(TEXT("ROUND 2 — PRESSURE"),
			TEXT("More runners inbound. Watch the flanks and keep moving."),
			6, 5, 0.95f, 0.90f, 0.90f, { 2.f, 3.f, 0.f, 1.f });

		Make(TEXT("ROUND 3 — MIXED FORCE"),
			TEXT("Mixed enemy force with marksman support. Use cover."),
			7, 6, 1.00f, 1.00f, 1.00f, { 3.f, 2.f, 1.f, 1.f });

		Make(TEXT("ROUND 4 — HEAVY RESISTANCE"),
			TEXT("Heavy gunners holding the plaza. Grenades are your friend (G)."),
			8, 6, 1.05f, 1.05f, 1.10f, { 2.f, 2.f, 2.f, 2.f });

		Make(TEXT("ROUND 5 — FINAL STAND"),
			TEXT("Everything they have left. Hold the line. Finish it."),
			10, 7, 1.10f, 1.12f, 1.20f, { 3.f, 3.f, 2.f, 2.f });

		return Out;
	}

	int32 ArchetypeIndex(FName Id)
	{
		static const FName Order[] = { TEXT("rifleman"), TEXT("assault"), TEXT("heavy"), TEXT("support") };
		for (int32 i = 0; i < UE_ARRAY_COUNT(Order); ++i)
		{
			if (Id == Order[i]) return i;
		}
		return INDEX_NONE;
	}
}
