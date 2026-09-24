// Copyright (c) Breachline UE. All rights reserved.

#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Core/BreachlineTypes.h"
// ApplyBullet takes an FDamageInput by reference and is a UFUNCTION, so the
// generated code needs that struct's definition, not just its name.
#include "Combat/DamageModel.h"
#include "HealthComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FBreachlineHealthChanged, float, NewHealth, float, Delta, AActor*, Instigator);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FBreachlineDied, AActor*, Victim, AActor*, Killer);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FBreachlineHealed, float, AmountHealed);

/**
 * Health + armor as one component, shared by the player and every hostile so
 * damage rules cannot drift between them. All numbers here are raw; the zone /
 * falloff / armor maths lives in the pure DamageModel, and the multiplier lets
 * Project Settings scale player and enemy toughness independently.
 */
UCLASS(ClassGroup = (Breachline), meta = (BlueprintSpawnableComponent))
class BREACHLINEUE_API UHealthComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UHealthComponent();

	virtual void BeginPlay() override;

	/** Full pipeline: zone, distance falloff and armor. Returns applied HP damage. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Health")
	float ApplyBullet(const FBulletResult& Hit, AActor* Instigator, const FDamageInput& Input);

	/** Flat damage (fall, grenade, scripted). Returns applied HP damage. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Health")
	float ApplyDamage(float Amount, AActor* Instigator);

	/** Restores health without overhealing. Returns HP actually gained. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Health")
	float Heal(float Amount);

	/** Round change: full health, ammo is the weapon manager's job, armor topped up. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Health")
	void Resupply(float HealthFrac = 1.f, float ArmorFloor = 0.f);

	UFUNCTION(BlueprintPure, Category = "Breachline|Health") float GetHealth() const { return Health; }
	UFUNCTION(BlueprintPure, Category = "Breachline|Health") float GetMaxHealth() const { return MaxHealth; }
	UFUNCTION(BlueprintPure, Category = "Breachline|Health") float GetArmor() const { return Armor; }
	UFUNCTION(BlueprintPure, Category = "Breachline|Health") float GetMaxArmor() const { return MaxArmor; }

	/** Explosions go through this so the kill is scored as a grenade kill. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Health")
	float ApplyExplosiveDamage(float Amount, AActor* Instigator);

	UFUNCTION(BlueprintPure, Category = "Breachline|Health") EHitZone GetLastHitZone() const { return LastHitZone; }
	UFUNCTION(BlueprintPure, Category = "Breachline|Health") bool WasLastDamageExplosive() const { return bLastDamageExplosive; }
	UFUNCTION(BlueprintPure, Category = "Breachline|Health") AActor* GetLastDamageInstigator() const { return LastDamageInstigator.Get(); }

	/**
	 * Exactly-once latch for the kill award. Several pellets can land on a corpse
	 * in the same frame (shotguns), so the scorer must claim the kill rather than
	 * testing "is it dead?" — which stays true forever.
	 */
	bool TryClaimKillAward();
	UFUNCTION(BlueprintPure, Category = "Breachline|Health") bool IsDead() const { return bDead; }
	UFUNCTION(BlueprintPure, Category = "Breachline|Health") float GetHealthFraction() const
	{
		return MaxHealth > 0.f ? Health / MaxHealth : 0.f;
	}

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Health") float MaxHealth = 100.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Health") float MaxArmor = 100.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Health") float Armor = 0.f;
	/** Project Settings hook: 1 = authored numbers, <1 = tougher, >1 = squishier. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Health") float DamageTakenMultiplier = 1.f;
	/** Time the corpse stays before despawn, handled by the GameMode. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Health") float CorpseLifetime = 6.f;
	/** God mode for debugging/QA (never enabled by gameplay code). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Health") bool bInvulnerable = false;

	UPROPERTY(BlueprintAssignable, Category = "Breachline|Health") FBreachlineHealthChanged OnHealthChanged;
	UPROPERTY(BlueprintAssignable, Category = "Breachline|Health") FBreachlineDied OnDied;
	UPROPERTY(BlueprintAssignable, Category = "Breachline|Health") FBreachlineHealed OnHealed;

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Breachline|Health") float Health = 100.f;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Breachline|Health") bool bDead = false;
	/** Context of the killing blow, read by the scorer when the victim dies. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Breachline|Health") EHitZone LastHitZone = EHitZone::Torso;
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Breachline|Health") bool bLastDamageExplosive = false;
	UPROPERTY() TWeakObjectPtr<AActor> LastDamageInstigator = nullptr;
	float LastDamageTime = -1000.f;
	bool bKillAwarded = false;
};
