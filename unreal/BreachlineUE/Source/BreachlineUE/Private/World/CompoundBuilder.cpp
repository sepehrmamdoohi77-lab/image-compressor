// Copyright (c) Breachline UE. All rights reserved.

#include "World/CompoundBuilder.h"
#include "World/CoverPoint.h"
#include "Core/BreachlineBalance.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Engine/DirectionalLight.h"
#include "Engine/PointLight.h"
#include "Engine/SkyLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/PostProcessVolume.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "GameFramework/PlayerStart.h"
#include "NavMesh/NavMeshBoundsVolume.h"
#include "NavigationSystem.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "BreachlineUE.h"

using namespace Breachline;

const FName ACompoundBuilder::CompoundTag(TEXT("BreachlineCompound"));

ACompoundBuilder::ACompoundBuilder()
{
	PrimaryActorTick.bCanEverTick = false;

	USceneComponent* Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);
	Tags.Add(CompoundTag);
}

UInstancedStaticMeshComponent* ACompoundBuilder::MakeInstanceComponent(const TCHAR* Name, UStaticMesh* Mesh)
{
	UInstancedStaticMeshComponent* Component = NewObject<UInstancedStaticMeshComponent>(this, Name);
	Component->SetupAttachment(RootComponent);
	Component->RegisterComponent();
	Component->SetStaticMesh(Mesh);
	Component->SetMobility(EComponentMobility::Static);
	Component->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
	Component->SetCollisionProfileName(TEXT("BlockAll"));
	Component->SetCastShadow(true);
	// Nanite handles the runtime-built compound without a single LOD authoring
	// step; instancing keeps the draw calls flat regardless of piece count.
	return Component;
}

FVector ACompoundBuilder::CellToWorld(float CellX, float CellY, float ZMeters) const
{
	// The compound is centred on the world origin: cell (SIZE/2, SIZE/2) is (0,0).
	const float Half = World::SizeCells * 0.5f;
	const float CellUU = World::CellUU;
	return FVector((CellX - Half + 0.5f) * CellUU, (CellY - Half + 0.5f) * CellUU, MetersToUU(ZMeters));
}

void ACompoundBuilder::Build()
{
	if (bBuilt) return;
	bBuilt = true;
	Rng.Initialize(Seed);

	UStaticMesh* Cube = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
	UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	if (!Cube)
	{
		UE_LOG(LogBreachline, Error, TEXT("CompoundBuilder: /Engine/BasicShapes/Cube is missing; no geometry built."));
		return;
	}

	Walls = MakeInstanceComponent(TEXT("Walls"), Cube);
	Floors = MakeInstanceComponent(TEXT("Floors"), Cube);
	Crates = MakeInstanceComponent(TEXT("Crates"), Cube);
	Sandbags = MakeInstanceComponent(TEXT("Sandbags"), Cube);
	Pillars = MakeInstanceComponent(TEXT("Pillars"), Cylinder ? Cylinder : Cube);
	Barrels = MakeInstanceComponent(TEXT("Barrels"), Cylinder ? Cylinder : Cube);

	BuildGround();
	BuildPerimeter();
	BuildBuildings();
	BuildStreetCover();

	if (bSpawnLighting) SpawnLighting();
	SpawnNavigation();
	SpawnPlayerStart();

	UE_LOG(LogBreachline, Log, TEXT("Compound built at runtime: %d wall pieces, seed %d."),
		Walls ? Walls->GetInstanceCount() : 0, Seed);
}

void ACompoundBuilder::BuildGround()
{
	// One slab for the whole arena plus a slightly raised street grid: the two
	// tone difference is what reads as "road" from the isometric camera.
	const float Size = World::SizeCells * World::CellMeters;

	// Scale the unit cube into a slab: the engine cube is 1 m before scaling, so
	// the scale IS the size in metres.
	FTransform Slab;
	Slab.SetScale3D(FVector(Size, Size, World::GroundThicknessM));
	Slab.SetTranslation(FVector(0.f, 0.f, -MetersToUU(World::GroundThicknessM * 0.5f)));
	Floors->AddInstance(Slab);

	// Street strips: 2 cells wide, they break the ground into blocks and double
	// as readable lanes for the AI to flank along.
	for (int32 i = 0; i < World::SizeCells; i += 11)
	{
		FTransform Street;
		Street.SetScale3D(FVector(World::SizeCells * World::CellMeters, World::CellMeters, World::GroundThicknessM * 0.6f));
		Street.SetTranslation(CellToWorld(World::SizeCells * 0.5f, i + 1.f, World::GroundThicknessM * 0.3f));
		Floors->AddInstance(Street);

		FTransform Cross;
		Cross.SetScale3D(FVector(World::CellMeters, World::SizeCells * World::CellMeters, World::GroundThicknessM * 0.6f));
		Cross.SetTranslation(CellToWorld(i + 1.f, World::SizeCells * 0.5f, World::GroundThicknessM * 0.3f));
		Floors->AddInstance(Cross);
	}
}

void ACompoundBuilder::BuildPerimeter()
{
	// Perimeter wall with four gates (one per side, mid-span). Gates are the
	// reason the arena is not a box: a squad can leave and re-enter elsewhere.
	const float WallScaleZ = World::WallHeightM;
	const float Thickness = 0.6f;
	const int32 Gate = World::SizeCells / 2;
	const int32 GateHalfWidth = 2;

	// Scales below are in CELLS; the unit cube is 1 m, so they are multiplied by
	// the cell size (4 m) as they are written into the transform. Without that
	// factor a "1 cell" wall piece is a 1 m post with 3 m of open ground either
	// side, which is exactly what the first playtest looked like.
	auto AddWallPiece = [this](int32 CellX, int32 CellY, float ScaleX, float ScaleY, float HeightM)
	{
		FTransform Piece;
		Piece.SetScale3D(FVector(ScaleX * World::CellMeters, ScaleY * World::CellMeters, HeightM));
		Piece.SetTranslation(CellToWorld(CellX + 0.5f, CellY + 0.5f, HeightM * 0.5f));
		Walls->AddInstance(Piece);
	};

	for (int32 i = 0; i < World::SizeCells; ++i)
	{
		const bool bGate = FMath::Abs(i - Gate) <= GateHalfWidth;
		if (!bGate)
		{
			AddWallPiece(i, 0, 1.f, Thickness, WallScaleZ);                          // south
			AddWallPiece(i, World::SizeCells - 1, 1.f, Thickness, WallScaleZ);        // north
			AddWallPiece(0, i, Thickness, 1.f, WallScaleZ);                          // west
			AddWallPiece(World::SizeCells - 1, i, Thickness, 1.f, WallScaleZ);        // east
		}
		else
		{
			// Gate lintel: a low wall segment that can be shot over but not walked
			// through at ground level, marking the entrance without sealing it.
			AddWallPiece(i, 0, 1.f, Thickness, World::LowCoverHeightM);
			AddWallPiece(i, World::SizeCells - 1, 1.f, Thickness, World::LowCoverHeightM);
			AddWallPiece(0, i, Thickness, 1.f, World::LowCoverHeightM);
			AddWallPiece(World::SizeCells - 1, i, Thickness, 1.f, World::LowCoverHeightM);
		}
	}
}

void ACompoundBuilder::BuildBuildings()
{
	// Four structures, hand-placed in grid space: two long workshops, two square
	// yards. Between them they create the sight-line rhythm the game needs —
	// long street, tight corner, long street.
	Blocks = {
		FCompoundBlock(5, 5, 11, 8, true),
		FCompoundBlock(27, 6, 12, 9, true),
		FCompoundBlock(7, 29, 9, 10, true),
		FCompoundBlock(26, 28, 11, 11, true)
	};

	for (const FCompoundBlock& Block : Blocks)
	{
		const float Height = World::BuildingHeightM;

		// Floor slab (slightly raised) so interiors read as rooms, not voids.
		{
			FTransform Slab;
			Slab.SetScale3D(FVector(Block.Width * World::CellMeters, Block.Depth * World::CellMeters, 0.25f));
			Slab.SetTranslation(CellToWorld(Block.X + Block.Width * 0.5f, Block.Y + Block.Depth * 0.5f, 0.12f));
			Walls->AddInstance(Slab);
		}

		for (int32 x = 0; x < Block.Width; ++x)
		{
			for (int32 y = 0; y < Block.Depth; ++y)
			{
				const bool bEdgeX = (x == 0 || x == Block.Width - 1);
				const bool bEdgeY = (y == 0 || y == Block.Depth - 1);
				if (!bEdgeX && !bEdgeY) continue;

				// Two doorways per building, opposite corners: an interior fight
				// always has a way out, and the AI gets two approach axes.
				const bool bDoor = (x == Block.Width / 2 && y == 0)
					|| (x == 0 && y == Block.Depth / 2);
				if (bDoor) continue;

				FTransform Piece;
				const float ScaleX = (bEdgeX ? 0.5f : 1.f) * World::CellMeters;
				const float ScaleY = (bEdgeY ? 0.5f : 1.f) * World::CellMeters;
				Piece.SetScale3D(FVector(ScaleX, ScaleY, Height));
				Piece.SetTranslation(CellToWorld(Block.X + x + 0.5f, Block.Y + y + 0.5f, Height * 0.5f));
				Walls->AddInstance(Piece);
			}
		}

		// Roof beams: visible structure from above, which is most of what the
		// player actually sees of a building in an isometric game.
		for (int32 x = 0; x < Block.Width; x += 2)
		{
			FTransform Beam;
			Beam.SetScale3D(FVector(0.4f, Block.Depth * World::CellMeters, 0.4f));
			Beam.SetTranslation(CellToWorld(Block.X + x + 0.5f, Block.Y + Block.Depth * 0.5f, Height + 0.2f));
			Pillars->AddInstance(Beam);
		}
	}
}

void ACompoundBuilder::BuildStreetCover()
{
	// Cover is placed on a jittered grid along the streets: enough to break every
	// long sight line, never so much that the arena becomes a maze.
	struct FCoverPlan { float X; float Y; bool bLow; int32 Kind; };
	static const FCoverPlan Plan[] = {
		{ 18.f, 4.f, true, 0 }, { 21.f, 9.f, true, 0 }, { 24.f, 3.f, false, 2 },
		{ 18.f, 15.f, false, 1 }, { 23.f, 18.f, true, 0 }, { 17.f, 22.f, true, 0 },
		{ 34.f, 19.f, true, 0 }, { 38.f, 24.f, false, 2 }, { 33.f, 33.f, true, 0 },
		{ 21.f, 26.f, false, 1 }, { 19.f, 33.f, true, 0 }, { 14.f, 39.f, true, 0 },
		{ 36.f, 4.f, true, 0 }, { 39.f, 12.f, false, 2 }, { 4.f, 18.f, true, 0 },
		{ 3.f, 26.f, false, 1 }, { 11.f, 20.f, false, 1 }, { 30.f, 20.f, false, 2 },
		{ 26.f, 40.f, true, 0 }, { 15.f, 12.f, false, 2 }, { 40.f, 37.f, true, 0 },
		{ 5.f, 39.f, true, 0 }, { 12.f, 4.f, false, 1 }, { 29.f, 26.f, false, 2 }
	};

	for (const FCoverPlan& Item : Plan)
	{
		const float JitterX = Rng.FRandRange(-0.6f, 0.6f);
		const float JitterY = Rng.FRandRange(-0.6f, 0.6f);
		const float Rotation = Rng.FRandRange(0.f, 4.f) * 90.f * (Item.Kind == 2 ? 0.f : 1.f);

		FTransform Piece;
		Piece.SetRotation(FQuat(FRotator(0.f, Rotation, 0.f)));
		Piece.SetTranslation(CellToWorld(Item.X + JitterX, Item.Y + JitterY, 0.f));

		if (Item.Kind == 0)
		{
			// Crate stack: low cover you shoot over and vault past.
			Piece.SetScale3D(FVector(1.2f, 1.2f, World::LowCoverHeightM));
			Piece.SetTranslation(Piece.GetTranslation() + FVector(0.f, 0.f, MetersToUU(World::LowCoverHeightM * 0.5f)));
			Crates->AddInstance(Piece);
		}
		else if (Item.Kind == 1)
		{
			// Sandbag line: long, low, the workhorse fighting position.
			Piece.SetScale3D(FVector(2.4f, 0.7f, World::MidCoverHeightM));
			Piece.SetTranslation(Piece.GetTranslation() + FVector(0.f, 0.f, MetersToUU(World::MidCoverHeightM * 0.5f)));
			Sandbags->AddInstance(Piece);
		}
		else
		{
			// Barrel cluster: tall thin cover that also breaks movement.
			for (int32 Barrel = 0; Barrel < 2; ++Barrel)
			{
				FTransform Single = Piece;
				Single.SetScale3D(FVector(0.42f, 0.42f, 0.9f));
				Single.SetTranslation(Piece.GetTranslation()
					+ FVector(Barrel * MetersToUU(0.9f), 0.f, MetersToUU(0.45f)));
				Barrels->AddInstance(Single);
			}
		}

		CoverCells.Add(FVector2D(Item.X, Item.Y));

		if (!bSpawnCoverPoints) continue;

		// A cover point sits 1.5 m off the piece, on the side facing AWAY from it,
		// so the actor's forward vector already means "threat side".
		const float Facing = Rotation + 90.f;
		const FVector Offset = FRotator(0.f, Facing, 0.f).Vector() * MetersToUU(1.5f);
		SpawnCoverPoint(Piece.GetTranslation() + Offset + FVector(0.f, 0.f, -MetersToUU(0.4f)),
			FRotator(0.f, Facing, 0.f).Vector(), Item.bLow);
	}
}

void ACompoundBuilder::SpawnCoverPoint(const FVector& Location, const FVector& FacingAwayFromCover, bool bLowCover)
{
	UWorld* World = GetWorld();
	if (!World) return;

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Params.ObjectFlags |= RF_Transient;

	ACoverPoint* Point = World->SpawnActor<ACoverPoint>(ACoverPoint::StaticClass(), Location,
		FRotator(0.f, FacingAwayFromCover.Rotation().Yaw, 0.f), Params);
	if (!Point) return;

	// Indices must be unique: the AI uses them to claim and cool down positions.
	Point->CoverIndex = NextCoverIndex++;
	Point->bLowCover = bLowCover;
	Point->Tags.Add(TEXT("BreachlineCover"));
}

void ACompoundBuilder::SpawnLighting()
{
	UWorld* World = GetWorld();
	if (!World) return;

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Params.ObjectFlags |= RF_Transient;

	// Dusk urban: a low, warm key light (5°, the "magic hour" angle) so MegaLights
	// and Lumen have something dramatic to work with, plus a cool fill sky.
	if (ADirectionalLight* Sun = World->SpawnActor<ADirectionalLight>(ADirectionalLight::StaticClass(),
		FVector(0.f, 0.f, MetersToUU(60.f)), FRotator(-6.f, 205.f, 0.f), Params))
	{
		if (UDirectionalLightComponent* Component = Cast<UDirectionalLightComponent>(Sun->GetLightComponent()))
		{
			Component->SetIntensity(9.f);
			Component->SetLightColor(FLinearColor(1.f, 0.72f, 0.48f));
			Component->SetCastShadows(true);
			Component->SetDynamicShadowDistanceMovableLight(MetersToUU(120.f));
		}
	}

	if (ASkyLight* Sky = World->SpawnActor<ASkyLight>(ASkyLight::StaticClass(), FVector::ZeroVector, FRotator::ZeroRotator, Params))
	{
		if (USkyLightComponent* Component = Sky->GetLightComponent())
		{
			Component->SetIntensity(1.1f);
			Component->SetLightColor(FLinearColor(0.45f, 0.58f, 0.85f));
			Component->bRealTimeCapture = true; // no bake: matches the Lumen pipeline
		}
	}

	if (AExponentialHeightFog* Fog = World->SpawnActor<AExponentialHeightFog>(AExponentialHeightFog::StaticClass(),
		FVector(0.f, 0.f, -MetersToUU(2.f)), FRotator::ZeroRotator, Params))
	{
		if (UExponentialHeightFogComponent* Component = Fog->GetComponent())
		{
			Component->SetFogDensity(0.018f);
			Component->SetFogHeightFalloff(0.22f);
			Component->SetFogInscatteringColor(FLinearColor(0.42f, 0.48f, 0.62f));
			Component->SetVolumetricFog(true);
			Component->SetVolumetricFogScatteringDistribution(0.35f);
			Component->SetVolumetricFogAlbedo(FColor(180, 195, 220));
		}
	}

	// Post-process: fixed exposure, mild vignette, no motion blur, no chromatic
	// aberration — a tactical picture, not a cinematic one.
	if (APostProcessVolume* Volume = World->SpawnActor<APostProcessVolume>(APostProcessVolume::StaticClass(),
		FVector::ZeroVector, FRotator::ZeroRotator, Params))
	{
		Volume->bUnbound = true;
		Volume->Settings.bOverride_AutoExposureMethod = true;
		Volume->Settings.AutoExposureMethod = EAutoExposureMethod::AEM_Manual;
		Volume->Settings.bOverride_AutoExposureBias = true;
		Volume->Settings.AutoExposureBias = 11.5f;
		Volume->Settings.bOverride_VignetteIntensity = true;
		Volume->Settings.VignetteIntensity = 0.45f;
		Volume->Settings.bOverride_MotionBlurAmount = true;
		Volume->Settings.MotionBlurAmount = 0.f;
		Volume->Settings.bOverride_SceneFringeIntensity = true;
		Volume->Settings.SceneFringeIntensity = 0.f;
		Volume->Settings.bOverride_FilmGrainIntensity = true;
		Volume->Settings.FilmGrainIntensity = 0.12f;
		Volume->Settings.bOverride_ColorSaturation = true;
		Volume->Settings.ColorSaturation = FVector4(1.02f, 1.0f, 0.98f, 1.f);
	}

	// Street lamps: six shadow-casting point lights, which is exactly the load
	// MegaLights is built for (this is the visual reason to enable it).
	static const FVector2D LampCells[] = {
		{ 19.f, 8.f }, { 30.f, 12.f }, { 12.f, 26.f }, { 33.f, 30.f }, { 23.f, 38.f }, { 8.f, 14.f }
	};
	for (const FVector2D& Cell : LampCells)
	{
		const FVector Location = CellToWorld(Cell.X, Cell.Y, 4.2f);
		if (APointLight* Lamp = World->SpawnActor<APointLight>(APointLight::StaticClass(), Location, FRotator::ZeroRotator, Params))
		{
			if (UPointLightComponent* Component = Lamp->GetPointLightComponent())
			{
				Component->SetIntensity(6000.f);
				Component->SetAttenuationRadius(MetersToUU(16.f));
				Component->SetLightColor(FLinearColor(1.f, 0.82f, 0.6f));
				Component->SetCastShadows(true);
			}
		}
	}
}

void ACompoundBuilder::SpawnNavigation()
{
	UWorld* World = GetWorld();
	if (!World) return;

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Params.ObjectFlags |= RF_Transient;

	// Runtime navmesh: a bounds volume covering the arena. The AI needs this to
	// path; a baked navmesh from the authored level supersedes it.
	if (ANavMeshBoundsVolume* Volume = World->SpawnActor<ANavMeshBoundsVolume>(
		ANavMeshBoundsVolume::StaticClass(), FVector::ZeroVector, FRotator::ZeroRotator, Params))
	{
		const float Extent = World::HalfExtentMeters + 6.f;
		Volume->SetActorScale3D(FVector(Extent * 2.f / 200.f, Extent * 2.f / 200.f, 4.f));
		Volume->SetActorLocation(FVector(0.f, 0.f, MetersToUU(2.f)));

		if (UNavigationSystemV1* Nav = FNavigationSystem::GetCurrent<UNavigationSystemV1>(World))
		{
			// Tell the nav system the bounds moved. The actual rebuild is deferred
			// to the game mode's BeginPlay: the compound is generated during
			// InitGame (before the pawn exists), and navmesh generation must not
			// run against a world that is still initialising actors.
			Nav->OnNavigationBoundsUpdated(Volume);
		}
	}
}

void ACompoundBuilder::SpawnPlayerStart()
{
	UWorld* World = GetWorld();
	if (!World) return;

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;

	// South-west street, facing the compound: the player always starts with the
	// arena in front of them and a wall behind them.
	// Z is the capsule centre: half the character height above the slab.
	const FVector Location = CellToWorld(16.f, 20.f, World::CharacterHeightM * 0.5f);
	World->SpawnActor<APlayerStart>(APlayerStart::StaticClass(), Location, FRotator(0.f, 20.f, 0.f), Params);
}
