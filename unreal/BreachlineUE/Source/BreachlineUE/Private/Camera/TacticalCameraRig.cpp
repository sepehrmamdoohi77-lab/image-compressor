// Copyright (c) Breachline UE. All rights reserved.

#include "Camera/TacticalCameraRig.h"
#include "Core/BreachlineBalance.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/World.h"

using namespace Breachline;

ATacticalCameraRig::ATacticalCameraRig()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PostPhysics;

	SceneRoot = CreateDefaultSubobject<USceneComponent>(TEXT("SceneRoot"));
	SetRootComponent(SceneRoot);

	// The spring arm carries the fixed iso offset. bInheritPitch/Yaw/Roll stay
	// false so the rig's own rotation is the only thing that steers the view:
	// rotating the actor pans the camera around the squad, exactly like Q/E in
	// the web build.
	Arm = CreateDefaultSubobject<USpringArmComponent>(TEXT("Arm"));
	Arm->SetupAttachment(SceneRoot);
	Arm->bDoCollisionTest = false;
	Arm->bInheritPitch = false;
	Arm->bInheritYaw = false;
	Arm->bInheritRoll = false;
	Arm->bEnableCameraLag = false;      // we damp the target ourselves, in metres
	Arm->TargetArmLength = MetersToUU(Camera::DistanceM);
	Arm->SetRelativeRotation(FRotator(-Camera::ElevationDeg, Camera::AzimuthDeg, 0.f));
	Arm->SocketOffset = FVector::ZeroVector;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(Arm, USpringArmComponent::SocketName);
	Camera->bUsePawnControlRotation = false;
	Camera->SetFieldOfView(Camera::Fov);
	Camera->PostProcessSettings.bOverride_VignetteIntensity = true;
	Camera->PostProcessSettings.VignetteIntensity = 0.45f;
	// Fixed exposure keeps the dusk grade readable: no auto-exposure pumping
	// when the player walks from a sunlit avenue into a shadowed courtyard.
	Camera->PostProcessSettings.bOverride_AutoExposureMethod = true;
	Camera->PostProcessSettings.AutoExposureMethod = EAutoExposureMethod::AEM_Manual;
	Camera->PostProcessSettings.bOverride_AutoExposureBias = true;
	Camera->PostProcessSettings.AutoExposureBias = 11.5f;
}

void ATacticalCameraRig::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	Time += DeltaSeconds;

	const float Dt = FMath::Clamp(DeltaSeconds, 0.f, 0.05f);

	// Damped follow + azimuth smoothing (frame-rate independent).
	const float FollowAlpha = 1.f - FMath::Exp(-Camera::FollowSmoothing * Dt);
	SmoothedTarget = FMath::Lerp(SmoothedTarget, DesiredTarget, FollowAlpha);

	CurrentAzimuthDeg = FMath::FInterpTo(CurrentAzimuthDeg, TargetAzimuthDeg, Dt, 10.f);

	// Trauma: exponentially decaying random walk, magnitude clamped so the rig
	// never loses the fight.
	Trauma = FMath::Max(0.f, Trauma - Dt * Camera::ShakeDecay);
	const float ShakeMag = FMath::Square(Trauma) * MetersToUU(Camera::MaxShakeOffsetM);
	if (ShakeMag > KINDA_SMALL_NUMBER)
	{
		const FVector Noise(
			FMath::PerlinNoise1D(Time * 11.f + 3.1f),
			FMath::PerlinNoise1D(Time * 9.3f + 17.f),
			FMath::PerlinNoise1D(Time * 13.f + 41.f));
		ShakeOffset = Noise * ShakeMag;
	}
	else
	{
		ShakeOffset = FVector::ZeroVector;
	}

	// Firing kick: a fast-settling offset opposite the shot direction.
	KickOffset = FMath::VInterpTo(KickOffset, FVector::ZeroVector, Dt, 14.f);

	SetActorLocation(SmoothedTarget);

	Arm->TargetArmLength = MetersToUU(DistanceM);
	Arm->SetRelativeRotation(FRotator(-Camera::ElevationDeg, CurrentAzimuthDeg, 0.f));
	Arm->SocketOffset = ShakeOffset + KickOffset;
}

void ATacticalCameraRig::SetTargetLocation(const FVector& WorldLocation, bool bSnap)
{
	DesiredTarget = FVector(WorldLocation.X, WorldLocation.Y, 0.f);
	DesiredTarget.X = FMath::Clamp(DesiredTarget.X, -MetersToUU(HalfExtentM), MetersToUU(HalfExtentM));
	DesiredTarget.Y = FMath::Clamp(DesiredTarget.Y, -MetersToUU(HalfExtentM), MetersToUU(HalfExtentM));
	if (bSnap)
	{
		SmoothedTarget = DesiredTarget;
	}
}

void ATacticalCameraRig::RotateBy(float DeltaDegrees)
{
	TargetAzimuthDeg = FRotator::NormalizeAxis(TargetAzimuthDeg + DeltaDegrees);
}

void ATacticalCameraRig::ResetAzimuth()
{
	TargetAzimuthDeg = Camera::AzimuthDeg;
	CurrentAzimuthDeg = Camera::AzimuthDeg;
}

void ATacticalCameraRig::SetDistance(float Meters)
{
	DistanceM = FMath::Clamp(Meters, Camera::MinDistanceM, Camera::MaxDistanceM);
}

void ATacticalCameraRig::ZoomBy(float DeltaMeters)
{
	SetDistance(DistanceM + DeltaMeters);
}

void ATacticalCameraRig::ApplyProfileDistance(float Meters)
{
	SetDistance(Meters);
}

void ATacticalCameraRig::AddTrauma(float Amount)
{
	Trauma = FMath::Clamp(Trauma + Amount, 0.f, 1.f);
}

void ATacticalCameraRig::Kick(const FVector& WorldDirection, float AmountMeters)
{
	KickOffset -= WorldDirection.GetSafeNormal() * MetersToUU(AmountMeters);
}

bool ATacticalCameraRig::ScreenToGround(const FVector2D& ScreenPosition, FVector& OutWorldPoint) const
{
	if (!Camera) return false;

	FVector Origin;
	FVector Direction;
	if (!Camera->DeprojectScreenPositionToWorld(ScreenPosition.X, ScreenPosition.Y, Origin, Direction))
	{
		return false;
	}
	if (FMath::Abs(Direction.Z) < 1e-4f)
	{
		return false;
	}
	const float T = -Origin.Z / Direction.Z;
	if (T <= 0.f)
	{
		return false;
	}
	OutWorldPoint = Origin + Direction * T;
	OutWorldPoint.Z = 0.f;
	return true;
}

void ATacticalCameraRig::SetBounds(float HalfExtentMeters)
{
	HalfExtentM = FMath::Max(8.f, HalfExtentMeters - Camera::BoundaryMarginM);
}
