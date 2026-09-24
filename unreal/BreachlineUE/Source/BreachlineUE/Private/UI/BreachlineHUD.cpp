// Copyright (c) Breachline UE. All rights reserved.

#include "UI/BreachlineHUD.h"
#include "UI/BreachlinePlayerController.h"
#include "Character/BreachlinePlayerCharacter.h"
#include "Camera/TacticalCameraRig.h"
#include "Core/BreachlineBalance.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"
#include "Engine/World.h"
#include "GameFramework/PlayerInput.h"
#include "BreachlineUE.h"

using namespace Breachline;

namespace
{
	// Palette: one place to retheme the entire interface.
	const FLinearColor PanelFill(0.02f, 0.03f, 0.035f, 0.62f);
	const FLinearColor PanelBorder(1.f, 1.f, 1.f, 0.10f);
	const FLinearColor Ink(0.f, 0.f, 0.f, 0.f);
	const FLinearColor TextPrimary(0.92f, 0.95f, 0.96f, 1.f);
	const FLinearColor TextDim(0.62f, 0.68f, 0.70f, 1.f);
	const FLinearColor HealthColour(0.42f, 0.92f, 0.52f, 1.f);
	const FLinearColor HealthLow(0.95f, 0.36f, 0.30f, 1.f);
	const FLinearColor ArmourColour(0.45f, 0.72f, 0.98f, 1.f);
	const FLinearColor AmmoColour(0.95f, 0.86f, 0.55f, 1.f);
	const FLinearColor DangerColour(1.f, 0.20f, 0.16f, 1.f);
	const FLinearColor FaintContact(1.f, 0.55f, 0.35f, 0.55f);
	const FLinearColor PickupColour(0.35f, 1.f, 0.55f, 0.95f);
	const FLinearColor ScopeFill(0.01f, 0.02f, 0.02f, 0.55f);

	FORCEINLINE FLinearColor WithAlpha(const FLinearColor& C, float A)
	{
		return FLinearColor(C.R, C.G, C.B, A);
	}

	FString FormatInt(int32 Value) { return FString::Printf(TEXT("%d"), Value); }

	FString FormatRound(float Value) { return FString::Printf(TEXT("%.0f"), Value); }
}

ABreachlineHUD::ABreachlineHUD()
{
	PrimaryActorTick.bCanEverTick = false;
}

void ABreachlineHUD::DrawHUD()
{
	Super::DrawHUD();

	if (!bShowHud || !Canvas) return;

	ABreachlinePlayerController* PC = GetPlayerControllerSafe();
	if (!PC || PC->GetSnapshot().MaxHealth <= 0.f) return;

	// Fonts come from the engine so the HUD needs no imported typeface.
	if (!MediumFont) MediumFont = GEngine ? GEngine->GetMediumFont() : nullptr;
	if (!LargeFont) LargeFont = GEngine ? GEngine->GetLargeFont() : nullptr;
	if (!SmallFont) SmallFont = GEngine ? GEngine->GetSmallFont() : nullptr;

	const FHudSnapshot& Snapshot = PC->GetSnapshot();
	const float Now = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f;

	DrawDamageVignette(Snapshot, Now);
	DrawObjective(Snapshot, Now);
	DrawVitals(Snapshot, Now);
	DrawWeaponBlock(Snapshot, Now);
	DrawRadar(Snapshot, Now);
	DrawReticle(Snapshot, Now);
	DrawDamageIndicator(Now);
	DrawBanners(Snapshot, Now);
}

// ---------------------------------------------------------------- primitives --
void ABreachlineHUD::DrawPanel(FVector2D Position, FVector2D Size, const FLinearColor& Fill, const FLinearColor& Border)
{
	Canvas->K2_DrawBox(Position, Size, 1.f, Fill);
	// Four 1 px edges: a cheaper, sharper border than a second inset box.
	DrawLine(Position, Position + FVector2D(Size.X, 0.f), Border, 1.f);
	DrawLine(Position + FVector2D(0.f, Size.Y), Position + Size, Border, 1.f);
	DrawLine(Position, Position + FVector2D(0.f, Size.Y), Border, 1.f);
	DrawLine(Position + FVector2D(Size.X, 0.f), Position + Size, Border, 1.f);
}

void ABreachlineHUD::DrawBar(FVector2D Position, FVector2D Size, float Fraction,
	const FLinearColor& Fill, const FLinearColor& Background, bool bSegmented, int32 Segments)
{
	const float Clamped = FMath::Clamp(Fraction, 0.f, 1.f);
	Canvas->K2_DrawBox(Position, Size, 1.f, Background);

	if (!bSegmented)
	{
		Canvas->K2_DrawBox(Position + FVector2D(1.f, 1.f),
			FVector2D((Size.X - 2.f) * Clamped, Size.Y - 2.f), 1.f, Fill);
		return;
	}

	// Segmented bars read as "chunks of health" at a glance and give the bar a
	// mechanical, tactical look instead of a smooth progress bar.
	const int32 Count = FMath::Max(1, Segments);
	const float Gap = 2.f;
	const float SegmentWidth = (Size.X - Gap * (Count - 1)) / Count;
	const int32 FilledSegments = FMath::CeilToInt(Clamped * Count);

	for (int32 i = 0; i < Count; ++i)
	{
		const FVector2D SegmentPos = Position + FVector2D(i * (SegmentWidth + Gap), 0.f);
		const float SegmentFraction = FMath::Clamp(Clamped * Count - i, 0.f, 1.f);
		if (i < FilledSegments && SegmentFraction > 0.f)
		{
			Canvas->K2_DrawBox(SegmentPos, FVector2D(SegmentWidth * SegmentFraction, Size.Y), 1.f, Fill);
		}
	}
}

void ABreachlineHUD::DrawLine(FVector2D From, FVector2D To, const FLinearColor& Color, float Thickness)
{
	Canvas->K2_DrawLine(From, To, Thickness, Color);
}

void ABreachlineHUD::DrawRing(FVector2D Centre, float Radius, const FLinearColor& Color, float Thickness, int32 Segments)
{
	const int32 Count = FMath::Max(8, Segments);
	FVector2D Previous = Centre + FVector2D(0.f, -Radius);
	for (int32 i = 1; i <= Count; ++i)
	{
		const float Angle = (2.f * PI * i) / Count;
		const FVector2D Point = Centre + FVector2D(FMath::Sin(Angle) * Radius, -FMath::Cos(Angle) * Radius);
		DrawLine(Previous, Point, Color, Thickness);
		Previous = Point;
	}
}

void ABreachlineHUD::DrawArc(FVector2D Centre, float Radius, float StartDeg, float EndDeg,
	const FLinearColor& Color, float Thickness, int32 Segments)
{
	const int32 Count = FMath::Max(2, Segments);
	FVector2D Previous = Centre;
	for (int32 i = 0; i <= Count; ++i)
	{
		const float Angle = FMath::DegreesToRadians(FMath::Lerp(StartDeg, EndDeg, float(i) / Count));
		// 0° points up on screen; positive angles rotate clockwise.
		const FVector2D Point = Centre + FVector2D(FMath::Sin(Angle) * Radius, -FMath::Cos(Angle) * Radius);
		if (i > 0) DrawLine(Previous, Point, Color, Thickness);
		Previous = Point;
	}
}

void ABreachlineHUD::DrawLabel(const FString& Text, FVector2D Position, const FLinearColor& Color,
	UFont* Font, bool bCentred, float Scale)
{
	Canvas->K2_DrawText(Font ? Font : MediumFont, Text, Position, FVector2D(Scale, Scale), Color,
		/*Kerning*/ 0.f, /*Shadow*/ FLinearColor(0.f, 0.f, 0.f, 0.75f), FVector2D(1.f, 1.f),
		bCentred, /*bCentreY*/ false, /*bOutlined*/ false, Ink);
}

// -------------------------------------------------------------------- vitals --
void ABreachlineHUD::DrawVitals(const FHudSnapshot& S, float Now)
{
	const float Margin = 24.f;
	// A visible, creeping pulse below 35% health: the screen is already tinting,
	// this makes the last few segments impossible to ignore.
	const float LowHealthPulse = S.Health / FMath::Max(1.f, S.MaxHealth) < 0.35f
		? 0.6f + 0.4f * FMath::Sin(Now * 6.f)
		: 1.f;

	const FVector2D PanelPos(Margin, Canvas->ClipY - 118.f);
	const FVector2D PanelSize(268.f, 94.f);
	DrawPanel(PanelPos, PanelSize, PanelFill, PanelBorder);

	const FVector2D HealthPos = PanelPos + FVector2D(12.f, 16.f);
	const float HealthFraction = S.Health / FMath::Max(1.f, S.MaxHealth);
	DrawBar(HealthPos, FVector2D(196.f, 14.f), HealthFraction,
		WithAlpha(HealthFraction < 0.35f ? HealthLow : HealthColour, LowHealthPulse), FLinearColor(0.f, 0.f, 0.f, 0.45f));
	DrawLabel(FString::Printf(TEXT("%d"), FMath::CeilToInt(S.Health)), HealthPos + FVector2D(202.f, -2.f), TextPrimary, MediumFont);

	const FVector2D ArmourPos = HealthPos + FVector2D(0.f, 22.f);
	const bool bHasArmour = S.MaxArmor > 0.f;
	DrawBar(ArmourPos, FVector2D(196.f, 8.f), bHasArmour ? S.Armor / S.MaxArmor : 0.f,
		ArmourColour, FLinearColor(0.f, 0.f, 0.f, 0.45f));
	DrawLabel(bHasArmour ? FormatRound(S.Armor) : TEXT("--"), ArmourPos + FVector2D(202.f, -5.f), TextDim, SmallFont);

	// Equipment: grenades (count) and medkits (collected this run).
	const FVector2D EquipPos = PanelPos + FVector2D(12.f, 62.f);
	DrawLabel(FString::Printf(TEXT("G x%d"), S.Grenades), EquipPos, TextPrimary, SmallFont);
	DrawLabel(FString::Printf(TEXT("MEDKITS %d"), S.MedkitsUsed), EquipPos + FVector2D(78.f, 0.f), TextDim, SmallFont);

	// Stance readout: what the operator is doing, spelled out.
	FString Stance = TEXT("STANDING");
	if (S.bCrouched) Stance = TEXT("CROUCHED");
	if (S.bSprinting) Stance = TEXT("SPRINTING");
	if (S.bAiming) Stance += TEXT(" / AIM");
	DrawLabel(Stance, EquipPos + FVector2D(0.f, 18.f), S.bSprinting ? AmmoColour : TextDim, SmallFont);
}

// ------------------------------------------------------------------- weapon ---
void ABreachlineHUD::DrawWeaponBlock(const FHudSnapshot& S, float Now)
{
	const float Margin = 24.f;
	const FVector2D PanelSize(252.f, 94.f);
	const FVector2D PanelPos(Canvas->ClipX - Margin - PanelSize.X, Canvas->ClipY - 118.f);
	DrawPanel(PanelPos, PanelSize, PanelFill, PanelBorder);

	// Weapon name + id, so switching slots is legible without looking away.
	DrawLabel(S.WeaponName.IsEmpty() ? TEXT("UNARMED") : S.WeaponName.ToString().ToUpper(),
		PanelPos + FVector2D(12.f, 12.f), TextPrimary, MediumFont);

	// Magazine: the number that actually matters, in the biggest font available.
	const FString MagText = S.bReloading ? TEXT("--") : FormatInt(S.MagAmmo);
	DrawLabel(MagText, PanelPos + FVector2D(PanelSize.X - 16.f, 8.f), S.bReloading ? AmmoColour : TextPrimary,
		LargeFont, /*bCentred*/ true);

	DrawLabel(FString::Printf(TEXT("/ %d"), S.ReserveAmmo), PanelPos + FVector2D(PanelSize.X - 16.f, 40.f),
		TextDim, SmallFont, /*bCentred*/ true);

	// Reload bar (indeterminate pulse) or a magazine strip.
	const FVector2D BarPos = PanelPos + FVector2D(12.f, 58.f);
	const FVector2D BarSize(228.f, 10.f);
	if (S.bReloading)
	{
		const float Pulse = 0.35f + 0.65f * FMath::Abs(FMath::Sin(Now * 4.f));
		DrawBar(BarPos, BarSize, Pulse, WithAlpha(AmmoColour, 0.85f), FLinearColor(0.f, 0.f, 0.f, 0.5f));
		DrawLabel(TEXT("RELOADING"), BarPos + FVector2D(0.f, 14.f), AmmoColour, SmallFont);
	}
	else
	{
		// Rounds-per-magazine strip: how full the magazine is, at a glance.
		const float Fraction = FMath::Clamp(S.MagAmmo / 30.f, 0.f, 1.f);
		DrawBar(BarPos, BarSize, Fraction, WithAlpha(AmmoColour, 0.7f), FLinearColor(0.f, 0.f, 0.f, 0.5f), true, 10);
		DrawLabel(FString::Printf(TEXT("%d HOSTILES"), S.EnemiesRemaining), BarPos + FVector2D(0.f, 14.f), TextDim, SmallFont);
	}
}

// ---------------------------------------------------------------- objective ---
void ABreachlineHUD::DrawObjective(const FHudSnapshot& S, float Now)
{
	const FVector2D Centre(Canvas->ClipX * 0.5f, 18.f);
	const FVector2D PanelSize(360.f, 58.f);
	DrawPanel(Centre - FVector2D(PanelSize.X * 0.5f, 0.f), PanelSize, PanelFill, PanelBorder);

	const FString RoundText = S.RoundLabel.IsEmpty()
		? FString::Printf(TEXT("ROUND %d"), S.RoundIndex + 1)
		: S.RoundLabel.ToString().ToUpper();
	DrawLabel(RoundText, Centre, TextPrimary, MediumFont, /*bCentred*/ true);

	const float Accuracy = S.ShotsFired > 0 ? float(S.ShotsHit) / float(S.ShotsFired) : 0.f;
	DrawLabel(FString::Printf(TEXT("SCORE %d   KILLS %d   ACC %.0f%%"),
		S.Score, S.Kills, Accuracy * 100.f), Centre + FVector2D(0.f, 22.f), TextDim, SmallFont, true);

	if (S.EnemiesRemaining > 0)
	{
		const FString Remaining = FString::Printf(TEXT("%d HOSTILE%s REMAINING"),
			S.EnemiesRemaining, S.EnemiesRemaining == 1 ? TEXT("") : TEXT("S"));
		DrawLabel(Remaining, Centre + FVector2D(0.f, 38.f), AmmoColour, SmallFont, true);
	}
	else
	{
		// Between waves: a beat of breathing room, clearly signposted.
		const float Pulse = 0.55f + 0.45f * FMath::Sin(Now * 3.f);
		DrawLabel(TEXT("AREA CLEAR — REARMING"), Centre + FVector2D(0.f, 38.f), WithAlpha(HealthColour, Pulse), SmallFont, true);
	}
}

// -------------------------------------------------------------------- radar ---
FVector2D ABreachlineHUD::WorldToRadarOffset(const FVector& World, const FVector& PlayerLocation,
	float AzimuthDeg, float PixelsPerCm) const
{
	// Camera-relative frame: forward is always "up" on the scope, so a blip's
	// direction on the radar matches the direction on screen even after the
	// player orbits the camera with Q/E. The maths lives in BreachlineMath.h so
	// it can be unit-tested without a viewport.
	return Breachline::ToRadarPixels(
		Breachline::ToRadarLocal(World, PlayerLocation, AzimuthDeg), PixelsPerCm);
}

void ABreachlineHUD::DrawRadar(const FHudSnapshot& S, float Now)
{
	const float Margin = 24.f;
	const float Size = Hud::RadarSizePx;              // 158 px, as specified
	const float Radius = Size * 0.5f - 6.f;

	const FVector2D PanelPos(Canvas->ClipX - Margin - Size, Margin);
	const FVector2D Centre = PanelPos + FVector2D(Size * 0.5f, Size * 0.5f);

	// Scope body: a filled circle approximated with a solid box + rings, which
	// keeps it readable over bright ground without any texture.
	Canvas->K2_DrawBox(PanelPos, FVector2D(Size, Size), 1.f, ScopeFill);
	DrawRing(Centre, Radius, WithAlpha(TextPrimary, 0.35f), 1.5f);
	DrawRing(Centre, Radius * 0.66f, WithAlpha(TextPrimary, 0.16f), 1.f);
	DrawRing(Centre, Radius * 0.33f, WithAlpha(TextPrimary, 0.16f), 1.f);
	DrawLine(Centre - FVector2D(Radius, 0.f), Centre + FVector2D(Radius, 0.f), WithAlpha(TextPrimary, 0.10f), 1.f);
	DrawLine(Centre - FVector2D(0.f, Radius), Centre + FVector2D(0.f, Radius), WithAlpha(TextPrimary, 0.10f), 1.f);

	// North marker: the scope is camera-relative, so absolute north has to be
	// drawn explicitly or the player loses their bearings while orbiting.
	const float Azimuth = GetPlayerControllerSafe() && GetPlayerControllerSafe()->GetRig()
		? GetPlayerControllerSafe()->GetRig()->GetAzimuthDegrees() : 45.f;
	const float NorthAngle = FMath::DegreesToRadians(-(90.f - Azimuth));
	DrawLine(Centre + FVector2D(FMath::Sin(NorthAngle), -FMath::Cos(NorthAngle)) * (Radius - 8.f),
		Centre + FVector2D(FMath::Sin(NorthAngle), -FMath::Cos(NorthAngle)) * (Radius - 2.f),
		WithAlpha(TextPrimary, 0.7f), 2.f);

	// Sweep line: a rotating radar arm. Purely cosmetic, but it makes the scope
	// feel alive and gives the eye a reference for blip movement.
	const float SweepAngle = FMath::DegreesToRadians(FMath::Fmod(Now * 72.f, 360.f));
	const FVector2D SweepDir(FMath::Sin(SweepAngle), -FMath::Cos(SweepAngle));
	DrawLine(Centre, Centre + SweepDir * Radius, WithAlpha(PickupColour, 0.22f), 1.5f);

	const ABreachlinePlayerController* Reader = GetPlayerControllerSafe();
	// Radar range covers exactly Radar::BlipRangeM at the rim.
	const float PixelsPerCm = Radius / MetersToUU(Radar::BlipRangeM);
	const FVector PlayerLocation = Reader && Reader->GetPawn() ? Reader->GetPawn()->GetActorLocation() : FVector::ZeroVector;

	// Enemy contacts. Aware hostiles are drawn bright red (they are looking at
	// the player); unaware ones are faint; corpses fade to a dark speck.
	const bool bDanger = S.ThreatLevel > Threats::AwareThreshold;
	for (const FRadarBlip& Blip : S.RadarContacts)
	{
		const FVector World(Blip.Location.X, Blip.Location.Y, PlayerLocation.Z);
		bool bClamped = false;
		const FVector2D Offset = ClampToScope(
			WorldToRadarOffset(World, PlayerLocation, Azimuth, PixelsPerCm), Radius, bClamped);

		const bool bAware = Blip.Weight > Threats::AwareThreshold;
		const FLinearColor Colour = bAware
			? WithAlpha(DangerColour, bDanger ? 0.95f : 0.75f)
			: (Blip.Weight <= Threats::CorpseWeight ? WithAlpha(DangerColour, 0.25f) : FaintContact);

		if (bAware)
		{
			// Aware contacts pulse, so a new contact is noticed without reading.
			const float Pulse = 0.65f + 0.35f * S.ThreatLevel;
			Canvas->K2_DrawBox(Centre + Offset - FVector2D(3.f, 3.f), FVector2D(6.f, 6.f), 1.f, WithAlpha(Colour, Pulse));
			if (bClamped)
			{
				// Clamped blips get a chevron so "far away, that direction" is clear.
				DrawLine(Centre + Offset, Centre + Offset - Offset.GetSafeNormal() * 6.f, Colour, 2.f);
			}
		}
		else
		{
			Canvas->K2_DrawBox(Centre + Offset - FVector2D(2.f, 2.f), FVector2D(4.f, 4.f), 1.f, Colour);
		}
	}

	// Field kits, always visible on the scope: finding the medkit is the reason
	// to look at the radar in the first place.
	for (const FVector2D& Pickup : S.RadarPickups)
	{
		const FVector World(Pickup.X, Pickup.Y, PlayerLocation.Z);
		bool bPickupClamped = false;
		const FVector2D Offset = ClampToScope(
			WorldToRadarOffset(World, PlayerLocation, Azimuth, PixelsPerCm), Radius, bPickupClamped);
		DrawLine(Centre + Offset - FVector2D(3.f, 0.f), Centre + Offset + FVector2D(3.f, 0.f), PickupColour, 2.f);
		DrawLine(Centre + Offset - FVector2D(0.f, 3.f), Centre + Offset + FVector2D(0.f, 3.f), PickupColour, 2.f);
	}

	// Player: centre dot with a facing wedge.
	Canvas->K2_DrawBox(Centre - FVector2D(2.f, 2.f), FVector2D(4.f, 4.f), 1.f, TextPrimary);
	DrawLine(Centre, Centre + FVector2D(0.f, -9.f), WithAlpha(TextPrimary, 0.9f), 2.f);

	if (bDanger)
	{
		DrawThreatWedge(S, Centre, Radius, Now);
	}

	DrawLabel(TEXT("RADAR"), PanelPos + FVector2D(4.f, Size - 14.f), TextDim, SmallFont);
	if (bDanger)
	{
		const FString ThreatText = S.ThreatDistance >= 0.f
			? FString::Printf(TEXT("CONTACT %.0fm"), S.ThreatDistance)
			: FString::Printf(TEXT("CONTACTS %d"), S.ThreatCount);
		DrawLabel(ThreatText, PanelPos + FVector2D(Size - 4.f, Size - 14.f), DangerColour, SmallFont, true);
	}
}

void ABreachlineHUD::DrawThreatWedge(const FHudSnapshot& S, FVector2D RadarCentre, float Radius, float Now)
{
	const ABreachlinePlayerController* Reader = GetPlayerControllerSafe();
	const float Pulse = Reader ? Reader->GetThreatPulse() : 0.5f;

	// The danger line: a thick red arc on the rim at the threat's bearing, with
	// its brightness driven by how confident the shooter is. This is the one
	// element that must be readable out of the corner of the eye.
	const float Start = S.ThreatAngleDeg - 14.f;
	const float End = S.ThreatAngleDeg + 14.f;
	DrawArc(RadarCentre, Radius, Start, End, WithAlpha(DangerColour, 0.35f + 0.55f * Pulse), 5.f, 10);
	DrawArc(RadarCentre, Radius + 4.f, S.ThreatAngleDeg - 5.f, S.ThreatAngleDeg + 5.f, DangerColour, 3.f, 4);

	// Inward pointer: which way to look right now.
	const FVector2D Direction(FMath::Sin(FMath::DegreesToRadians(S.ThreatAngleDeg)),
		-FMath::Cos(FMath::DegreesToRadians(S.ThreatAngleDeg)));
	DrawLine(RadarCentre + Direction * (Radius - 22.f), RadarCentre + Direction * (Radius - 8.f),
		WithAlpha(DangerColour, 0.6f + 0.4f * Pulse), 2.f);

	// A ring pulse on the whole scope at a rate that rises with the threat.
	DrawRing(RadarCentre, Radius + 3.f + 4.f * Pulse, WithAlpha(DangerColour, 0.5f * (1.f - Pulse)), 2.f, 40);
	(void)Now;
}

// ------------------------------------------------------------------- reticle --
void ABreachlineHUD::DrawReticle(const FHudSnapshot& S, float Now)
{
	const ABreachlinePlayerController* PC = GetPlayerControllerSafe();
	if (!PC) return;

	TArray<FVector2D> Points;
	PC->GetReticlePoints(Points);
	if (Points.Num() < 5) return;

	const FVector2D Centre = Points[4];
	const float Gap = (Points[0] - Centre).Size();
	const FLinearColor Colour = WithAlpha(TextPrimary, 0.85f);
	const float Tick = S.bAiming ? 8.f : 5.f;

	// Four ticks that breathe with the live spread value: the reticle is a
	// readout of weapon state (movement, aim, bloom), not decoration.
	DrawLine(Centre + FVector2D(0.f, -Gap), Centre + FVector2D(0.f, -Gap - Tick), Colour, 2.f);
	DrawLine(Centre + FVector2D(0.f, Gap), Centre + FVector2D(0.f, Gap + Tick), Colour, 2.f);
	DrawLine(Centre + FVector2D(-Gap, 0.f), Centre + FVector2D(-Gap - Tick, 0.f), Colour, 2.f);
	DrawLine(Centre + FVector2D(Gap, 0.f), Centre + FVector2D(Gap + Tick, 0.f), Colour, 2.f);
	DrawLine(Centre - FVector2D(2.f, 0.f), Centre + FVector2D(2.f, 0.f), Colour, 1.f);

	// Hit marker: an X in the middle, briefly, coloured by the result.
	const FBreachlineHitMarker& Marker = PC->GetHitMarker();
	const float Age = Now - Marker.Time;
	if (Age >= 0.f && Age < 0.28f)
	{
		const float Alpha = 1.f - (Age / 0.28f);
		const FLinearColor MarkerColour = Marker.bKill ? DangerColour : (Marker.bHeadshot ? AmmoColour : TextPrimary);
		const float Size = Marker.bHeadshot || Marker.bKill ? 12.f : 9.f;
		const float Thickness = Marker.bKill ? 3.f : 2.f;
		for (int32 Corner = 0; Corner < 4; ++Corner)
		{
			const float SignX = (Corner & 1) ? 1.f : -1.f;
			const float SignY = (Corner & 2) ? 1.f : -1.f;
			const FVector2D Inner = Centre + FVector2D(SignX * Gap * 0.45f, SignY * Gap * 0.45f);
			DrawLine(Inner, Inner + FVector2D(SignX * Size, SignY * Size), WithAlpha(MarkerColour, Alpha), Thickness);
		}
		if (Marker.bKill)
		{
			DrawLabel(TEXT("KILL"), Centre + FVector2D(0.f, Gap + 18.f), WithAlpha(DangerColour, Alpha), SmallFont, true);
		}
	}

	// Damage number: floating to the right of the reticle, fading up and out.
	if (Age >= 0.f && Age < 0.5f && Marker.Damage > 0)
	{
		const float Alpha = 1.f - (Age / 0.5f);
		DrawLabel(FString::Printf(TEXT("%d"), Marker.Damage),
			Centre + FVector2D(Gap + 16.f, -Gap - 14.f - Age * 24.f),
			WithAlpha(Marker.bHeadshot ? AmmoColour : TextPrimary, Alpha), MediumFont);
	}
}

// ------------------------------------------------------------------- banners --
void ABreachlineHUD::DrawBanners(const FHudSnapshot& S, float Now)
{
	const FVector2D Centre(Canvas->ClipX * 0.5f, Canvas->ClipY * 0.32f);

	if (S.ResupplyFade > 0.f)
	{
		const float Alpha = FMath::Clamp(S.ResupplyFade / Hud::BannerSeconds, 0.f, 1.f);
		DrawLabel(TEXT("REARMED — HEALTH, AMMO AND GRENADES RESTORED"),
			Centre, WithAlpha(HealthColour, Alpha), MediumFont, /*bCentred*/ true);
	}
	if (S.LastHeal > 0.f)
	{
		const float Alpha = FMath::Clamp(S.LastHeal / 30.f, 0.f, 1.f);
		DrawLabel(FString::Printf(TEXT("+%d HEALTH"), FMath::RoundToInt(S.LastHeal)),
			Centre + FVector2D(0.f, 26.f), WithAlpha(PickupColour, Alpha), MediumFont, true);
	}
	(void)Now;
}

// ------------------------------------------------------------------ vignette --
void ABreachlineHUD::DrawDamageVignette(const FHudSnapshot& S, float Now)
{
	const float HealthFraction = S.Health / FMath::Max(1.f, S.MaxHealth);
	if (HealthFraction > 0.45f) return;

	// Edge bands instead of a texture vignette: cheap, resolution independent and
	// it never obscures the centre of the screen where the fight is.
	const float Intensity = FMath::Clamp((0.45f - HealthFraction) / 0.45f, 0.f, 1.f);
	const float Pulse = 0.55f + 0.45f * FMath::Sin(Now * 4.5f);
	const float Alpha = 0.28f * Intensity * Pulse;
	const float Thickness = 90.f + 60.f * Intensity;

	const FLinearColor Blood(DangerColour.R, DangerColour.G, DangerColour.B, Alpha);
	Canvas->K2_DrawBox(FVector2D(0.f, 0.f), FVector2D(Canvas->ClipX, Thickness), 1.f, Blood);
	Canvas->K2_DrawBox(FVector2D(0.f, Canvas->ClipY - Thickness), FVector2D(Canvas->ClipX, Thickness), 1.f, Blood);
	Canvas->K2_DrawBox(FVector2D(0.f, 0.f), FVector2D(Thickness, Canvas->ClipY), 1.f, Blood);
	Canvas->K2_DrawBox(FVector2D(Canvas->ClipX - Thickness, 0.f), FVector2D(Thickness, Canvas->ClipY), 1.f, Blood);
}

void ABreachlineHUD::DrawDamageIndicator(float Now)
{
	const ABreachlinePlayerController* PC = GetPlayerControllerSafe();
	if (!PC) return;

	FVector Direction;
	float Age = 0.f;
	if (!PC->GetDamageDirection(Direction, Age)) return;

	const float Alpha = FMath::Clamp(1.f - (Age / Hud::DamageIndicatorSeconds), 0.f, 1.f);
	const float Azimuth = PC->GetRig() ? PC->GetRig()->GetAzimuthDegrees() : 45.f;
	const float Bearing = FRotator::NormalizeAxis(Direction.Rotation().Yaw - Azimuth + 90.f);

	// An arc on the perimeter of a ring around the crosshair: "you were hit from
	// that way" without a compass the player has to interpret.
	const FVector2D Centre(Canvas->ClipX * 0.5f, Canvas->ClipY * 0.5f);
	DrawArc(Centre, 132.f, Bearing - 18.f, Bearing + 18.f, WithAlpha(DangerColour, Alpha), 6.f, 8);
	(void)Now;
}

ABreachlinePlayerController* ABreachlineHUD::GetPlayerControllerSafe() const
{
	return Cast<ABreachlinePlayerController>(PlayerOwner);
}
