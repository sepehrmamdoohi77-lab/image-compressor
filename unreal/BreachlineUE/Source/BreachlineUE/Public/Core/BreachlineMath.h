// Copyright (c) Breachline UE. All rights reserved.
//
// Small, pure geometry helpers shared by the HUD, the camera and the tests.
// They live outside the HUD on purpose: the radar projection is the one piece
// of HUD maths that can be wrong in a way nobody notices until it matters
// (a contact drawn on the wrong side of the scope), so it must be unit-testable.

#pragma once

#include "CoreMinimal.h"
#include "Core/BreachlineBalance.h"

namespace Breachline
{
	/**
	 * World point -> camera-relative radar plane, in centimetres.
	 *   X = right on the scope, Y = forward on the scope ("up" when drawn).
	 * The isometric rig's azimuth is the only input: the operator can orbit the
	 * camera freely and the radar stays aligned with what they are looking at.
	 */
	FORCEINLINE FVector2D ToRadarLocal(const FVector& World, const FVector& Origin, float AzimuthDeg)
	{
		const FVector Delta = World - Origin;
		const FRotationMatrix Basis(FRotator(0.f, AzimuthDeg, 0.f));
		const FVector Forward = Basis.GetUnitAxis(EAxis::X);
		const FVector Right = Basis.GetUnitAxis(EAxis::Y);
		return FVector2D(FVector::DotProduct(Delta, Right), FVector::DotProduct(Delta, Forward));
	}

	/** Radar plane (cm) -> pixels, with up on screen being -Y. */
	FORCEINLINE FVector2D ToRadarPixels(const FVector2D& Local, float PixelsPerCm)
	{
		return FVector2D(Local.X * PixelsPerCm, -Local.Y * PixelsPerCm);
	}

	/** Pixels per centimetre for a scope of RadiusPx showing RangeM metres. */
	FORCEINLINE float RadarScale(float RadiusPx, float RangeM)
	{
		return RadiusPx / FMath::Max(1.f, MetersToUU(RangeM));
	}

	/**
	 * Clamps a contact to the rim of the scope. Out bClamped tells the caller to
	 * draw an edge chevron, because a contact pinned to the rim means "out of
	 * radar range in that direction", not "standing on the rim".
	 */
	FORCEINLINE FVector2D ClampToScope(const FVector2D& Offset, float RadiusPx, bool& bOutClamped)
	{
		const float Length = Offset.Size();
		if (Length <= RadiusPx || Length <= KINDA_SMALL_NUMBER)
		{
			bOutClamped = false;
			return Offset;
		}
		bOutClamped = true;
		return Offset * (RadiusPx / Length);
	}

	/** Screen-space bearing for a world direction: 0 = up, positive = clockwise. */
	FORCEINLINE float BearingDegrees(const FVector& WorldDirection, float AzimuthDeg)
	{
		const float WorldYaw = WorldDirection.Rotation().Yaw;
		return FRotator::NormalizeAxis(WorldYaw - AzimuthDeg + 90.f);
	}
}
