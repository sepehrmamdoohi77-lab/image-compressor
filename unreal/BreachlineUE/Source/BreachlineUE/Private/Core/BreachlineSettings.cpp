// Copyright (c) Breachline UE. All rights reserved.

#include "Core/BreachlineSettings.h"
#include "Engine/DataTable.h"
#include "UObject/ConstructorHelpers.h"

UBreachlineSettings::UBreachlineSettings()
{
	CategoryName = TEXT("Game");
	SectionName = TEXT("Breachline");
}

const UBreachlineSettings* UBreachlineSettings::Get()
{
	return GetDefault<UBreachlineSettings>();
}

UDataTable* UBreachlineSettings::ResolveWeaponTable() const
{
	if (!WeaponTable.IsNull())
	{
		return WeaponTable.LoadSynchronous();
	}
	return WeaponTablePath.IsEmpty() ? nullptr : LoadObject<UDataTable>(nullptr, *WeaponTablePath);
}

UDataTable* UBreachlineSettings::ResolveEnemyTable() const
{
	if (!EnemyTable.IsNull())
	{
		return EnemyTable.LoadSynchronous();
	}
	return EnemyTablePath.IsEmpty() ? nullptr : LoadObject<UDataTable>(nullptr, *EnemyTablePath);
}

UDataTable* UBreachlineSettings::ResolveRoundTable() const
{
	if (!RoundTable.IsNull())
	{
		return RoundTable.LoadSynchronous();
	}
	return RoundTablePath.IsEmpty() ? nullptr : LoadObject<UDataTable>(nullptr, *RoundTablePath);
}
