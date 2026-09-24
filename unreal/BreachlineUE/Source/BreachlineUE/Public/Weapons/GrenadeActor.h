// Copyright (c) Breachline UE. All rights reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GrenadeActor.generated.h"

class UStaticMeshComponent;
class UPointLightComponent;
class UProjectileMovementComponent;
class USphereComponent;

/**
 * Frag grenade: ballistic throw, bounces off geometry, blinks faster as the fuse
 * runs out, then applies a LOS-gated radial explosion through the combat library
 * (so grenade damage obeys exactly the same rules as bullets).
 */
UCLASS()
class BREACHLINEUE_API ABreachlineGrenade : public AActor
{
	GENERATED_BODY()

public:
	ABreachlineGrenade();

	virtual void Tick(float DeltaSeconds) override;

	/** Thrower is excluded from the explosion; radius/damage come from balance. */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Grenade")
	void Launch(const FVector& Velocity, AActor* Thrower, float RadiusMeters, float Damage);

	UFUNCTION(BlueprintPure, Category = "Breachline|Grenade")
	bool HasExploded() const { return bExploded; }

protected:
	virtual void BeginPlay() override;
	void Explode();
	void UpdateBlink();

	UPROPERTY(VisibleAnywhere, Category = "Breachline|Grenade") TObjectPtr<USphereComponent> Collision;
	UPROPERTY(VisibleAnywhere, Category = "Breachline|Grenade") TObjectPtr<UStaticMeshComponent> Body;
	UPROPERTY(VisibleAnywhere, Category = "Breachline|Grenade") TObjectPtr<UPointLightComponent> Blink;
	UPROPERTY(VisibleAnywhere, Category = "Breachline|Grenade") TObjectPtr<UProjectileMovementComponent> Movement;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Grenade") float FuseSeconds = 2.1f;

private:
	float ThrowTime = 0.f;
	float RadiusMeters = 5.5f;
	float Damage = 110.f;
	bool bExploded = false;
	UPROPERTY() TObjectPtr<AActor> ThrowerActor = nullptr;
	TArray<TWeakObjectPtr<AActor>> IgnoreActors;
};
