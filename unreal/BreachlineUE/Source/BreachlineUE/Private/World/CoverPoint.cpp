// Copyright (c) Breachline UE. All rights reserved.

#include "World/CoverPoint.h"
#include "Components/BillboardComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/Texture2D.h"
#include "UObject/ConstructorHelpers.h"

ACoverPoint::ACoverPoint()
{
	PrimaryActorTick.bCanEverTick = false;

	USceneComponent* Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);

	Sprite = CreateDefaultSubobject<UBillboardComponent>(TEXT("Sprite"));
	Sprite->SetupAttachment(Root);
	Sprite->SetHiddenInGame(true);
	Sprite->bIsScreenSizeScaled = true;
	Sprite->SetRelativeScale3D(FVector(0.6f));

	// A small editor-only visual: cover points are level-designer data, not art.
	if (UTexture2D* Icon = LoadObject<UTexture2D>(nullptr,
		TEXT("/Engine/EditorResources/S_Note.S_Note")))
	{
		Sprite->Sprite = Icon;
	}
}

#if WITH_EDITOR
void ACoverPoint::OnConstruction(const FTransform& Transform)
{
	Super::OnConstruction(Transform);
	// Keep the billboard readable but never bigger than the cell it marks.
	Sprite->SetRelativeScale3D(FVector(0.6f));
}
#endif
