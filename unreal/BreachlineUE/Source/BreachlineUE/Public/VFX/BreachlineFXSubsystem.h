// Copyright (c) Breachline UE. All rights reserved.

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "Core/BreachlineTypes.h"
#include "BreachlineFXSubsystem.generated.h"

class ABreachlineFXPool;
class UNiagaraComponent;
class UNiagaraSystem;
struct FHitResult;

/**
 * The one place gameplay asks for a visual. Resolves Niagara assets from Project
 * Settings and falls back to the pooled primitive VFX actor, so combat code
 * never has to ask "do we have art yet?".
 */
UCLASS()
class BREACHLINEUE_API UBreachlineFXSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	UFUNCTION(BlueprintCallable, Category = "Breachline|FX")
	void SpawnTracer(const FVector& Start, const FVector& End, const FBreachlineWeaponDef& Weapon, bool bEnemy);

	UFUNCTION(BlueprintCallable, Category = "Breachline|FX")
	void SpawnMuzzleFlash(const FVector& Location, const FVector& Direction, const FBreachlineWeaponDef& Weapon, bool bEnemy);

	UFUNCTION(BlueprintCallable, Category = "Breachline|FX")
	void SpawnImpact(const FHitResult& Hit, bool bFlesh, const FBreachlineWeaponDef& Weapon, bool bEnemy);

	UFUNCTION(BlueprintCallable, Category = "Breachline|FX")
	void SpawnExplosion(const FVector& Location, float RadiusMeters);

	/** Ambient dust around the player: the compound never looks sterile. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|FX")
	void SetAmbientFocus(const FVector& Location);

	UFUNCTION(BlueprintCallable, Category = "Breachline|FX")
	void SetDensityScale(float Scale);

	/** Quality tier: Niagara-heavy effects are skipped on Low. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|FX")
	void SetDetailEnabled(bool bEnabled);

	ABreachlineFXPool* GetPool() const { return Pool; }

private:
	UNiagaraSystem* ResolveMuzzle() const;
	UNiagaraSystem* ResolveImpact() const;
	UNiagaraSystem* ResolveTracer() const;
	UNiagaraSystem* ResolveExplosion() const;

	UNiagaraComponent* SpawnNiagara(UNiagaraSystem* System, const FVector& Location, const FRotator& Rotation, bool bAutoDestroy);

	UPROPERTY(Transient) TObjectPtr<ABreachlineFXPool> Pool = nullptr;
	UPROPERTY(Transient) TObjectPtr<UNiagaraComponent> Dust = nullptr;

	/** Enemy tracers are one fixed colour so incoming fire is never misread. */
	FLinearColor EnemyTracerColor = FLinearColor(1.f, 0.416f, 0.361f);

	float DensityScale = 1.f;
	bool bDetailEnabled = true;
};
