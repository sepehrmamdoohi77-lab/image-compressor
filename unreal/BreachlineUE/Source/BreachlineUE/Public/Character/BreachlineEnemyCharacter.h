// Copyright (c) Breachline UE. All rights reserved.

#pragma once

#include "CoreMinimal.h"
#include "Character/BreachlineCharacterBase.h"
#include "Core/BreachlineTypes.h"
#include "BreachlineEnemyCharacter.generated.h"

class UWeaponComponent;

/**
 * A hostile. Combat decisions live in ATacticalAIController; this class owns the
 * body: which archetype it is, how difficulty scales it, the gun it carries and
 * the per-archetype look (tint + build scale) so friend/foe is readable at a glance.
 *
 * Everything here works with zero art assets: an unscaled capsule with a tinted
 * material plus a socket-less muzzle offset plays correctly, and swapping in a
 * MetaHuman/skeletal mesh later only changes presentation.
 */
UCLASS()
class BREACHLINEUE_API ABreachlineEnemyCharacter : public ABreachlineCharacterBase
{
	GENERATED_BODY()

public:
	ABreachlineEnemyCharacter();

	virtual void BeginPlay() override;

	/** Called by the spawner once the archetype for this enemy is chosen. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Enemy")
	void Configure(const FEnemyArchetypeDef& InArchetype, float HealthMult, float AccuracyMult, float AggressionMult);

	/** Fires the carried weapon (rate limiting is the weapon's job). */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Enemy")
	bool FireWeapon();

	UFUNCTION(BlueprintCallable, Category = "Breachline|Enemy")
	void ReloadWeapon();

	UFUNCTION(BlueprintPure, Category = "Breachline|Enemy")
	UWeaponComponent* GetWeapon() const { return Weapon; }

	UFUNCTION(BlueprintPure, Category = "Breachline|Enemy")
	FBreachlineWeaponDef GetWeaponDef() const;

	UFUNCTION(BlueprintPure, Category = "Breachline|Enemy")
	FEnemyArchetypeDef GetArchetype() const { return Archetype; }

	UFUNCTION(BlueprintPure, Category = "Breachline|Enemy")
	FName GetArchetypeId() const { return Archetype.Id; }

	/** Difficulty scaling from the current round. */
	UFUNCTION(BlueprintPure, Category = "Breachline|Enemy")
	float GetAccuracyMult() const { return AccuracyMult; }

	UFUNCTION(BlueprintPure, Category = "Breachline|Enemy")
	float GetAggression() const { return FMath::Clamp(Archetype.Aggression * AggressionMult, 0.f, 1.f); }

	UFUNCTION(BlueprintPure, Category = "Breachline|Enemy")
	float GetPreferredMin() const { return Archetype.PreferredMin; }

	UFUNCTION(BlueprintPure, Category = "Breachline|Enemy")
	float GetPreferredMax() const { return Archetype.PreferredMax; }

	/** Score awarded for killing this enemy. */
	UFUNCTION(BlueprintPure, Category = "Breachline|Enemy")
	int32 GetScoreValue() const { return Archetype.ScoreValue; }

	/** True while the weapon has a round ready to fire. */
	UFUNCTION(BlueprintPure, Category = "Breachline|Enemy")
	bool CanFireNow() const;

	/** Applies the archetype tint/scale to whatever mesh the class happens to have. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Enemy")
	void ApplyArchetypeVisuals();

	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Enemy")
	FEnemyArchetypeDef Archetype;

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Breachline|Enemy")
	TObjectPtr<UWeaponComponent> Weapon;

	/** Runtime material instance so each archetype can be tinted without assets. */
	UPROPERTY(Transient) TObjectPtr<class UMaterialInstanceDynamic> TintMaterial = nullptr;

	float AccuracyMult = 1.f;
	float AggressionMult = 1.f;
};
