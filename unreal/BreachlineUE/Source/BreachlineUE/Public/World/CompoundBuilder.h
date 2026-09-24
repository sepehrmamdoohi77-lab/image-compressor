// Copyright (c) Breachline UE. All rights reserved.
//
// Runtime compound generator. The authored level (Content/Python/breachline_level.py)
// is the shipping path, but the project must also be playable the second someone
// presses Play in a fresh checkout — so if no compound is present in the level,
// the game mode spawns this actor and the arena builds itself:
//
//   ground + perimeter walls + four buildings + street cover + cover points
//   + lighting/atmosphere + a navmesh bound + player starts.
//
// Same grid, same 4 m cells, same wall heights as the authored level, so the two
// layouts are interchangeable (useful for A/B testing the layout itself).

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "CompoundBuilder.generated.h"

class UInstancedStaticMeshComponent;
class UStaticMesh;

/** One blocked rectangle of the compound, in grid cells. */
USTRUCT()
struct FCompoundBlock
{
	GENERATED_BODY()

	UPROPERTY() int32 X = 0;
	UPROPERTY() int32 Y = 0;
	UPROPERTY() int32 Width = 1;
	UPROPERTY() int32 Depth = 1;
	UPROPERTY() bool bBuildings = false;

	FCompoundBlock() = default;
	FCompoundBlock(int32 InX, int32 InY, int32 InW, int32 InD, bool bInBuilding = false)
		: X(InX), Y(InY), Width(InW), Depth(InD), bBuildings(bInBuilding) {}
};

UCLASS()
class BREACHLINEUE_API ACompoundBuilder : public AActor
{
	GENERATED_BODY()

public:
	ACompoundBuilder();

	/** Builds the whole compound. Safe to call twice (it clears first). */
	UFUNCTION(BlueprintCallable, Category = "Breachline|World")
	void Build();

	/** Layout seed: the same seed always produces the same arena. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|World")
	int32 Seed = 20260925;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|World")
	bool bSpawnLighting = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|World")
	bool bSpawnCoverPoints = true;

	/** Actor tag that tells the game mode a compound already exists. */
	static const FName CompoundTag;

protected:
	void BuildGround();
	void BuildPerimeter();
	void BuildBuildings();
	void BuildStreetCover();
	void SpawnCoverPoint(const FVector& Location, const FVector& FacingAwayFromCover, bool bLowCover);
	void SpawnLighting();
	void SpawnNavigation();
	void SpawnPlayerStart();

	UInstancedStaticMeshComponent* MakeInstanceComponent(const TCHAR* Name, UStaticMesh* Mesh);

	/** Cell index -> world centre on the ground plane. */
	FVector CellToWorld(float CellX, float CellY, float ZMeters = 0.f) const;

	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> Walls = nullptr;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> Floors = nullptr;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> Crates = nullptr;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> Sandbags = nullptr;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> Barrels = nullptr;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> Pillars = nullptr;

	UPROPERTY() TArray<FCompoundBlock> Blocks;
	/** Cells occupied by cover, used to keep spawns and pickups out of them. */
	UPROPERTY() TArray<FVector2D> CoverCells;

	FRandomStream Rng;
	/** Monotonic cover-point index: unique per point, stable for the session. */
	int32 NextCoverIndex = 0;
	bool bBuilt = false;
};
