// Copyright (c) Breachline UE. All rights reserved.
//
// The whole HUD is drawn in code. No UMG widget blueprint, no textures, no
// font assets — which means it looks identical in a fresh checkout, it cannot
// break when an asset is renamed, and it is trivially themeable from one place.
//
// Layout (all anchored to the viewport, resolution independent):
//   bottom-left   health / armour / equipment
//   bottom-right  weapon, magazine, reserve, reload state
//   top-centre    objective, round, hostiles remaining, score
//   top-right     RADAR (158 px): scope, sweep, contacts, pickups, danger wedge
//   centre        dynamic-spread reticle, hit marker, threat/damage indicators
//
// A UMG version is a drop-in later: the HUD reads only FHudSnapshot.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "Core/BreachlineTypes.h"
#include "BreachlineHUD.generated.h"

class ABreachlinePlayerController;
class UFont;

UCLASS()
class BREACHLINEUE_API ABreachlineHUD : public AHUD
{
	GENERATED_BODY()

public:
	ABreachlineHUD();

	virtual void DrawHUD() override;

	/** Master switch: F1 in the shipped game (also used by the screenshot tests). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|HUD")
	bool bShowHud = true;

protected:
	// --- sections -------------------------------------------------------------
	void DrawVitals(const FHudSnapshot& S, float Now);
	void DrawWeaponBlock(const FHudSnapshot& S, float Now);
	void DrawObjective(const FHudSnapshot& S, float Now);
	void DrawRadar(const FHudSnapshot& S, float Now);
	void DrawThreatWedge(const FHudSnapshot& S, FVector2D RadarCentre, float Radius, float Now);
	void DrawReticle(const FHudSnapshot& S, float Now);
	void DrawBanners(const FHudSnapshot& S, float Now);
	void DrawDamageIndicator(float Now);
	void DrawDamageVignette(const FHudSnapshot& S, float Now);

	// --- drawing primitives (canvas only) ------------------------------------
	void DrawPanel(FVector2D Position, FVector2D Size, const FLinearColor& Fill, const FLinearColor& Border);
	void DrawBar(FVector2D Position, FVector2D Size, float Fraction, const FLinearColor& Fill,
		const FLinearColor& Background, bool bSegmented = false, int32 Segments = 8);
	void DrawRing(FVector2D Centre, float Radius, const FLinearColor& Color, float Thickness, int32 Segments = 48);
	void DrawArc(FVector2D Centre, float Radius, float StartDeg, float EndDeg, const FLinearColor& Color,
		float Thickness, int32 Segments = 12);
	void DrawLine(FVector2D From, FVector2D To, const FLinearColor& Color, float Thickness);
	void DrawLabel(const FString& Text, FVector2D Position, const FLinearColor& Color, UFont* Font,
		bool bCentred = false, float Scale = 1.f);

	/** Radar-local pixel offset for a world point (camera-relative "up"). */
	FVector2D WorldToRadarOffset(const FVector& World, const FVector& PlayerLocation, float AzimuthDeg, float PixelsPerCm) const;

	UPROPERTY() TObjectPtr<UFont> LargeFont = nullptr;
	UPROPERTY() TObjectPtr<UFont> MediumFont = nullptr;
	UPROPERTY() TObjectPtr<UFont> SmallFont = nullptr;

private:
	ABreachlinePlayerController* GetPlayerControllerSafe() const;
};
