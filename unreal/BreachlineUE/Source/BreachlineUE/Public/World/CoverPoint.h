// Copyright (c) Breachline UE. All rights reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "CoverPoint.generated.h"

class ABreachlineEnemyCharacter;
class UBillboardComponent;

/**
 * One usable fighting position. Placed by the level generator one cell out from
 * every cover piece (or by hand in a hand-built level), oriented so the actor's
 * forward vector points AWAY from the obstacle — i.e. toward the open ground a
 * threat would come from. The AI scores points against that normal, which is how
 * "is the wall actually between us?" is answered without any raycasts.
 */
UCLASS()
class BREACHLINEUE_API ACoverPoint : public AActor
{
	GENERATED_BODY()

public:
	ACoverPoint();

	/** Stable index into the level's cover array (used for cooldowns/claims). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Cover")
	int32 CoverIndex = INDEX_NONE;

	/** Low cover is shoot-over-able (crates, sandbags); high cover blocks fully. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|Cover")
	bool bLowCover = false;

	/**
	 * Which enemy is using this point right now. Weak (cleared on death/leave) so a
	 * corpse can never hold a position, and C++-only because UHT rejects weak
	 * pointers on Blueprint-exposed properties.
	 */
	UPROPERTY()
	TWeakObjectPtr<ABreachlineEnemyCharacter> Occupant;

	/** World time this point was last vacated: drives the re-use cooldown. */
	UPROPERTY(BlueprintReadWrite, Category = "Breachline|Cover")
	float LastUsedTime = 0.f;

	/** Draws the normal in the editor viewport so level art can sanity-check it. */
	UPROPERTY(VisibleAnywhere, Category = "Breachline|Cover")
	TObjectPtr<UBillboardComponent> Sprite = nullptr;

#if WITH_EDITOR
	virtual void OnConstruction(const FTransform& Transform) override;
#endif
};
