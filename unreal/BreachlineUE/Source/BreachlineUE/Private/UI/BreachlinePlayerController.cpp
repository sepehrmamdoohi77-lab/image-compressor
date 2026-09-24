// Copyright (c) Breachline UE. All rights reserved.

#include "UI/BreachlinePlayerController.h"
#include "Character/BreachlinePlayerCharacter.h"
#include "Character/BreachlineEnemyCharacter.h"
#include "Character/HealthComponent.h"
#include "Camera/TacticalCameraRig.h"
#include "AI/TacticalAIController.h"
#include "Weapons/WeaponManagerComponent.h"
#include "Weapons/WeaponComponent.h"
#include "Core/BreachlineBalance.h"
#include "Core/BreachlineGameInstance.h"
#include "Core/BreachlineSaveGame.h"
#include "Core/ProgressionSubsystem.h"
#include "World/HealthKitPickup.h"
#include "AI/SpawnDirector.h"
#include "Audio/BreachlineAudioSubsystem.h"
#include "Game/BreachlineGameMode.h"
#include "EnhancedInputSubsystems.h"
#include "InputMappingContext.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerInput.h"
#include "BreachlineUE.h"

using namespace Breachline;

ABreachlinePlayerController::ABreachlinePlayerController()
{
	PrimaryActorTick.bCanEverTick = true;

	// Cursor aiming: the mouse drives the aim point, so the cursor is visible.
	bShowMouseCursor = true;
	bEnableClickEvents = false;
	bEnableMouseOverEvents = false;
	DefaultMouseCursor = EMouseCursor::Crosshairs;
}

void ABreachlinePlayerController::BeginPlay()
{
	Super::BeginPlay();

	// One runtime mapping context for the whole match: the pawn maps keys into it
	// and the local player adds/removes it, so nothing depends on .ini input.
	InputContext = NewObject<UInputMappingContext>(this, TEXT("IMC_Breachline_Runtime"));
	if (UEnhancedInputLocalPlayerSubsystem* Subsystem =
		ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(GetLocalPlayer()))
	{
		Subsystem->AddMappingContext(InputContext, 0);
	}

	SpawnRig();
	ApplyProfile();
	SetInputMode(FInputModeGameAndUI().SetHideCursorDuringCapture(false));
}

void ABreachlinePlayerController::ApplyProfile()
{
	// Volume/quality/sensitivity live in the GameInstance profile; a controller
	// is the natural place to push them at the systems that consume them.
	if (const UBreachlineGameInstance* GI = Cast<UBreachlineGameInstance>(GetGameInstance()))
	{
		if (const UBreachlineSaveGame* Save = GI->GetProfile())
		{
			if (UBreachlineAudioSubsystem* Audio = GetWorld()->GetSubsystem<UBreachlineAudioSubsystem>())
			{
				Audio->RefreshVolumes();
			}
			if (Rig) Rig->ApplyProfileDistance(Save->CameraDistance);
		}
	}
}

void ABreachlinePlayerController::SpawnRig()
{
	if (Rig) return;

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Params.ObjectFlags |= RF_Transient;

	// The camera rig is spawned by the controller, not placed in the level: it is
	// simulation state, and this guarantees exactly one per player.
	Rig = GetWorld()->SpawnActor<ATacticalCameraRig>(
		ATacticalCameraRig::StaticClass(), FTransform::Identity, Params);

	if (Rig)
	{
		SetViewTarget(Rig);
		// Bounds are the compound's half extent minus a margin, so the camera can
		// never leave the playable area even if the pawn is thrown.
		Rig->SetBounds(World::HalfExtentMeters - Camera::BoundaryMarginM);
	}
}

void ABreachlinePlayerController::OnPossess(APawn* InPawn)
{
	Super::OnPossess(InPawn);

	OperatorPawn = Cast<ABreachlinePlayerCharacter>(InPawn);
	if (OperatorPawn && Rig)
	{
		Rig->SetTargetLocation(OperatorPawn->GetActorLocation(), /*bSnap*/ true);
	}

	// Damage feedback lives on the controller: the pawn does not know about the
	// HUD, the camera or the score.
	if (OperatorPawn && OperatorPawn->GetHealthComponent())
	{
		OperatorPawn->GetHealthComponent()->OnHealthChanged.AddDynamic(
			this, &ABreachlinePlayerController::HandlePlayerHealthChanged);
	}
}

void ABreachlinePlayerController::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// Camera follows the operator, then the HUD snapshot is rebuilt from live
	// state: there is exactly one place that assembles HUD data.
	if (OperatorPawn && Rig)
	{
		Rig->SetTargetLocation(OperatorPawn->GetActorLocation());

		// Cursor aim: the pawn aims at the ground point under the mouse.
		FVector Ground;
		if (GetCursorGroundPoint(Ground))
		{
			CursorGroundPoint = Ground;
			const FVector AimDir = (CursorGroundPoint - OperatorPawn->GetMuzzleLocation()).GetSafeNormal2D();
			if (!AimDir.IsNearlyZero())
			{
				OperatorPawn->SetAimDirection(AimDir);
			}
		}
	}

	ThreatRefreshAccumulator += DeltaSeconds;
	if (ThreatRefreshAccumulator >= Threats::RefreshInterval)
	{
		RefreshThreatPicture(ThreatRefreshAccumulator);
		ThreatRefreshAccumulator = 0.f;
	}

	ResupplyFade = FMath::Max(0.f, ResupplyFade - DeltaSeconds);
	HealFade = FMath::Max(0.f, HealFade - DeltaSeconds);
	ScoreFade = FMath::Max(0.f, ScoreFade - DeltaSeconds);

	// Firing is held down: continuous fire blooms the reticle, mirrored on screen.
	if (UWeaponComponent* Weapon = OperatorPawn && OperatorPawn->GetLoadout() ? OperatorPawn->GetLoadout()->GetActiveWeapon() : nullptr)
	{
		NotifySpread(Weapon->GetSpreadRadians());
	}

	BuildSnapshot();
}

// ------------------------------------------------------------------ camera ----
void ABreachlinePlayerController::RotateCamera(float DeltaDegrees)
{
	if (Rig) Rig->RotateBy(DeltaDegrees);
}

void ABreachlinePlayerController::ZoomCamera(float DeltaMeters)
{
	if (Rig) Rig->ZoomBy(DeltaMeters);
}

bool ABreachlinePlayerController::GetCursorGroundPoint(FVector& OutPoint) const
{
	if (!Rig) return false;

	float MouseX = 0.f, MouseY = 0.f;
	if (!GetMousePosition(MouseX, MouseY))
	{
		// No cursor (gamepad): aim straight ahead of the pawn instead.
		if (!OperatorPawn) return false;
		OutPoint = OperatorPawn->GetActorLocation() + OperatorPawn->GetActorForwardVector() * MetersToUU(12.f);
		return true;
	}
	return Rig->ScreenToGround(FVector2D(MouseX, MouseY), OutPoint);
}

void ABreachlinePlayerController::ToggleCursorMode()
{
	bCursorFree = !bCursorFree;
	if (bCursorFree)
	{
		SetInputMode(FInputModeGameAndUI().SetHideCursorDuringCapture(false));
		bShowMouseCursor = true;
	}
	else
	{
		SetInputMode(FInputModeGameOnly());
		bShowMouseCursor = true; // cursor aiming stays on; this only unlocks it
	}
}

// --------------------------------------------------------------- feedback -----
void ABreachlinePlayerController::NotifyWeaponFired(const FBreachlineWeaponDef& Weapon)
{
	if (!Rig) return;

	// Kick along the shot direction, scaled by calibre: the DMR shoves, the SMG
	// barely moves. Trauma is tiny — this is feel, not a mechanic.
	// Remapped by hand: FMath's helper switched to FVector2f in UE5, and this is one
	// line of arithmetic either way.
	const float CalibreAlpha = FMath::Clamp((Weapon.Damage - 10.f) / (70.f - 10.f), 0.f, 1.f);
	const float Calibre = FMath::Lerp(0.5f, 1.6f, CalibreAlpha);
	const FVector Direction = OperatorPawn ? OperatorPawn->GetAimDirection() : FVector::ForwardVector;
	Rig->Kick(-Direction, Camera::FireKickM * Calibre);
	Rig->AddTrauma(Hud::FireTrauma * Calibre);
}

void ABreachlinePlayerController::NotifySpread(float SpreadRadians)
{
	ReticleSpreadRadians = FMath::Clamp(SpreadRadians, 0.f, 0.35f);
}

void ABreachlinePlayerController::NotifyHitConfirmed(AActor* Victim, bool bHeadshot, bool bKill, int32 Damage)
{
	HitMarker.bHeadshot = bHeadshot;
	HitMarker.bKill = bKill;
	HitMarker.Damage = Damage;
	HitMarker.Time = GetWorld()->GetTimeSeconds();
}

void ABreachlinePlayerController::HandlePlayerHealthChanged(float NewHealth, float Delta, AActor* Causer)
{
	// Resupply broadcasts a positive delta; only damage is interesting here.
	if (Delta >= 0.f) return;

	const float Amount = -Delta;
	NotifyPlayerDamaged(Amount, Causer);

	// Feeding the progression system here (rather than in the damage pipeline) keeps
	// the "flawless round" bonus honest: any damage at all voids it, whoever dealt it.
	if (UProgressionSubsystem* Progression = GetWorld() ? GetWorld()->GetSubsystem<UProgressionSubsystem>() : nullptr)
	{
		Progression->OnPlayerDamaged(Amount);
	}
}

void ABreachlinePlayerController::NotifyShotResolved(const FBulletResult& Report)
{
	if (!Report.bHit) return;

	// A shot can only be "resolved" per pellet; the marker shows the last one, which
	// is what a player expects when a shotgun blast lands several pellets at once.
	NotifyHitConfirmed(Report.HitActor.Get(), Report.Zone == EHitZone::Head, Report.bKilled,
		FMath::RoundToInt(Report.Damage));
}

void ABreachlinePlayerController::NotifyNearMiss(float Meters)
{
	if (!Rig) return;

	// Closer = harder shake, but capped: a near miss must never ruin aim.
	const float Closeness = 1.f - FMath::Clamp(Meters / AI::NearMissRadiusM, 0.f, 1.f);
	Rig->AddTrauma(Hud::NearMissTrauma * (0.4f + 0.6f * Closeness));
}

void ABreachlinePlayerController::NotifyPlayerDamaged(float Amount, AActor* Causer)
{
	LastDamageTime = GetWorld()->GetTimeSeconds();
	LastDamageDirection = Causer
		? (Causer->GetActorLocation() - (OperatorPawn ? OperatorPawn->GetActorLocation() : FVector::ZeroVector)).GetSafeNormal2D()
		: FVector::ForwardVector;

	if (Rig) Rig->AddTrauma(FMath::Clamp(Amount / 40.f, 0.08f, 0.4f));
}

void ABreachlinePlayerController::NotifyExplosion(const FVector& Location, float RadiusMeters)
{
	if (!Rig) return;

	const FVector Origin = OperatorPawn ? OperatorPawn->GetActorLocation() : Rig->GetActorLocation();
	const float DistanceM = FVector::Dist(Origin, Location) / MetersToUU(1.f);
	const float Falloff = FMath::Clamp(1.f - DistanceM / FMath::Max(1.f, RadiusMeters * 2.f), 0.f, 1.f);
	Rig->AddTrauma(Hud::ExplosionTrauma * Falloff);
	Rig->Kick((Origin - Location).GetSafeNormal2D(), Camera::ExplosionKickM * Falloff);
}

void ABreachlinePlayerController::NotifyResupply()
{
	ResupplyFade = Hud::BannerSeconds;
	if (UBreachlineAudioSubsystem* Audio = GetWorld()->GetSubsystem<UBreachlineAudioSubsystem>())
	{
		Audio->PlayUi(true);
	}
}

void ABreachlinePlayerController::NotifyHeal(float Amount)
{
	HealFade = Hud::BannerSeconds;
	HealAmount = Amount;
	if (UBreachlineAudioSubsystem* Audio = GetWorld()->GetSubsystem<UBreachlineAudioSubsystem>())
	{
		Audio->PlayPickup(OperatorPawn ? OperatorPawn->GetActorLocation() : FVector::ZeroVector);
	}
}

void ABreachlinePlayerController::NotifyScore(int32 Amount, const FText& Label)
{
	ScoreFade = Hud::BannerSeconds * 1.6f;
	ScoreLabel = Label;
	(void)Amount;
}

void ABreachlinePlayerController::NotifyWaveIncoming(int32 Enemies)
{
	ResupplyFade = FMath::Max(ResupplyFade, Hud::BannerSeconds * 0.75f);
	(void)Enemies;
}

bool ABreachlinePlayerController::GetDamageDirection(FVector& OutDirection, float& OutAge) const
{
	const float Now = GetWorld()->GetTimeSeconds();
	OutAge = Now - LastDamageTime;
	OutDirection = LastDamageDirection;
	return OutAge < Hud::DamageIndicatorSeconds;
}

// ------------------------------------------------------- threat / HUD data ----
void ABreachlinePlayerController::RefreshThreatPicture(float DeltaSeconds)
{
	Threats.Reset();

	if (!OperatorPawn) return;

	UWorld* World = GetWorld();
	const FVector PlayerLocation = OperatorPawn->GetActorLocation();
	const float Now = World->GetTimeSeconds();

	float MaxWeight = 0.f;
	float NearestAwareDistance = -1.f;
	float ThreatBearingDeg = 0.f;
	int32 AwareCount = 0;
	int32 ContactId = 0;

	ABreachlineGameMode* GameMode = GetBreachlineGameMode();
	const float BlipRangeM = Radar::BlipRangeM;

	for (TActorIterator<ABreachlineEnemyCharacter> It(World); It; ++It)
	{
		ABreachlineEnemyCharacter* Enemy = *It;
		if (!Enemy) continue;

		const FVector EnemyLocation = Enemy->GetActorLocation();
		const float DistanceM = FVector::Dist(EnemyLocation, PlayerLocation) / MetersToUU(1.f);

		float Weight = 0.f;
		if (Enemy->IsAlive())
		{
			// Awareness comes from the squad brain: an enemy that has seen the
			// player (self or via squad intel) is a real threat; a patrolling one
			// is a faint echo at close range.
			if (const ATacticalAIController* AI = Cast<ATacticalAIController>(Enemy->GetController()))
			{
				Weight = AI->GetConfidence();
				if (AI->IsEngaged()) Weight = FMath::Max(Weight, AI->GetConfidence());
			}

			if (Weight > Threats::AwareThreshold)
			{
				AwareCount++;
				if (NearestAwareDistance < 0.f || DistanceM < NearestAwareDistance)
				{
					NearestAwareDistance = DistanceM;
					ThreatBearingDeg = (EnemyLocation - PlayerLocation).Rotation().Yaw;
				}
				if (Weight > MaxWeight)
				{
					MaxWeight = Weight;
					ThreatBearingDeg = (EnemyLocation - PlayerLocation).Rotation().Yaw;
				}
			}
			else if (DistanceM > Threats::FaintContactRangeM)
			{
				continue; // unaware and far: not on the radar at all
			}
		}
		else if (DistanceM > Threats::CorpseBlipRangeM)
		{
			continue; // corpses fade off the scope quickly
		}

		if (DistanceM > Radar::BlipRangeM) continue;

		FThreatContact Contact;
		Contact.Id = ContactId++;
		Contact.Location = EnemyLocation;
		Contact.bAlive = Enemy->IsAlive();
		Contact.Confidence = Enemy->IsAlive() ? Weight : 0.f;
		Threats.Add(Contact);
	}

	// Radar frame is camera-relative: "up" on the scope is always the way the
	// isometric rig faces, which is what makes the radar readable while orbiting.
	const float Azimuth = Rig ? Rig->GetAzimuthDegrees() : 45.f;

	Snapshot.RadarContacts.Reset();
	for (const FThreatContact& Contact : Threats)
	{
		FRadarBlip Blip;
		Blip.Location = FVector2D(Contact.Location.X, Contact.Location.Y);
		Blip.Weight = Contact.bAlive
			? FMath::Max(Contact.Confidence, Contact.Confidence <= 0.f ? Threats::FaintWeight : 0.f)
			: Threats::CorpseWeight;
		Snapshot.RadarContacts.Add(Blip);
	}

	Snapshot.RadarPickups.Reset();
	if (GameMode)
	{
		for (const FVector2D& Pickup : GameMode->GetPickupLocations())
		{
			Snapshot.RadarPickups.Add(Pickup);
		}
	}

	Snapshot.ThreatCount = AwareCount;
	Snapshot.ThreatLevel = MaxWeight;
	Snapshot.ThreatDistance = NearestAwareDistance;

	// Screen-space bearing: 0° = up on the scope, positive = clockwise.
	Snapshot.ThreatAngleDeg = FRotator::NormalizeAxis(ThreatBearingDeg - Azimuth + 90.f);

	// Audio cue: the same information as the danger line, for players watching
	// the centre of the screen instead of the corner.
	if (AwareCount > 0 && Now - LastThreatBeepTime > Threats::BeepInterval / FMath::Max(0.4f, MaxWeight) )
	{
		LastThreatBeepTime = Now;
		if (UBreachlineAudioSubsystem* Audio = World->GetSubsystem<UBreachlineAudioSubsystem>())
		{
			Audio->PlayUi(false);
		}
	}
	(void)DeltaSeconds;
	(void)BlipRangeM;
}

void ABreachlinePlayerController::BuildSnapshot()
{
	UWorld* World = GetWorld();
	FHudSnapshot SnapshotOut;

	if (OperatorPawn && OperatorPawn->GetHealthComponent())
	{
		UHealthComponent* Health = OperatorPawn->GetHealthComponent();
		SnapshotOut.Health = Health->GetHealth();
		SnapshotOut.MaxHealth = Health->GetMaxHealth();
		SnapshotOut.Armor = Health->GetArmor();
		SnapshotOut.MaxArmor = Health->GetMaxArmor();
	}

	if (OperatorPawn && OperatorPawn->GetLoadout())
	{
		UWeaponManagerComponent* Loadout = OperatorPawn->GetLoadout();
		if (UWeaponComponent* Weapon = Loadout->GetActiveWeapon())
		{
			SnapshotOut.MagAmmo = Weapon->MagAmmo;
			SnapshotOut.ReserveAmmo = Weapon->ReserveAmmo;
			SnapshotOut.bReloading = Weapon->IsReloading();
			SnapshotOut.WeaponId = Weapon->GetDefinition().Id;
			SnapshotOut.WeaponName = Weapon->GetDefinition().DisplayName;
		}
	}

	SnapshotOut.Grenades = OperatorPawn ? OperatorPawn->GetGrenades() : 0;
	SnapshotOut.MedkitsUsed = OperatorPawn ? OperatorPawn->GetMedkitsUsed() : 0;
	SnapshotOut.bSprinting = OperatorPawn && OperatorPawn->IsSprinting();
	SnapshotOut.bAiming = OperatorPawn && OperatorPawn->IsAiming();
	SnapshotOut.bCrouched = OperatorPawn && OperatorPawn->bIsCrouched;

	if (UProgressionSubsystem* Progression = World->GetSubsystem<UProgressionSubsystem>())
	{
		SnapshotOut.Score = Progression->Score;
		SnapshotOut.Kills = Progression->Kills;
		SnapshotOut.Headshots = Progression->Headshots;
		SnapshotOut.ShotsFired = Progression->ShotsFired;
		SnapshotOut.ShotsHit = Progression->ShotsHit;
		SnapshotOut.RoundIndex = Progression->RoundIndex;
	}

	if (const ABreachlineGameMode* GameMode = GetBreachlineGameMode())
	{
		SnapshotOut.EnemiesRemaining = GameMode->GetEnemiesRemaining();
		SnapshotOut.RoundLabel = GameMode->GetRoundLabel();
	}

	// Threat fields + radar arrays are produced in RefreshThreatPicture; keep them.
	SnapshotOut.ThreatLevel = Snapshot.ThreatLevel;
	SnapshotOut.ThreatAngleDeg = Snapshot.ThreatAngleDeg;
	SnapshotOut.ThreatCount = Snapshot.ThreatCount;
	SnapshotOut.ThreatDistance = Snapshot.ThreatDistance;
	SnapshotOut.RadarContacts = Snapshot.RadarContacts;
	SnapshotOut.RadarPickups = Snapshot.RadarPickups;

	SnapshotOut.ResupplyFade = ResupplyFade;
	SnapshotOut.LastHeal = HealFade > 0.f ? HealAmount : 0.f;

	Snapshot = SnapshotOut;
}

float ABreachlinePlayerController::GetThreatPulse() const
{
	const float Now = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f;
	const float Rate = Threats::PulseHz * (0.7f + 0.8f * FMath::Clamp(Snapshot.ThreatLevel, 0.f, 1.f));
	return 0.5f + 0.5f * FMath::Sin(Now * Rate * 2.f * PI);
}

void ABreachlinePlayerController::GetReticlePoints(TArray<FVector2D>& OutPoints) const
{
	// Four ticks whose gap grows with the live spread, plus a centre dot: the
	// classic "how accurate am I right now" read, computed from real weapon state.
	int32 ViewX = 0, ViewY = 0;
	float SizeX = 0.f, SizeY = 0.f;
	GetViewportSize(ViewX, ViewY);
	if (ViewX <= 0 || ViewY <= 0) return;
	SizeX = ViewX * 0.5f;
	SizeY = ViewY * 0.5f;

	const float Gap = FMath::Lerp(6.f, 46.f, FMath::Clamp(ReticleSpreadRadians / 0.12f, 0.f, 1.f));
	OutPoints.Reset();
	OutPoints.Add(FVector2D(SizeX, SizeY - Gap));   // up
	OutPoints.Add(FVector2D(SizeX, SizeY + Gap));   // down
	OutPoints.Add(FVector2D(SizeX - Gap, SizeY));   // left
	OutPoints.Add(FVector2D(SizeX + Gap, SizeY));   // right
	OutPoints.Add(FVector2D(SizeX, SizeY));         // centre
}

bool ABreachlinePlayerController::ProjectWorldToScreenPixels(const FVector& World, FVector2D& OutPixels) const
{
	FVector2D Screen;
	if (!ProjectWorldLocationToScreen(World, Screen)) return false;
	OutPixels = Screen;
	return true;
}

ABreachlineGameMode* ABreachlinePlayerController::GetBreachlineGameMode() const
{
	return GetWorld() ? GetWorld()->GetAuthGameMode<ABreachlineGameMode>() : nullptr;
}
