// Copyright (c) Breachline UE. All rights reserved.

#include "Character/BreachlinePlayerCharacter.h"
#include "Character/HealthComponent.h"
#include "Weapons/WeaponManagerComponent.h"
#include "Weapons/WeaponComponent.h"
#include "Combat/BreachlineCombatLibrary.h"
#include "Audio/BreachlineAudioSubsystem.h"
#include "VFX/BreachlineFXSubsystem.h"
#include "Camera/TacticalCameraRig.h"
#include "UI/BreachlinePlayerController.h"
#include "Core/BreachlineBalance.h"
#include "Core/BreachlineSettings.h"
#include "Core/BreachlineGameInstance.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "InputAction.h"
#include "InputMappingContext.h"
#include "InputModifiers.h"
#include "InputActionValue.h"
#include "Engine/World.h"
#include "BreachlineUE.h"

using namespace Breachline;

ABreachlinePlayerCharacter::ABreachlinePlayerCharacter()
{
	PrimaryActorTick.bCanEverTick = true;

	Loadout = CreateDefaultSubobject<UWeaponManagerComponent>(TEXT("Loadout"));

	// The player turns with the cursor, not with movement input: movement stays
	// camera-relative (the classic isometric feel).
	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		Move->bOrientRotationToMovement = false;
	}

	Grenades = Player::Grenades;
}

void ABreachlinePlayerCharacter::BeginPlay()
{
	Super::BeginPlay();

	if (Health)
	{
		// Project Settings can make the operator tougher or squishier without
		// touching code; 1.0 is the authored balance.
		Health->DamageTakenMultiplier = UBreachlineSettings::Get()->PlayerDamageTakenMultiplier;
	}

	if (const UBreachlineSettings* Settings = UBreachlineSettings::Get())
	{
		if (!Settings->MappingContextPath.IsEmpty())
		{
			// A generated IMC asset exists: the controller adds it instead.
			UE_LOG(LogBreachline, Log, TEXT("Using authored input mapping: %s"), *Settings->MappingContextPath);
		}
	}
}

namespace
{
	/**
	 * An authored mapping context (Content/Input/IMC_Breachline + IA_* assets, wired
	 * through UBreachlineSettings) is the source of truth when a designer supplies
	 * one. Actions are matched by asset name, so the C++ bindings below work
	 * unchanged against either the authored assets or the runtime fallbacks.
	 */
	UInputAction* FindAuthoredAction(UInputMappingContext* Context, const TCHAR* Name)
	{
		if (!Context) return nullptr;
		const FName Wanted(Name);
		for (const FEnhancedActionKeyMapping& Mapping : Context->GetMappings())
		{
			if (Mapping.Action && Mapping.Action->GetFName() == Wanted)
			{
				return Mapping.Action;
			}
		}
		return nullptr;
	}

	/**
	 * Adds a key mapping unless the context (usually an authored asset) already has
	 * it. The optional modifiers are what turn four digital keys into a 2D axis.
	 */
	void ApplyKeyMapping(
		UInputMappingContext* Context,
		UInputAction* Action,
		const FKey& Key,
		bool bSwizzleAxis = false,
		bool bNegate = false)
	{
		if (!Context || !Action) return;
		for (const FEnhancedActionKeyMapping& Mapping : Context->GetMappings())
		{
			if (Mapping.Action == Action && Mapping.Key == Key)
			{
				return;
			}
		}

		FEnhancedActionKeyMapping& Added = Context->MapKey(Action, Key);
		if (bSwizzleAxis)
		{
			Added.Modifiers.Add(NewObject<UInputModifierSwizzleAxis>(Context));
		}
		if (bNegate)
		{
			Added.Modifiers.Add(NewObject<UInputModifierNegate>(Context));
		}
	}
}

UInputAction* ABreachlinePlayerCharacter::MakeAction(const FName Key, const TCHAR* Name, bool bValueType)
{
	if (TObjectPtr<UInputAction>* Existing = RuntimeActions.Find(Key))
	{
		return *Existing;
	}
	if (UInputAction* Authored = FindAuthoredAction(RuntimeContext, Name))
	{
		RuntimeActions.Add(Key, Authored);
		return Authored;
	}
	UInputAction* Action = NewObject<UInputAction>(this, Key);
	Action->ValueType = bValueType ? EInputActionValueType::Axis2D : EInputActionValueType::Boolean;
	RuntimeActions.Add(Key, Action);
	(void)Name;
	return Action;
}

UInputAction* ABreachlinePlayerCharacter::MakeAxisAction(const FName Key, const TCHAR* Name)
{
	if (TObjectPtr<UInputAction>* Existing = RuntimeActions.Find(Key))
	{
		return *Existing;
	}
	if (UInputAction* Authored = FindAuthoredAction(RuntimeContext, Name))
	{
		RuntimeActions.Add(Key, Authored);
		return Authored;
	}
	UInputAction* Action = NewObject<UInputAction>(this, Key);
	Action->ValueType = EInputActionValueType::Axis1D;
	RuntimeActions.Add(Key, Action);
	return Action;
}

void ABreachlinePlayerCharacter::BuildDefaultInputMapping(UInputMappingContext* Context)
{
	if (!Context) return;

	// Set before any action is created: MakeAction() consults it to prefer an
	// authored IA_* asset over a runtime one.
	RuntimeContext = Context;

	UInputAction* Move = MakeAction(TEXT("IA_Move"), TEXT("Move"), /*bValueType*/ true);
	UInputAction* Aim = MakeAction(TEXT("IA_Aim"), TEXT("Aim"), true);
	UInputAction* Fire = MakeAction(TEXT("IA_Fire"), TEXT("Fire"), false);
	UInputAction* Precision = MakeAction(TEXT("IA_PrecisionAim"), TEXT("PrecisionAim"), false);
	UInputAction* Sprint = MakeAction(TEXT("IA_Sprint"), TEXT("Sprint"), false);
	UInputAction* Crouch = MakeAction(TEXT("IA_Crouch"), TEXT("Crouch"), false);
	UInputAction* Reload = MakeAction(TEXT("IA_Reload"), TEXT("Reload"), false);
	UInputAction* Grenade = MakeAction(TEXT("IA_Grenade"), TEXT("Grenade"), false);
	UInputAction* Slot1 = MakeAction(TEXT("IA_Weapon1"), TEXT("Weapon1"), false);
	UInputAction* Slot2 = MakeAction(TEXT("IA_Weapon2"), TEXT("Weapon2"), false);
	UInputAction* Slot3 = MakeAction(TEXT("IA_Weapon3"), TEXT("Weapon3"), false);
	UInputAction* Slot4 = MakeAction(TEXT("IA_Weapon4"), TEXT("Weapon4"), false);
	UInputAction* Slot5 = MakeAction(TEXT("IA_Weapon5"), TEXT("Weapon5"), false);
	UInputAction* Cycle = MakeAction(TEXT("IA_CycleWeapon"), TEXT("CycleWeapon"), false);
	UInputAction* CameraRotate = MakeAxisAction(TEXT("IA_CameraRotate"), TEXT("CameraRotate"));
	UInputAction* Zoom = MakeAxisAction(TEXT("IA_Zoom"), TEXT("Zoom"));
	UInputAction* ToggleCursor = MakeAction(TEXT("IA_ToggleCursor"), TEXT("ToggleCursor"), false);

	// 2D movement: WASD with negate/swizzle modifiers, plus the gamepad stick.
	ApplyKeyMapping(Context, Move, EKeys::W, /*bSwizzleAxis*/ true);
	ApplyKeyMapping(Context, Move, EKeys::S, true, /*bNegate*/ true);
	ApplyKeyMapping(Context, Move, EKeys::A, false, true);
	ApplyKeyMapping(Context, Move, EKeys::D);
	ApplyKeyMapping(Context, Move, EKeys::Gamepad_Left2D);

	ApplyKeyMapping(Context, Aim, EKeys::Mouse2D);
	ApplyKeyMapping(Context, Aim, EKeys::Gamepad_Right2D);
	ApplyKeyMapping(Context, Fire, EKeys::LeftMouseButton);
	ApplyKeyMapping(Context, Fire, EKeys::Gamepad_RightTrigger);
	ApplyKeyMapping(Context, Precision, EKeys::RightMouseButton);
	ApplyKeyMapping(Context, Precision, EKeys::Gamepad_LeftTrigger);
	ApplyKeyMapping(Context, Sprint, EKeys::LeftShift);
	ApplyKeyMapping(Context, Sprint, EKeys::Gamepad_LeftShoulder);
	ApplyKeyMapping(Context, Crouch, EKeys::C);
	ApplyKeyMapping(Context, Crouch, EKeys::LeftControl);
	ApplyKeyMapping(Context, Crouch, EKeys::Gamepad_RightThumbstick);
	ApplyKeyMapping(Context, Reload, EKeys::R);
	ApplyKeyMapping(Context, Reload, EKeys::Gamepad_FaceButton_Left);
	ApplyKeyMapping(Context, Grenade, EKeys::G);
	ApplyKeyMapping(Context, Grenade, EKeys::Gamepad_FaceButton_Top);
	ApplyKeyMapping(Context, Slot1, EKeys::One);
	ApplyKeyMapping(Context, Slot2, EKeys::Two);
	ApplyKeyMapping(Context, Slot3, EKeys::Three);
	ApplyKeyMapping(Context, Slot4, EKeys::Four);
	ApplyKeyMapping(Context, Slot5, EKeys::Five);
	ApplyKeyMapping(Context, Cycle, EKeys::Tab);
	ApplyKeyMapping(Context, Cycle, EKeys::Gamepad_DPad_Right);

	// Camera: Q/E orbit the isometric rig (E positive = clockwise), the wheel and
	// gamepad shoulders pull the rig in and out.
	ApplyKeyMapping(Context, CameraRotate, EKeys::Q, false, /*bNegate*/ true);
	ApplyKeyMapping(Context, CameraRotate, EKeys::E);
	ApplyKeyMapping(Context, CameraRotate, EKeys::Gamepad_RightX);
	ApplyKeyMapping(Context, Zoom, EKeys::MouseWheelAxis);
	ApplyKeyMapping(Context, Zoom, EKeys::Gamepad_LeftShoulder);
	ApplyKeyMapping(Context, Zoom, EKeys::Gamepad_RightShoulder);
	ApplyKeyMapping(Context, ToggleCursor, EKeys::Escape);

}

void ABreachlinePlayerCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	// The controller owns the mapping context (it exists before the pawn).
	ABreachlinePlayerController* PC = Cast<ABreachlinePlayerController>(GetController());
	UInputMappingContext* Context = PC ? PC->GetInputContext() : nullptr;
	if (!Context) return;

	UEnhancedInputComponent* Input = Cast<UEnhancedInputComponent>(PlayerInputComponent);
	if (!Input) return;

	// Guarantees every binding below refers to an object the context also maps, and
	// it is a no-op when the authored assets are in use.
	BuildDefaultInputMapping(Context);

	Input->BindAction(MakeAction(TEXT("IA_Move"), TEXT("Move"), true), ETriggerEvent::Triggered, this, &ABreachlinePlayerCharacter::OnMove);
	Input->BindAction(MakeAction(TEXT("IA_Aim"), TEXT("Aim"), true), ETriggerEvent::Triggered, this, &ABreachlinePlayerCharacter::OnAimWorld);
	Input->BindAction(MakeAction(TEXT("IA_Fire"), TEXT("Fire"), false), ETriggerEvent::Started, this, &ABreachlinePlayerCharacter::OnFireStart);
	Input->BindAction(MakeAction(TEXT("IA_Fire"), TEXT("Fire"), false), ETriggerEvent::Completed, this, &ABreachlinePlayerCharacter::OnFireStop);
	Input->BindAction(MakeAction(TEXT("IA_Fire"), TEXT("Fire"), false), ETriggerEvent::Triggered, this, &ABreachlinePlayerCharacter::OnFireStart);
	Input->BindAction(MakeAction(TEXT("IA_PrecisionAim"), TEXT("PrecisionAim"), false), ETriggerEvent::Started, this, &ABreachlinePlayerCharacter::OnPrecisionAimStart);
	Input->BindAction(MakeAction(TEXT("IA_PrecisionAim"), TEXT("PrecisionAim"), false), ETriggerEvent::Completed, this, &ABreachlinePlayerCharacter::OnPrecisionAimStop);
	Input->BindAction(MakeAction(TEXT("IA_Sprint"), TEXT("Sprint"), false), ETriggerEvent::Started, this, &ABreachlinePlayerCharacter::OnSprintStart);
	Input->BindAction(MakeAction(TEXT("IA_Sprint"), TEXT("Sprint"), false), ETriggerEvent::Completed, this, &ABreachlinePlayerCharacter::OnSprintStop);
	Input->BindAction(MakeAction(TEXT("IA_Crouch"), TEXT("Crouch"), false), ETriggerEvent::Started, this, &ABreachlinePlayerCharacter::OnCrouchToggle);
	Input->BindAction(MakeAction(TEXT("IA_Reload"), TEXT("Reload"), false), ETriggerEvent::Started, this, &ABreachlinePlayerCharacter::OnReload);
	Input->BindAction(MakeAction(TEXT("IA_Grenade"), TEXT("Grenade"), false), ETriggerEvent::Started, this, &ABreachlinePlayerCharacter::OnGrenade);
	Input->BindAction(MakeAction(TEXT("IA_Weapon1"), TEXT("Weapon1"), false), ETriggerEvent::Started, this, &ABreachlinePlayerCharacter::OnWeaponSlot1);
	Input->BindAction(MakeAction(TEXT("IA_Weapon2"), TEXT("Weapon2"), false), ETriggerEvent::Started, this, &ABreachlinePlayerCharacter::OnWeaponSlot2);
	Input->BindAction(MakeAction(TEXT("IA_Weapon3"), TEXT("Weapon3"), false), ETriggerEvent::Started, this, &ABreachlinePlayerCharacter::OnWeaponSlot3);
	Input->BindAction(MakeAction(TEXT("IA_Weapon4"), TEXT("Weapon4"), false), ETriggerEvent::Started, this, &ABreachlinePlayerCharacter::OnWeaponSlot4);
	Input->BindAction(MakeAction(TEXT("IA_Weapon5"), TEXT("Weapon5"), false), ETriggerEvent::Started, this, &ABreachlinePlayerCharacter::OnWeaponSlot5);
	Input->BindAction(MakeAction(TEXT("IA_CycleWeapon"), TEXT("CycleWeapon"), false), ETriggerEvent::Started, this, &ABreachlinePlayerCharacter::OnCycleWeapon);
	Input->BindAction(MakeAxisAction(TEXT("IA_CameraRotate"), TEXT("CameraRotate")), ETriggerEvent::Triggered, this, &ABreachlinePlayerCharacter::OnCameraRotate);
	Input->BindAction(MakeAxisAction(TEXT("IA_Zoom"), TEXT("Zoom")), ETriggerEvent::Triggered, this, &ABreachlinePlayerCharacter::OnZoom);
	Input->BindAction(MakeAction(TEXT("IA_ToggleCursor"), TEXT("ToggleCursor"), false), ETriggerEvent::Started, this, &ABreachlinePlayerCharacter::OnToggleCursor);
}

void ABreachlinePlayerCharacter::OnMove(const FInputActionValue& Value)
{
	if (!IsAlive()) return;

	const FVector2D Axis = Value.Get<FVector2D>();
	if (Axis.IsNearlyZero()) return;

	// Camera-relative movement: screen-up is away from the camera on the ground.
	const ABreachlinePlayerController* PC = Cast<ABreachlinePlayerController>(GetController());
	const float AzimuthDeg = PC && PC->GetRig() ? PC->GetRig()->GetAzimuthDegrees() : Camera::AzimuthDeg;
	const FRotator Basis(0.f, AzimuthDeg, 0.f);
	const FVector Forward = FRotationMatrix(Basis).GetUnitAxis(EAxis::X);
	const FVector Right = FRotationMatrix(Basis).GetUnitAxis(EAxis::Y);

	AddMovementInput(Forward, Axis.Y);
	AddMovementInput(Right, Axis.X);
}

void ABreachlinePlayerCharacter::OnAimWorld(const FInputActionValue& Value)
{
	// Cursor aim is resolved by the controller (needs the viewport).
	const ABreachlinePlayerController* PC = Cast<ABreachlinePlayerController>(GetController());
	if (!PC) return;

	AimPointWorld = PC->GetAimPointWorld();
	SetAimDirection(AimPointWorld - GetActorLocation());
}

void ABreachlinePlayerCharacter::OnFireStart(const FInputActionValue& Value)
{
	(void)Value;
	bFiring = true;
	if (IsAlive())
	{
		FireOnce();
	}
}

void ABreachlinePlayerCharacter::OnFireStop(const FInputActionValue& Value)
{
	(void)Value;
	bFiring = false;
}

void ABreachlinePlayerCharacter::OnPrecisionAimStart(const FInputActionValue& Value)
{
	(void)Value;
	bPrecisionAim = true;
	UpdateSprintState();
	if (UWeaponComponent* Weapon = Loadout ? Loadout->GetActiveWeapon() : nullptr)
	{
		Weapon->SetAiming(true);
	}
}

void ABreachlinePlayerCharacter::OnPrecisionAimStop(const FInputActionValue& Value)
{
	(void)Value;
	bPrecisionAim = false;
	if (UWeaponComponent* Weapon = Loadout ? Loadout->GetActiveWeapon() : nullptr)
	{
		Weapon->SetAiming(false);
	}
}

void ABreachlinePlayerCharacter::OnSprintStart(const FInputActionValue& Value)
{
	(void)Value;
	bSprintHeld = true;
	UpdateSprintState();
}

void ABreachlinePlayerCharacter::OnSprintStop(const FInputActionValue& Value)
{
	(void)Value;
	bSprintHeld = false;
	UpdateSprintState();
}

void ABreachlinePlayerCharacter::OnCrouchToggle(const FInputActionValue& Value)
{
	(void)Value;
	if (!IsAlive()) return;
	if (bIsCrouched)
	{
		UnCrouch();
	}
	else
	{
		Crouch();
	}
}

void ABreachlinePlayerCharacter::OnReload(const FInputActionValue& Value)
{
	(void)Value;
	if (Loadout)
	{
		if (UWeaponComponent* Weapon = Loadout->GetActiveWeapon())
		{
			Weapon->StartReload();
		}
	}
}

void ABreachlinePlayerCharacter::OnGrenade(const FInputActionValue& Value)
{
	(void)Value;
	ThrowGrenade();
}

void ABreachlinePlayerCharacter::OnWeaponSlot1(const FInputActionValue& Value) { (void)Value; if (Loadout) Loadout->EquipSlot(EWeaponSlotId::Rifle); }
void ABreachlinePlayerCharacter::OnWeaponSlot2(const FInputActionValue& Value) { (void)Value; if (Loadout) Loadout->EquipSlot(EWeaponSlotId::SMG); }
void ABreachlinePlayerCharacter::OnWeaponSlot3(const FInputActionValue& Value) { (void)Value; if (Loadout) Loadout->EquipSlot(EWeaponSlotId::Shotgun); }
void ABreachlinePlayerCharacter::OnWeaponSlot4(const FInputActionValue& Value) { (void)Value; if (Loadout) Loadout->EquipSlot(EWeaponSlotId::DMR); }
void ABreachlinePlayerCharacter::OnWeaponSlot5(const FInputActionValue& Value) { (void)Value; if (Loadout) Loadout->EquipSlot(EWeaponSlotId::Pistol); }

void ABreachlinePlayerCharacter::OnCycleWeapon(const FInputActionValue& Value)
{
	if (!Loadout) return;
	Loadout->CycleWeapon(1);
}

void ABreachlinePlayerCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (!IsAlive()) return;

	if (UWeaponComponent* Weapon = Loadout ? Loadout->GetActiveWeapon() : nullptr)
	{
		Weapon->SetMoving(GetVelocity().Size2D() > MetersToUU(0.6f));
		Weapon->SetCrouched(bIsCrouched);
	}

	// Automatic fire keeps pulling the trigger while held.
	if (bFiring && Weapon && Weapon->GetDefinition().FireMode == EFireMode::Auto)
	{
		FireOnce();
	}

	// Footsteps: cadence from actual speed, sprint is louder and slower-paced.
	const float Speed = GetVelocity().Size2D();
	if (Speed > MetersToUU(0.5f))
	{
		FootstepAccumulator += DeltaSeconds * (Speed / MetersToUU(1.f));
		if (FootstepAccumulator > 2.2f)
		{
			FootstepAccumulator = 0.f;
			if (UWorld* World = GetWorld())
			{
				if (UBreachlineAudioSubsystem* Audio = World->GetSubsystem<UBreachlineAudioSubsystem>())
				{
					Audio->PlayFootstep(this, bSprinting);
				}
			}
		}
	}
	else
	{
		FootstepAccumulator = 0.f;
	}
}

void ABreachlinePlayerCharacter::FireOnce()
{
	UWeaponComponent* Weapon = Loadout ? Loadout->GetActiveWeapon() : nullptr;
	if (!Weapon || bSprinting) return; // sprinting = weapon down, cannot fire

	// Spread dir comes from the aim point; the muzzle is the ground truth for FX.
	const FVector Muzzle = GetMuzzleLocation();
	const FVector Dir = (AimPointWorld - Muzzle).GetSafeNormal();
	if (Dir.IsNearlyZero()) return;

	// Recoil is applied inside the combat library when the shot resolves; the
	// pawn only supplies muzzle + aim direction.
	Weapon->TryFire(Muzzle, Dir);
}

void ABreachlinePlayerCharacter::ThrowGrenade()
{
	UWorld* World = GetWorld();
	if (!World || Grenades <= 0 || !IsAlive()) return;

	const float Now = World->GetTimeSeconds();
	if (Now - LastGrenadeTime < 0.6f) return;
	LastGrenadeTime = Now;
	Grenades--;

	// Ballistic throw toward the aim point: solved here so the arc is readable.
	const FVector Start = GetActorLocation() + FVector(0.f, 0.f, MetersToUU(1.4f));
	const FVector Target = AimPointWorld;
	const FVector ToTarget = Target - Start;
	const float DistanceM = ToTarget.Size() / MetersToUU(1.f);
	const FVector Flat = FVector(ToTarget.X, ToTarget.Y, 0.f).GetSafeNormal();

	// 45-degree-ish arc: speed scales with range so short throws stay short.
	const float Speed = FMath::Clamp(FMath::Sqrt(FMath::Max(4.f, DistanceM) * 9.8f) * MetersToUU(0.62f),
		MetersToUU(6.f), MetersToUU(16.f));
	const FVector Velocity = Flat * Speed + FVector(0.f, 0.f, Speed * 0.55f);

	FActorSpawnParameters Params;
	Params.Instigator = this;
	Params.Owner = this;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;

	if (ABreachlineGrenade* Grenade = World->SpawnActor<ABreachlineGrenade>(
		ABreachlineGrenade::StaticClass(), Start, Velocity.Rotation(), Params))
	{
		Grenade->Launch(Velocity, this, Damage::GrenadeRadiusM, Damage::GrenadeDamage);
	}
}

void ABreachlinePlayerCharacter::UpdateSprintState()
{
	const bool bWantSprint = bSprintHeld && !bPrecisionAim && !bIsCrouched
		&& GetVelocity().Size2D() > MetersToUU(0.5f);

	if (bWantSprint == bSprinting) return;

	bSprinting = bWantSprint;
	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		Move->MaxWalkSpeed = MetersToUU(bSprinting
			? Player::WalkSpeedMps * Player::SprintMultiplier
			: Player::WalkSpeedMps);
		Move->MaxAcceleration = MetersToUU(Player::Accel * (bSprinting ? Player::SprintAccelBonus : 1.f) * 0.4f);
	}
	OnSprintChanged.Broadcast(bSprinting);
}

float ABreachlinePlayerCharacter::GetNoiseRadiusMeters() const
{
	if (GetVelocity().Size2D() <= MetersToUU(0.5f)) return 0.f;
	return bSprinting ? Player::NoiseRadiusSprintM : Player::NoiseRadiusWalkM;
}

void ABreachlinePlayerCharacter::Resupply()
{
	if (Health)
	{
		// Full health, armor raised to at least the starting load plus the
		// per-round resupply (identical maths to the web build's resupply()).
		Health->Resupply(1.f, FMath::Min(Health->MaxArmor, Player::StartArmor + Player::ResupplyArmor));
	}
	if (Loadout)
	{
		Loadout->ResupplyAll();
	}
	Grenades = Player::Grenades;
	bSprinting = false;
	UpdateSprintState();
}

float ABreachlinePlayerCharacter::ApplyMedkit(float Amount)
{
	if (!Health) return 0.f;

	const float Gained = Health->Heal(Amount);
	if (Gained > 0.f)
	{
		OnMedkitPicked.Broadcast(Gained, ++MedkitsUsed);
	}
	return Gained;
}

void ABreachlinePlayerCharacter::AddGrenade(int32 Count)
{
	Grenades = FMath::Clamp(Grenades + Count, 0, Player::MaxGrenades);
}

void ABreachlinePlayerCharacter::OnCameraRotate(const FInputActionValue& Value)
{
	if (ABreachlinePlayerController* PC = Cast<ABreachlinePlayerController>(GetController()))
	{
		// 90°/s feels like a tactical camera, not a mouse-look.
		PC->RotateCamera(Value.Get<float>() * 90.f * GetWorld()->GetDeltaSeconds());
	}
}

void ABreachlinePlayerCharacter::OnZoom(const FInputActionValue& Value)
{
	if (ABreachlinePlayerController* PC = Cast<ABreachlinePlayerController>(GetController()))
	{
		PC->ZoomCamera(Value.Get<float>() * 1.6f);
	}
}

void ABreachlinePlayerCharacter::OnToggleCursor(const FInputActionValue& Value)
{
	if (ABreachlinePlayerController* PC = Cast<ABreachlinePlayerController>(GetController()))
	{
		PC->ToggleCursorMode();
	}
}
