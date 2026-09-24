// Copyright (c) Breachline UE. All rights reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "HealthKitPickup.generated.h"

class USphereComponent;
class UStaticMeshComponent;
class UPointLightComponent;
class ABreachlinePlayerCharacter;

/**
 * Field medkit. Random spawns, a soft green glow so it is findable in a dark
 * corner, and a heal worth Pickups::HealthFraction of max health (30%).
 *
 * Proximity is a distance check in Tick rather than an overlap event: the pickup
 * radius is small, there are at most two on the map, and a distance test cannot
 * be missed by a fast-moving character with a paused physics sub-stepper.
 */
UCLASS()
class BREACHLINEUE_API AHealthKitPickup : public AActor
{
	GENERATED_BODY()

public:
	AHealthKitPickup();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	/** Seconds this kit stays on the ground before despawning. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Pickup")
	float Lifetime = 34.f;

	/** Fraction of max health restored (0.3 = the authored 30%). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Pickup")
	float HealthFraction = 0.3f;

	UPROPERTY(BlueprintReadOnly, Category = "Breachline|Pickup")
	bool bCollected = false;

protected:
	void Collect(ABreachlinePlayerCharacter* Player);

	UPROPERTY(VisibleAnywhere, Category = "Breachline|Pickup") TObjectPtr<USphereComponent> Collision;
	UPROPERTY(VisibleAnywhere, Category = "Breachline|Pickup") TObjectPtr<UStaticMeshComponent> Body;
	UPROPERTY(VisibleAnywhere, Category = "Breachline|Pickup") TObjectPtr<UStaticMeshComponent> Cross;
	UPROPERTY(VisibleAnywhere, Category = "Breachline|Pickup") TObjectPtr<UPointLightComponent> Glow;

private:
	float SpawnTime = 0.f;
	float DespawnTime = 0.f;
	FVector BaseLocation = FVector::ZeroVector;
};
