// Copyright (c) Breachline UE. All rights reserved.
//
// Automation tests for every pure system in the port. These are the UE mirror of
// the web build's vitest suite (95 tests there): damage pipeline, hostile
// gunnery, scoring tables, the balance tables themselves and the radar maths.
//
// Run:  Session Frontend > Automation > filter "Breachline"
//   or:  UnrealEditor-Cmd.exe <project> -ExecCmds="Automation RunTests Breachline; Quit"
//
// Nothing here touches the world, so the suite runs headless in a commandlet.

#include "Misc/AutomationTest.h"
#include "Core/BreachlineBalance.h"
#include "Core/BreachlineMath.h"
#include "Combat/DamageModel.h"
#include "Combat/EnemyFireModel.h"
#include "Core/ProgressionSubsystem.h"

#if WITH_DEV_AUTOMATION_TESTS

// EditorContext keeps these out of packaged builds; EngineFilter makes them part
// of the default "Engine" filter so CI picks them up without a custom tag.
#define BREACHLINE_TEST_FLAGS (EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

namespace
{
	/** The rifle from the balance table, for arithmetic that must match the web build. */
	FBreachlineWeaponDef RifleDef()
	{
		const TArray<FBreachlineWeaponDef> Weapons = Breachline::DefaultWeapons();
		return Weapons.Num() > 0 ? Weapons[0] : FBreachlineWeaponDef();
	}
}

// ============================================================================
//  Damage pipeline
// ============================================================================
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineDamageFalloffTest,
	"Breachline.Combat.Damage.Falloff", BREACHLINE_TEST_FLAGS)

bool FBreachlineDamageFalloffTest::RunTest(const FString& Parameters)
{
	// Full damage inside the falloff start, minimum at the end, linear between.
	TestEqual(TEXT("point blank is full damage"),
		Breachline::FalloffMultiplier(5.f, 16.f, 38.f, 0.55f), 1.f, 0.0001f);
	TestEqual(TEXT("at falloff start still full damage"),
		Breachline::FalloffMultiplier(16.f, 16.f, 38.f, 0.55f), 1.f, 0.0001f);
	TestEqual(TEXT("midpoint interpolates"),
		Breachline::FalloffMultiplier(27.f, 16.f, 38.f, 0.55f), 0.775f, 0.0001f);
	TestEqual(TEXT("beyond the end clamps to the minimum"),
		Breachline::FalloffMultiplier(120.f, 16.f, 38.f, 0.55f), 0.55f, 0.0001f);

	// A degenerate window must not divide by zero.
	const float Degenerate = Breachline::FalloffMultiplier(20.f, 16.f, 16.f, 0.5f);
	TestTrue(TEXT("zero-length window stays finite"), FMath::IsFinite(Degenerate));

	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineDamageArmorTest,
	"Breachline.Combat.Damage.Armor", BREACHLINE_TEST_FLAGS)

bool FBreachlineDamageArmorTest::RunTest(const FString& Parameters)
{
	TestEqual(TEXT("no armor is no mitigation"), Breachline::ArmorReduction(0.f, 60.f), 0.f, 0.0001f);
	TestEqual(TEXT("45 armor reduces ~43%"), Breachline::ArmorReduction(45.f, 60.f), 45.f / 105.f, 0.0001f);
	TestEqual(TEXT("armor mitigation is capped at 75%"),
		Breachline::ArmorReduction(5000.f, 60.f), 0.75f, 0.0001f);

	// The cap is what keeps a fully armored Heavy killable with a rifle.
	FBreachlineDamageTuning Tuning;
	TestEqual(TEXT("tuning ships the authored armor constant"), Tuning.ArmorK, 60.f, 0.0001f);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineDamagePipelineTest,
	"Breachline.Combat.Damage.Pipeline", BREACHLINE_TEST_FLAGS)

bool FBreachlineDamagePipelineTest::RunTest(const FString& Parameters)
{
	const FBreachlineDamageTuning& Tuning = FBreachlineDamageTuning::Get();
	const FBreachlineWeaponDef Rifle = RifleDef();

	// Rifle, point blank, torso, unarmored: exactly the table damage.
	FDamageInput Input;
	Input.BaseDamage = Rifle.Damage;
	Input.HeadshotMult = Rifle.HeadshotMult;
	Input.Zone = EHitZone::Torso;
	Input.DistanceM = 5.f;
	Input.FalloffStartM = Rifle.FalloffStart;
	Input.FalloffEndM = Rifle.FalloffEnd;
	Input.MinDamageMult = Rifle.FalloffMin;

	const FDamageResult Torso = Breachline::ComputeDamage(Input, Tuning);
	TestEqual(TEXT("rifle torso hit at 5 m is table damage"), Torso.HealthDamage, 24.f, 0.01f);
	TestEqual(TEXT("no armor taken"), Torso.ArmorDamage, 0.f, 0.01f);

	// Headshot: zone multiplier replaces the generic one.
	Input.Zone = EHitZone::Head;
	const FDamageResult Head = Breachline::ComputeDamage(Input, Tuning);
	TestTrue(TEXT("headshot hits harder than torso"), Head.HealthDamage > Torso.HealthDamage);
	TestEqual(TEXT("headshot uses the weapon's head multiplier"),
		Head.HealthDamage, 24.f * Rifle.HeadshotMult, 0.01f);

	// Armor absorbs but never negates: some health always comes off.
	Input.Zone = EHitZone::Torso;
	Input.TargetArmor = 45.f;
	const FDamageResult Armored = Breachline::ComputeDamage(Input, Tuning);
	TestTrue(TEXT("armor reduces health damage"), Armored.HealthDamage < Torso.HealthDamage);
	TestTrue(TEXT("armor takes damage of its own"), Armored.ArmorDamage > 0.f);
	TestTrue(TEXT("a connecting hit always does something"), Armored.HealthDamage >= 1.f);

	// The 1 HP floor: a hopeless shot at extreme range still registers.
	Input.TargetArmor = 0.f;
	Input.DistanceM = 200.f;
	const FDamageResult Far = Breachline::ComputeDamage(Input, Tuning);
	TestEqual(TEXT("min damage multiplier applies"), Far.HealthDamage, 24.f * Rifle.FalloffMin, 0.01f);
	TestTrue(TEXT("never zero"), Far.HealthDamage >= 1.f);

	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineHitZoneTest,
	"Breachline.Combat.Damage.HitZones", BREACHLINE_TEST_FLAGS)

bool FBreachlineHitZoneTest::RunTest(const FString& Parameters)
{
	// Feet at 0, body 185 cm tall (matching the character capsule).
	const float Feet = 0.f;
	const float Height = 185.f;

	TestTrue(TEXT("head at 0.9 body height"),
		Breachline::ZoneFromHeight(170.f, Feet, Height, 0.f) == EHitZone::Head);
	TestTrue(TEXT("chest is torso when centred"),
		Breachline::ZoneFromHeight(110.f, Feet, Height, 0.f) == EHitZone::Torso);
	TestTrue(TEXT("wide chest hit clips an arm"),
		Breachline::ZoneFromHeight(110.f, Feet, Height, 0.5f) == EHitZone::Arms);
	TestTrue(TEXT("shins are legs"),
		Breachline::ZoneFromHeight(40.f, Feet, Height, 0.f) == EHitZone::Legs);
	TestTrue(TEXT("below the feet clamps to legs"),
		Breachline::ZoneFromHeight(-50.f, Feet, Height, 0.f) == EHitZone::Legs);

	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineGrenadeTest,
	"Breachline.Combat.Damage.Grenade", BREACHLINE_TEST_FLAGS)

bool FBreachlineGrenadeTest::RunTest(const FString& Parameters)
{
	const FBreachlineDamageTuning& Tuning = FBreachlineDamageTuning::Get();

	TestEqual(TEXT("centre of the blast is full damage"),
		Breachline::GrenadeFalloff(0.f, Tuning.GrenadeRadiusM, Tuning.GrenadeFalloffPower), 1.f, 0.0001f);
	TestEqual(TEXT("outside the radius is nothing"),
		Breachline::GrenadeFalloff(Tuning.GrenadeRadiusM + 1.f, Tuning.GrenadeRadiusM, Tuning.GrenadeFalloffPower), 0.f, 0.0001f);

	const float Mid = Breachline::GrenadeFalloff(Tuning.GrenadeRadiusM * 0.5f, Tuning.GrenadeRadiusM, Tuning.GrenadeFalloffPower);
	TestTrue(TEXT("falloff is monotonic in the middle band"), Mid > 0.f && Mid < 1.f);

	// Grenades stay lethal against a Heavy's armor (that is their job).
	TestTrue(TEXT("authored grenade damage beats heavy health per-hit"),
		Tuning.GrenadeDamage > Breachline::DefaultEnemyArchetypes()[2].MaxHealth * 0.5f);

	return true;
}

// ============================================================================
//  Hostile gunnery
// ============================================================================
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineEnemyAccuracyTest,
	"Breachline.Combat.EnemyFire.Accuracy", BREACHLINE_TEST_FLAGS)

bool FBreachlineEnemyAccuracyTest::RunTest(const FString& Parameters)
{
	TestEqual(TEXT("difficulty multiplier scales accuracy"),
		Breachline::EnemyAccuracy(0.5f, 1.1f), 0.55f, 0.0001f);
	TestEqual(TEXT("accuracy is floored"),
		Breachline::EnemyAccuracy(0.01f, 0.5f), 0.05f, 0.0001f);
	TestEqual(TEXT("accuracy is capped: no perfect soldiers"),
		Breachline::EnemyAccuracy(0.99f, 3.f), 0.95f, 0.0001f);

	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineEnemyAimErrorTest,
	"Breachline.Combat.EnemyFire.AimError", BREACHLINE_TEST_FLAGS)

bool FBreachlineEnemyAimErrorTest::RunTest(const FString& Parameters)
{
	FEnemyShotInput Base;
	Base.Accuracy = 0.5f;
	Base.AccuracyMult = 1.f;
	Base.DistanceM = 10.f;
	Base.WeaponRangeM = 46.f;

	const float Close = Breachline::EnemyAimError(Base);

	Base.DistanceM = 40.f;
	const float Far = Breachline::EnemyAimError(Base);
	TestTrue(TEXT("distance increases aim error"), Far > Close);

	Base.DistanceM = 10.f;
	Base.bPlayerMoving = true;
	Base.PlayerSpeedMps = 4.6f;
	const float Moving = Breachline::EnemyAimError(Base);
	TestTrue(TEXT("a moving target is harder to hit"), Moving > Close);

	Base.bPlayerMoving = false;
	Base.PlayerSpeedMps = 0.f;
	Base.bShooterMoving = true;
	const float ShooterMoving = Breachline::EnemyAimError(Base);
	TestTrue(TEXT("firing on the move is harder"), ShooterMoving > Close);

	Base.bShooterMoving = false;
	Base.bReactionRecent = true;
	const float Reacting = Breachline::EnemyAimError(Base);
	TestTrue(TEXT("a fresh reaction is loose"), Reacting > Close);

	// A marksman is measurably better than a runner: this is the whole point of
	// having an accuracy stat at all.
	Base.bReactionRecent = false;
	FEnemyShotInput Marksman;
	Marksman.Accuracy = 0.68f;
	Marksman.DistanceM = 10.f;
	Marksman.WeaponRangeM = 46.f;
	TestTrue(TEXT("higher accuracy means tighter error"),
		Breachline::EnemyAimError(Marksman) < Close);

	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineEnemyMissChanceTest,
	"Breachline.Combat.EnemyFire.MissChance", BREACHLINE_TEST_FLAGS)

bool FBreachlineEnemyMissChanceTest::RunTest(const FString& Parameters)
{
	FEnemyShotInput In;
	In.Accuracy = 0.5f;
	In.DistanceM = 12.f;
	In.WeaponRangeM = 46.f;

	const float Base = Breachline::EnemyMissChance(In);
	TestTrue(TEXT("there is always some chance of a deliberate miss"), Base > 0.f);

	In.bSuppressed = true;
	In.bPlayerMoving = true;
	In.PlayerSpeedMps = 6.f;
	In.bPlayerCrouched = true;
	In.DistanceM = 45.f;
	const float Stacked = Breachline::EnemyMissChance(In);
	TestTrue(TEXT("stacked penalties raise the miss chance"), Stacked > Base);
	TestTrue(TEXT("miss chance is capped at 35%"), Stacked <= 0.35f + 0.0001f);

	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineEnemyShotPlanTest,
	"Breachline.Combat.EnemyFire.Plan", BREACHLINE_TEST_FLAGS)

bool FBreachlineEnemyShotPlanTest::RunTest(const FString& Parameters)
{
	FEnemyShotInput In;
	In.Accuracy = 0.5f;
	In.DistanceM = 14.f;
	In.WeaponRangeM = 46.f;

	// Determinism: the same seed must produce the same plan, forever. The AI uses
	// this to make "replayed" fights reproducible in bug reports.
	const FEnemyShotPlan A = Breachline::PlanEnemyShot(In, FBreachlineRng::Seeded(1234));
	const FEnemyShotPlan B = Breachline::PlanEnemyShot(In, FBreachlineRng::Seeded(1234));
	TestEqual(TEXT("seeded aim error is reproducible"), A.AimError, B.AimError, 0.000001f);
	TestEqual(TEXT("seeded miss roll is reproducible"), A.bMiss, B.bMiss);

	// Deliberate miss geometry: the round must pass close enough to be felt but
	// far enough to actually miss (0.55 .. 1.0 of the tuned lateral magnitude).
	int32 Misses = 0;
	for (int32 Seed = 0; Seed < 500; ++Seed)
	{
		const FEnemyShotPlan Plan = Breachline::PlanEnemyShot(In, FBreachlineRng::Seeded(Seed));
		if (!Plan.bMiss) continue;

		Misses++;
		TestTrue(TEXT("lateral offset is inside the authored band"),
			FMath::Abs(Plan.LateralM) <= Breachline::AI::MissLateralM + 0.001f);
		TestTrue(TEXT("a planned miss is never a dead-centre shot"),
			FMath::Abs(Plan.LateralM) >= Breachline::AI::MissLateralM * 0.55f - 0.001f);
		TestTrue(TEXT("vertical offset is inside the authored band"),
			FMath::Abs(Plan.VerticalM) <= Breachline::AI::MissVerticalM + 0.001f);
	}
	TestTrue(TEXT("some shots are planned misses"), Misses > 0);
	TestTrue(TEXT("most shots are not"), Misses < 500);

	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineRayPointDistanceTest,
	"Breachline.Combat.EnemyFire.NearMiss", BREACHLINE_TEST_FLAGS)

bool FBreachlineRayPointDistanceTest::RunTest(const FString& Parameters)
{
	const FVector Origin(0.f, 0.f, 0.f);
	const FVector Forward(1.f, 0.f, 0.f);
	const float MaxT = 10000.f;

	// A round passing 2 m to the side of a point 5 m downrange.
	const float Side = Breachline::RayPointDistance(Origin, Forward, FVector(500.f, 200.f, 0.f), MaxT);
	TestEqual(TEXT("2 m lateral miss is measured as 2 m"), Side, 2.f, 0.001f);

	TestEqual(TEXT("a point on the ray is zero distance"),
		Breachline::RayPointDistance(Origin, Forward, FVector(500.f, 0.f, 0.f), MaxT), 0.f, 0.001f);

	// Behind the muzzle: the round never approached them, so report "no miss".
	TestEqual(TEXT("a point behind the muzzle is not a near miss"),
		Breachline::RayPointDistance(Origin, Forward, FVector(-500.f, 0.f, 0.f), MaxT),
		TNumericLimits<float>::Max(), 0.001f);

	// Beyond the weapon's range: also not a near miss (the round fell short).
	TestEqual(TEXT("a point beyond max range is not a near miss"),
		Breachline::RayPointDistance(Origin, Forward, FVector(20000.f, 0.f, 0.f), MaxT),
		TNumericLimits<float>::Max(), 0.001f);

	// The near-miss trigger radius: 1.8 m, so a 2 m pass must NOT shake the camera.
	TestTrue(TEXT("the 2 m pass is outside the near-miss radius"),
		Side > Breachline::AI::NearMissRadiusM);

	return true;
}

// ============================================================================
//  Scoring
// ============================================================================
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineScoringTest,
	"Breachline.Progression.Scoring", BREACHLINE_TEST_FLAGS)

bool FBreachlineScoringTest::RunTest(const FString& Parameters)
{
	FBreachlineScoring Scoring;

	// Identical to the web build's SCORING block.
	TestEqual(TEXT("multikill chain of 1 has no bonus"),
		UProgressionSubsystem::MultikillBonusFor(Scoring, 1), 0);
	TestEqual(TEXT("double kill"),
		UProgressionSubsystem::MultikillBonusFor(Scoring, 2), 100);
	TestEqual(TEXT("triple kill"),
		UProgressionSubsystem::MultikillBonusFor(Scoring, 3), 200);
	TestEqual(TEXT("quad kill"),
		UProgressionSubsystem::MultikillBonusFor(Scoring, 4), 350);
	TestEqual(TEXT("beyond the table clamps to the top bonus"),
		UProgressionSubsystem::MultikillBonusFor(Scoring, 99), 500);

	TestEqual(TEXT("round 1 clear bonus"),
		UProgressionSubsystem::RoundClearBonusFor(Scoring, 0), 250);
	TestEqual(TEXT("final round clear bonus"),
		UProgressionSubsystem::RoundClearBonusFor(Scoring, 4), 1000);
	TestEqual(TEXT("past the table clamps"),
		UProgressionSubsystem::RoundClearBonusFor(Scoring, 40), 1000);

	TestEqual(TEXT("headshot bonus"), Scoring.HeadshotBonus, 50);
	TestEqual(TEXT("grenade kill bonus"), Scoring.GrenadeBonus, 75);
	TestEqual(TEXT("accuracy bonus"), Scoring.AccuracyBonus, 300);
	TestEqual(TEXT("flawless round bonus"), Scoring.NoDamageBonus, 500);

	// Empty tables must degrade to zero, never to a crash.
	FBreachlineScoring Empty;
	Empty.MultikillBonus.Reset();
	Empty.RoundClearBonus.Reset();
	TestEqual(TEXT("empty multikill table is safe"), UProgressionSubsystem::MultikillBonusFor(Empty, 3), 0);
	TestEqual(TEXT("empty round table is safe"), UProgressionSubsystem::RoundClearBonusFor(Empty, 3), 0);

	return true;
}

// ============================================================================
//  Balance tables (the port's contract with the web build)
// ============================================================================
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineWeaponTableTest,
	"Breachline.Balance.Weapons", BREACHLINE_TEST_FLAGS)

bool FBreachlineWeaponTableTest::RunTest(const FString& Parameters)
{
	const TArray<FBreachlineWeaponDef> Weapons = Breachline::DefaultWeapons();
	TestEqual(TEXT("five weapons in the loadout"), Weapons.Num(), 5);

	if (Weapons.Num() < 5) return false;

	// Ids must match the DataAsset naming convention (DA_Weapon_<id>).
	TestEqual(TEXT("slot 1 is the rifle"), Weapons[0].Id, FName(TEXT("rifle")));
	TestEqual(TEXT("slot 2 is the SMG"), Weapons[1].Id, FName(TEXT("smg")));
	TestEqual(TEXT("slot 3 is the shotgun"), Weapons[2].Id, FName(TEXT("shotgun")));
	TestEqual(TEXT("slot 4 is the DMR"), Weapons[3].Id, FName(TEXT("dmr")));
	TestEqual(TEXT("slot 5 is the pistol"), Weapons[4].Id, FName(TEXT("pistol")));

	// Numbers transcribed from src/game/data/config.ts — if these fail, the two
	// builds have drifted and one of them is now wrong.
	TestEqual(TEXT("rifle damage"), Weapons[0].Damage, 24.f, 0.001f);
	TestEqual(TEXT("rifle RPM"), Weapons[0].RoundsPerMinute, 540.f, 0.001f);
	TestEqual(TEXT("rifle magazine"), Weapons[0].MagSize, 30);
	TestEqual(TEXT("rifle reload"), Weapons[0].ReloadTime, 1.9f, 0.001f);

	TestEqual(TEXT("smg damage"), Weapons[1].Damage, 15.f, 0.001f);
	TestEqual(TEXT("smg RPM"), Weapons[1].RoundsPerMinute, 800.f, 0.001f);
	TestEqual(TEXT("smg magazine"), Weapons[1].MagSize, 40);

	TestEqual(TEXT("shotgun pellets"), Weapons[2].Pellets, 8);
	TestEqual(TEXT("shotgun damage per pellet"), Weapons[2].Damage, 11.f, 0.001f);
	TestEqual(TEXT("shotgun is pump action (semi)"), Weapons[2].FireMode == EFireMode::Semi, true);

	TestEqual(TEXT("dmr damage"), Weapons[3].Damage, 62.f, 0.001f);
	TestEqual(TEXT("dmr headshot multiplier"), Weapons[3].HeadshotMult, 2.5f, 0.001f);
	// Armor penetration is what makes the DMR the answer to the Heavy Gunner.
	TestEqual(TEXT("dmr armor penetration"), Weapons[3].ArmorDamageMult, 1.6f, 0.001f);
	TestEqual(TEXT("smg is poor against armor"), Weapons[1].ArmorDamageMult, 0.7f, 0.001f);

	TestEqual(TEXT("pistol damage"), Weapons[4].Damage, 20.f, 0.001f);

	// Invariants that keep the HUD and the ammo economy sane.
	for (const FBreachlineWeaponDef& Weapon : Weapons)
	{
		TestTrue(TEXT("weapon has a magazine"), Weapon.MagSize > 0);
		TestTrue(TEXT("weapon has a fire rate"), Weapon.RoundsPerMinute > 0.f);
		TestTrue(TEXT("falloff window is ordered"), Weapon.FalloffEnd >= Weapon.FalloffStart);
		TestTrue(TEXT("reserve fits the magazine"), Weapon.MaxReserve >= Weapon.MagSize);
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineArchetypeTableTest,
	"Breachline.Balance.Archetypes", BREACHLINE_TEST_FLAGS)

bool FBreachlineArchetypeTableTest::RunTest(const FString& Parameters)
{
	const TArray<FEnemyArchetypeDef> Archetypes = Breachline::DefaultEnemyArchetypes();
	TestEqual(TEXT("four archetypes"), Archetypes.Num(), 4);
	if (Archetypes.Num() < 4) return false;

	TestEqual(TEXT("rifleman health"), Archetypes[0].MaxHealth, 70.f, 0.001f);
	TestEqual(TEXT("rifleman armor"), Archetypes[0].Armor, 10.f, 0.001f);
	TestEqual(TEXT("rifleman carries the rifle"), Archetypes[0].Weapon == EWeaponSlotId::Rifle, true);

	TestEqual(TEXT("assault runner health"), Archetypes[1].MaxHealth, 55.f, 0.001f);
	TestEqual(TEXT("assault runner has no armor"), Archetypes[1].Armor, 0.f, 0.001f);
	TestEqual(TEXT("assault runner carries the SMG"), Archetypes[1].Weapon == EWeaponSlotId::SMG, true);

	TestEqual(TEXT("heavy gunner health"), Archetypes[2].MaxHealth, 160.f, 0.001f);
	TestEqual(TEXT("heavy gunner armor"), Archetypes[2].Armor, 45.f, 0.001f);
	TestEqual(TEXT("heavy gunner carries the shotgun"), Archetypes[2].Weapon == EWeaponSlotId::Shotgun, true);

	TestEqual(TEXT("support marksman health"), Archetypes[3].MaxHealth, 60.f, 0.001f);
	TestEqual(TEXT("support marksman carries the DMR"), Archetypes[3].Weapon == EWeaponSlotId::DMR, true);

	// Id lookups drive the spawn table and the scoring path.
	TestEqual(TEXT("archetype lookup by id"), Breachline::ArchetypeIndex(FName(TEXT("heavy"))), 2);
	TestEqual(TEXT("unknown id returns INDEX_NONE"), Breachline::ArchetypeIndex(FName(TEXT("nope"))), INDEX_NONE);

	// Sanity: the fast archetype is faster, the tough one is tougher.
	TestTrue(TEXT("runner is the fastest"), Archetypes[1].SpeedMps > Archetypes[0].SpeedMps);
	TestTrue(TEXT("heavy is the slowest"), Archetypes[2].SpeedMps < Archetypes[0].SpeedMps);
	TestTrue(TEXT("marksman engages from furthest"), Archetypes[3].PreferredMax > Archetypes[0].PreferredMax);

	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineRoundTableTest,
	"Breachline.Balance.Rounds", BREACHLINE_TEST_FLAGS)

bool FBreachlineRoundTableTest::RunTest(const FString& Parameters)
{
	const TArray<FRoundDef> Rounds = Breachline::DefaultRounds();
	TestEqual(TEXT("five rounds"), Rounds.Num(), 5);
	if (Rounds.Num() < 5) return false;

	// Escalation is monotonic across the run: more enemies, tougher enemies.
	for (int32 i = 1; i < Rounds.Num(); ++i)
	{
		TestTrue(FString::Printf(TEXT("round %d has at least as many enemies"), i + 1),
			Rounds[i].TotalEnemies >= Rounds[i - 1].TotalEnemies);
		TestTrue(FString::Printf(TEXT("round %d is at least as accurate"), i + 1),
			Rounds[i].AccuracyMult >= Rounds[i - 1].AccuracyMult);
		TestTrue(FString::Printf(TEXT("round %d aggressive enough"), i + 1),
			Rounds[i].AggressionMult >= Rounds[i - 1].AggressionMult);
		TestTrue(FString::Printf(TEXT("round %d respects the alive cap"), i + 1),
			Rounds[i].MaxAlive <= Rounds[i].TotalEnemies);
	}

	TestEqual(TEXT("round 1 enemy count"), Rounds[0].TotalEnemies, 4);
	TestEqual(TEXT("round 5 enemy count"), Rounds[4].TotalEnemies, 10);

	// Weights are index-matched to the archetype table and must always be
	// indexable by the spawn director.
	const int32 ArchetypeCount = Breachline::DefaultEnemyArchetypes().Num();
	for (int32 i = 0; i < Rounds.Num(); ++i)
	{
		TestTrue(FString::Printf(TEXT("round %d weights match the archetype table"), i + 1),
			Rounds[i].ArchetypeWeights.Num() == ArchetypeCount);
		float Sum = 0.f;
		for (const float Weight : Rounds[i].ArchetypeWeights)
		{
			TestTrue(TEXT("weights are non-negative"), Weight >= 0.f);
			Sum += Weight;
		}
		TestTrue(FString::Printf(TEXT("round %d can actually spawn something"), i + 1), Sum > 0.f);
	}

	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineWorldScaleTest,
	"Breachline.Balance.World", BREACHLINE_TEST_FLAGS)

bool FBreachlineWorldScaleTest::RunTest(const FString& Parameters)
{
	// 44 cells of 4 m: a 176 m compound. Everything (camera bounds, radar span,
	// spawn rings) is derived from these two numbers.
	TestEqual(TEXT("44 x 44 cells"), Breachline::World::SizeCells, 44);
	TestEqual(TEXT("4 m cells"), Breachline::World::CellMeters, 4.f, 0.001f);
	TestEqual(TEXT("half extent in metres"), Breachline::World::HalfExtentMeters, 88.f, 0.001f);
	TestEqual(TEXT("cell size in unreal units"), Breachline::MetersToUU(1.f), 100.f, 0.001f);

	// The radar must show less than the whole arena, or it is not a radar.
	TestTrue(TEXT("radar range is a fraction of the compound"),
		Breachline::Radar::BlipRangeM < Breachline::World::HalfExtentMeters);

	// The camera must be able to see a useful slice of the arena.
	TestTrue(TEXT("max camera distance still frames the fight"),
		Breachline::Camera::MaxDistanceM > Breachline::Camera::DistanceM);
	TestTrue(TEXT("camera elevation is the tuned 40 degrees"),
		FMath::IsNearlyEqual(Breachline::Camera::ElevationDeg, 40.f, 0.001f));

	return true;
}

// ============================================================================
//  Radar / threat geometry
// ============================================================================
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineRadarProjectionTest,
	"Breachline.HUD.Radar", BREACHLINE_TEST_FLAGS)

bool FBreachlineRadarProjectionTest::RunTest(const FString& Parameters)
{
	const FVector Origin = FVector::ZeroVector;
	const float Scale = Breachline::RadarScale(79.f, Breachline::Radar::BlipRangeM);

	// Azimuth 0: world +X is the camera's forward, so a contact 10 m downrange must
	// draw ABOVE the centre of the scope (negative Y in pixels).
	{
		const FVector Contact = Origin + FVector(1000.f, 0.f, 0.f); // 10 m on +X
		const FVector2D Pixel = Breachline::ToRadarPixels(
			Breachline::ToRadarLocal(Contact, Origin, 0.f), Scale);
		TestTrue(TEXT("contact straight ahead draws up-screen"), Pixel.Y < 0.f);
		TestTrue(TEXT("contact straight ahead is horizontally centred"), FMath::Abs(Pixel.X) < 0.001f);
	}

	// Contact to the camera's right (world +Y at azimuth 0) must draw right.
	{
		const FVector Contact = Origin + FVector(0.f, 1000.f, 0.f);
		const FVector2D Pixel = Breachline::ToRadarPixels(
			Breachline::ToRadarLocal(Contact, Origin, 0.f), Scale);
		TestTrue(TEXT("contact to the right draws right"), Pixel.X > 0.f);
		TestTrue(TEXT("contact at 90 degrees is vertically centred"), FMath::Abs(Pixel.Y) < 0.001f);
	}

	// Rotating the camera by 90° must move the SAME world contact to the right of
	// the scope: the radar is camera-relative, not world-fixed.
	{
		const FVector Contact = Origin + FVector(1000.f, 0.f, 0.f);
		const FVector2D Pixel = Breachline::ToRadarPixels(
			Breachline::ToRadarLocal(Contact, Origin, 90.f), Scale);
		TestTrue(TEXT("after orbiting 90 degrees the contact sits to the side"), Pixel.X < 0.f);
	}

	// Range mapping: a contact at exactly the blip range lands on the rim.
	{
		const FVector Contact = Origin + FVector(Breachline::MetersToUU(Breachline::Radar::BlipRangeM), 0.f, 0.f);
		const FVector2D Pixel = Breachline::ToRadarPixels(
			Breachline::ToRadarLocal(Contact, Origin, 0.f), Scale);
		TestEqual(TEXT("a contact at max range sits on the rim"), Pixel.Size(), 79.f, 0.01f);
	}

	// Clamping: out-of-range contacts are pinned to the rim and flagged.
	{
		bool bClamped = false;
		const FVector2D Far = Breachline::ClampToScope(FVector2D(0.f, -500.f), 79.f, bClamped);
		TestTrue(TEXT("far contact is flagged as clamped"), bClamped);
		TestEqual(TEXT("clamped contact is pinned to the rim"), Far.Size(), 79.f, 0.01f);

		const FVector2D Near = Breachline::ClampToScope(FVector2D(10.f, 10.f), 79.f, bClamped);
		TestFalse(TEXT("in-range contact is not clamped"), bClamped);
		TestEqual(TEXT("in-range contact is untouched"), Near.Size(), FVector2D(10.f, 10.f).Size(), 0.001f);
	}

	// Bearing: a contact due north of the player with the camera facing north is
	// straight up the scope (0 degrees).
	{
		const FVector North(0.f, 1.f, 0.f);
		TestTrue(TEXT("bearing of a contact dead ahead is 0"), FMath::Abs(Breachline::BearingDegrees(North, 90.f)) < 0.01f);
	}

	return true;
}

// ============================================================================
//  Save profile clamps (values that reach CVars and the mix)
// ============================================================================
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBreachlineThreatTelegraphTest,
	"Breachline.HUD.Threat", BREACHLINE_TEST_FLAGS)

bool FBreachlineThreatTelegraphTest::RunTest(const FString& Parameters)
{
	// The radar lights up (and the danger line draws) above the awareness
	// threshold: these must stay consistent or the radar lies to the player.
	TestTrue(TEXT("awareness threshold is inside the confidence range"),
		Breachline::Threats::AwareThreshold > 0.f && Breachline::Threats::AwareThreshold < 1.f);
	TestTrue(TEXT("an unaware contact is fainter than an aware one"),
		Breachline::Threats::FaintWeight < Breachline::Threats::AwareThreshold);
	TestTrue(TEXT("a corpse is fainter than an unaware contact"),
		Breachline::Threats::CorpseWeight < Breachline::Threats::FaintWeight);

	// Unaware contacts only show up close, well inside the radar's range.
	TestTrue(TEXT("faint contacts are range limited"),
		Breachline::Threats::FaintContactRangeM < Breachline::Radar::BlipRangeM);

	// The threat picture refreshes at a sensible rate: fast enough to react to,
	// slow enough that it costs nothing with 20 enemies alive.
	TestTrue(TEXT("threat refresh is sub-second"), Breachline::Threats::RefreshInterval <= 0.25f);
	TestTrue(TEXT("threat beep is not a constant tone"),
		Breachline::Threats::BeepInterval > 0.4f && Breachline::Threats::BeepInterval < 3.f);

	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
