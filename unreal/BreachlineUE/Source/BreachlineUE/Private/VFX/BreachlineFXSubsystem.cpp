// Copyright (c) Breachline UE. All rights reserved.

#include "VFX/BreachlineFXSubsystem.h"
#include "VFX/BreachlineFXPool.h"
#include "Core/BreachlineSettings.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"
#include "NiagaraSystem.h"
#include "Engine/World.h"
#include "Engine/Engine.h"
#include "DrawDebugHelpers.h"
#include "BreachlineUE.h"

void UBreachlineFXSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	UWorld* World = GetWorld();
	if (!World) return;

	// The pool is spawned lazily-but-eagerly: it is cheap (three ISMs and six
	// lights) and every combat frame may want it.
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Params.ObjectFlags |= RF_Transient;
	Pool = World->SpawnActor<ABreachlineFXPool>(ABreachlineFXPool::StaticClass(), FTransform::Identity, Params);
}

void UBreachlineFXSubsystem::Deinitialize()
{
	if (IsValid(Pool))
	{
		Pool->Destroy();
	}
	Pool = nullptr;
	if (IsValid(Dust))
	{
		Dust->DestroyComponent();
	}
	Dust = nullptr;

	Super::Deinitialize();
}

UNiagaraSystem* UBreachlineFXSubsystem::ResolveMuzzle() const
{
	const UBreachlineSettings* Settings = UBreachlineSettings::Get();
	return Settings->MuzzleFlashFX.IsNull() ? nullptr : Settings->MuzzleFlashFX.LoadSynchronous();
}

UNiagaraSystem* UBreachlineFXSubsystem::ResolveImpact() const
{
	const UBreachlineSettings* Settings = UBreachlineSettings::Get();
	return Settings->ImpactFX.IsNull() ? nullptr : Settings->ImpactFX.LoadSynchronous();
}

UNiagaraSystem* UBreachlineFXSubsystem::ResolveTracer() const
{
	const UBreachlineSettings* Settings = UBreachlineSettings::Get();
	return Settings->TracerFX.IsNull() ? nullptr : Settings->TracerFX.LoadSynchronous();
}

UNiagaraSystem* UBreachlineFXSubsystem::ResolveExplosion() const
{
	const UBreachlineSettings* Settings = UBreachlineSettings::Get();
	return Settings->ExplosionFX.IsNull() ? nullptr : Settings->ExplosionFX.LoadSynchronous();
}

UNiagaraComponent* UBreachlineFXSubsystem::SpawnNiagara(
	UNiagaraSystem* System, const FVector& Location, const FRotator& Rotation, bool bAutoDestroy)
{
	if (!System || !bDetailEnabled) return nullptr;
	return UNiagaraFunctionLibrary::SpawnSystemAtLocation(
		GetWorld(), System, Location, Rotation, FVector::OneVector, /*bAutoDestroy*/ bAutoDestroy,
		/*bAutoActivate*/ true, ENCPoolMethod::AutoRelease, /*bPreCullCheck*/ true);
}

void UBreachlineFXSubsystem::SpawnTracer(
	const FVector& Start, const FVector& End, const FBreachlineWeaponDef& Weapon, bool bEnemy)
{
	const FLinearColor Color = bEnemy ? EnemyTracerColor : Weapon.TracerColor;

	if (UNiagaraSystem* TracerFX = ResolveTracer())
	{
		if (UNiagaraComponent* Comp = SpawnNiagara(TracerFX, Start, (End - Start).Rotation(), true))
		{
			Comp->SetVectorParameter(TEXT("User.Start"), Start);
			Comp->SetVectorParameter(TEXT("User.End"), End);
			Comp->SetColorParameter(TEXT("User.Color"), Color);
			Comp->SetFloatParameter(TEXT("User.Width"), bEnemy ? 1.4f : 1.f);
			return;
		}
	}

	const float Life = FMath::Clamp(Weapon.Range / 900.f, 0.04f, 0.12f);
	if (Pool)
	{
		Pool->AddTracer(Start, End, Color, bEnemy ? 3.4f : 2.2f, Life * DensityScale + 0.02f);
	}
}

void UBreachlineFXSubsystem::SpawnMuzzleFlash(
	const FVector& Location, const FVector& Direction, const FBreachlineWeaponDef& Weapon, bool bEnemy)
{
	if (UNiagaraSystem* MuzzleFX = ResolveMuzzle())
	{
		if (UNiagaraComponent* Comp = SpawnNiagara(MuzzleFX, Location, Direction.Rotation(), true))
		{
			Comp->SetColorParameter(TEXT("User.Color"), bEnemy ? EnemyTracerColor : Weapon.TracerColor);
			Comp->SetFloatParameter(TEXT("User.Scale"), Weapon.Sound.bBig ? 1.6f : 1.f);
			return;
		}
	}
	if (Pool)
	{
		const FLinearColor Color = bEnemy ? EnemyTracerColor : Weapon.TracerColor * 1.4f;
		Pool->AddMuzzleFlash(Location, Direction, Color, Weapon.Sound.bBig ? 1.6f : 1.f);
	}
}

void UBreachlineFXSubsystem::SpawnImpact(
	const FHitResult& Hit, bool bFlesh, const FBreachlineWeaponDef& Weapon, bool bEnemy)
{
	if (UNiagaraSystem* ImpactFX = ResolveImpact())
	{
		if (UNiagaraComponent* Comp = SpawnNiagara(ImpactFX, Hit.ImpactPoint, Hit.ImpactNormal.Rotation(), true))
		{
			Comp->SetBoolParameter(TEXT("User.Flesh"), bFlesh);
			Comp->SetVectorParameter(TEXT("User.Normal"), FVector(Hit.ImpactNormal));
			return;
		}
	}
	if (Pool)
	{
		const FLinearColor Color = bFlesh
			? FLinearColor(0.55f, 0.06f, 0.05f)
			: FLinearColor(0.75f, 0.72f, 0.66f);
		// Flesh impacts use their own colour; surface impacts take the shooter's
		// tracer tint so the player can tell who is shooting at what.
		const FLinearColor ImpactColor = bFlesh ? Color : (bEnemy ? EnemyTracerColor : Weapon.TracerColor);
		Pool->AddImpact(Hit.ImpactPoint, Hit.ImpactNormal, bFlesh, ImpactColor);
	}
}

void UBreachlineFXSubsystem::SpawnExplosion(const FVector& Location, float RadiusMeters)
{
	if (UNiagaraSystem* ExplosionFX = ResolveExplosion())
	{
		if (UNiagaraComponent* Comp = SpawnNiagara(ExplosionFX, Location, FRotator::ZeroRotator, true))
		{
			Comp->SetFloatParameter(TEXT("User.Radius"), RadiusMeters);
			return;
		}
	}
	if (Pool)
	{
		Pool->AddBurst(Location + FVector(0.f, 0.f, 60.f), RadiusMeters, FLinearColor(1.f, 0.55f, 0.2f), 0.55f);
		Pool->AddBurst(Location + FVector(0.f, 0.f, 20.f), RadiusMeters * 1.4f, FLinearColor(0.6f, 0.5f, 0.4f), 0.9f);
	}
}

void UBreachlineFXSubsystem::SetAmbientFocus(const FVector& Location)
{
	const UBreachlineSettings* Settings = UBreachlineSettings::Get();
	UNiagaraSystem* DustFX = Settings->AmbientDustFX.IsNull() ? nullptr : Settings->AmbientDustFX.LoadSynchronous();

	if (!DustFX || !bDetailEnabled)
	{
		if (IsValid(Dust)) Dust->SetActive(false);
		return;
	}

	if (!IsValid(Dust))
	{
		Dust = UNiagaraFunctionLibrary::SpawnSystemAtLocation(
			GetWorld(), DustFX, Location, FRotator::ZeroRotator, FVector::OneVector,
			/*bAutoDestroy*/ false, /*bAutoActivate*/ true, ENCPoolMethod::None, false);
	}
	if (IsValid(Dust))
	{
		Dust->SetWorldLocation(Location);
	}
}

void UBreachlineFXSubsystem::SetDensityScale(float Scale)
{
	DensityScale = FMath::Clamp(Scale, 0.f, 1.f);
	if (Pool)
	{
		Pool->SetDensityScale(DensityScale);
	}
}

void UBreachlineFXSubsystem::SetDetailEnabled(bool bEnabled)
{
	bDetailEnabled = bEnabled;
}
