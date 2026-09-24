#!/usr/bin/env python3
"""check_uht.py — catch the UnrealHeaderTool error classes that stop a first build.

No engine required: this is a static read of the module and it is what the port was
reviewed with before it was ever handed to an editor. Run it from the module folder
(or pass a path):

    python3 unreal/tools/check_uht.py unreal/BreachlineUE/Source/BreachlineUE

Checks
  1. shadowing            a member / UFUNCTION parameter whose name matches (case
                          insensitively) a reflected member of any engine base class
                          -> "as it is already defined in scope 'AActor'"
  2. blueprint structs    a UFUNCTION using a F-struct that is not USTRUCT(BlueprintType)
                          -> "Type 'FX' is not supported by blueprint"
  3. weak pointers        Blueprint-exposed property of a TWeakObjectPtr
                          -> "not supported by blueprint"
  4. AddDynamic targets   bound functions that are not UFUNCTION()
  5. declared/defined     a method declared in a UCLASS/USTRUCT but never defined
  6. generated.h          missing, misnamed, or not the last include
  7. engine includes      a type used in a translation unit with no header in scope

Exit code is non-zero when it finds anything, so it can gate a commit.
"""
import glob
import os
import re
import sys

# ---------------------------------------------------------------- check 1 -----
HIERARCHY = {
    'AActor': None, 'APawn': 'AActor', 'ACharacter': 'APawn',
    'AController': 'AActor', 'APlayerController': 'AController', 'AAIController': 'AController',
    'AHUD': 'AActor', 'AGameModeBase': 'AActor', 'AGameStateBase': 'AActor',
    'UActorComponent': None, 'USynthComponent': 'UActorComponent',
    'USceneComponent': 'UActorComponent', 'UAudioComponent': 'USceneComponent',
    'UWorldSubsystem': 'UObject', 'UGameInstance': 'UObject', 'USaveGame': 'UObject',
    'UDeveloperSettings': 'UObject', 'UBlueprintFunctionLibrary': 'UObject',
    'UObject': None,
}

ENGINE_MEMBERS = """
AActor Owner RootComponent Tags Instigator InputComponent PrimaryActorTick CustomTimeDilation
 InitialLifeSpan LifeSpan bHidden bReplicates bCanBeDamaged bActorEnableCollision
 bActorIsBeingDestroyed Children NetDormancy NetCullDistanceSquared NetPriority
 NetUpdateFrequency MinNetUpdateFrequency RemoteRole Role OnActorBeginOverlap OnActorEndOverlap
 OnTakeAnyDamage OnTakePointDamage OnTakeRadialDamage OnActorHit OnDestroyed OnEndPlay
APawn Controller PlayerState bUseControllerRotationPitch bUseControllerRotationYaw
 bUseControllerRotationRoll bCanBeBaseForCharacter BaseEyeHeight AutoPossessPlayer AutoPossessAI
 AIControllerClass
ACharacter Mesh CharacterMovement CapsuleComponent BasedMovement ReplicatedBasedMovement
 AnimRootMotionTranslationScale bIsCrouched JumpMaxHoldTime JumpMaxCount JumpCurrentCount
 bPressedJump bClientUpdating bClientWasFalling bServerHasBaseComponent
AController ControlRotation bAttachToPawn IgnoreMoveInput IgnoreLookInput OnPossessedPawnChanged
 OnInstigatedAnyDamage StateName
APlayerController Player PlayerCameraManager CheatManager CheatClass MyHUD LastHitResult
 ClickEventKeys DefaultMouseCursor CurrentMouseCursor bShowMouseCursor bEnableClickEvents
 bEnableMouseOverEvents bEnableTouchEvents bEnableTouchOverEvents bEnableMotionControls
 bAutoManageActiveCameraTarget ForceFeedbackScale
AHUD PlayerOwner Canvas DebugCanvas bShowHUD bLostFocusPaused bShowOverlays bShowDebugInfo
 DebugDisplay CurrentTargetIndex PostRenderedActors LastHUDRenderTime RenderDelta
 ShowDebugTargetActor ShowDebugTargetDesiredClass
AAIController BrainComponent Blackboard PerceptionComponent PathFollowingComponent
 bStartAILogicOnPossess bStopAILogicOnUnposses bLOSflag bSkipExtraLOSChecks bAllowStrafe
 bWantsPlayerState
UActorComponent PrimaryComponentTick bAutoActivate bIsActive bEditableWhenInherited
 bCanEverAffectNavigation bNetAddressable ComponentTags AssetUserData OnComponentActivated
 OnComponentDeactivated OnRegister OnUnregister
USynthComponent bIsUISound bAllowSpatialization bAutoDestroy OnSynthEnvelopeValue
UGameInstance OnInputDeviceConnectionChange OnInputDevicePairingChange
""".strip()

# ---------------------------------------------------------------- check 7 -----
TYPE_HEADER = {
    'UStaticMesh': 'Engine/StaticMesh.h', 'UNiagaraSystem': 'NiagaraSystem.h',
    'UNiagaraComponent': 'NiagaraComponent.h',
    'UMaterialInstanceDynamic': 'Materials/MaterialInstanceDynamic.h',
    'UMaterialInterface': 'Materials/MaterialInterface.h',
    'USceneComponent': 'Components/SceneComponent.h',
    'UTexture2D': 'Engine/Texture2D.h',
    'UCharacterMovementComponent': 'GameFramework/CharacterMovementComponent.h',
    'UDataTable': 'Engine/DataTable.h', 'UInputMappingContext': 'InputMappingContext.h',
    'UInputAction': 'InputAction.h', 'UInputModifier': 'InputModifiers.h',
    'UEnhancedInputComponent': 'EnhancedInputComponent.h',
    'UWorld': 'Engine/World.h', 'AActor': 'GameFramework/Actor.h',
    'ANavMeshBoundsVolume': 'NavMesh/NavMeshBoundsVolume.h',
    'APlayerStart': 'GameFramework/PlayerStart.h',
    'UProjectileMovementComponent': 'GameFramework/ProjectileMovementComponent.h',
    'UFont': 'Engine/Font.h', 'UCanvas': 'Engine/Canvas.h',
    'UPointLightComponent': 'Components/PointLightComponent.h',
    'UBillboardComponent': 'Components/BillboardComponent.h',
    'USphereComponent': 'Components/SphereComponent.h',
    'UCapsuleComponent': 'Components/CapsuleComponent.h',
    'USkeletalMeshComponent': 'Components/SkeletalMeshComponent.h',
    'UStaticMeshComponent': 'Components/StaticMeshComponent.h',
    'UInstancedStaticMeshComponent': 'Components/InstancedStaticMeshComponent.h',
    'ADirectionalLight': 'Engine/DirectionalLight.h', 'ASkyLight': 'Engine/SkyLight.h',
    'AExponentialHeightFog': 'Engine/ExponentialHeightFog.h',
    'APostProcessVolume': 'Engine/PostProcessVolume.h',
    'FOverlapResult': 'Engine/OverlapResult.h', 'FHitResult': 'Engine/HitResult.h',
    'UNavigationSystemV1': 'NavigationSystem.h', 'TActorIterator': 'EngineUtils.h',
    'USynthComponent': 'Components/SynthComponent.h', 'UDataAsset': 'Engine/DataAsset.h',
    'UPrimaryDataAsset': 'Engine/DataAsset.h', 'USaveGame': 'GameFramework/SaveGame.h',
    'UDeveloperSettings': 'Engine/DeveloperSettings.h',
    'UWorldSubsystem': 'Subsystems/WorldSubsystem.h',
}

# A type can be declared by more than one header; any of these being in scope is
# enough. Without this the check reports false positives for e.g. AActor.
ALSO_PROVIDED_BY = {
    'AActor': ['GameFramework/Character.h', 'GameFramework/Pawn.h', 'GameFramework/Actor.h',
               'GameFramework/PlayerController.h', 'GameFramework/HUD.h',
               'GameFramework/GameModeBase.h', 'GameFramework/AIController.h',
               'GameFramework/SaveGame.h', 'Components/ActorComponent.h',
               'Components/SceneComponent.h', 'AIController.h', 'Engine/DataAsset.h',
               'Kismet/BlueprintFunctionLibrary.h', 'Subsystems/WorldSubsystem.h',
               'Engine/DeveloperSettings.h', 'GameFramework/ProjectileMovementComponent.h',
               'GameFramework/PlayerStart.h', 'NiagaraComponent.h', 'NiagaraSystem.h'],
    'UWorld': ['Engine/World.h', 'Engine/GameInstance.h', 'Kismet/BlueprintFunctionLibrary.h',
               'Subsystems/WorldSubsystem.h', 'AIController.h', 'GameFramework/Actor.h',
               'GameFramework/Character.h', 'Components/ActorComponent.h'],
    'FHitResult': ['Engine/HitResult.h', 'Engine/EngineTypes.h', 'Engine/World.h',
                   'GameFramework/CharacterMovementComponent.h', 'Kismet/GameplayStatics.h'],
    'FOverlapResult': ['Engine/OverlapResult.h', 'Engine/World.h'],
    'UNiagaraSystem': ['NiagaraSystem.h', 'NiagaraComponent.h', 'NiagaraFunctionLibrary.h'],
    'UNiagaraComponent': ['NiagaraComponent.h', 'NiagaraFunctionLibrary.h'],
    'UDataTable': ['Engine/DataTable.h', 'Engine/DataAsset.h'],
    'USynthComponent': ['Components/SynthComponent.h', 'Components/AudioComponent.h'],
}


def strip_comments(src):
    src = re.sub(r'/\*.*?\*/', ' ', src, flags=re.S)
    src = re.sub(r'//[^\n]*', ' ', src)
    return re.sub(r'"(?:\\.|[^"\\])*"', '""', src)


def body_of(src, cls):
    m = re.search(r'\b(?:class|struct)\s+(?:BREACHLINEUE_API\s+)?' + cls + r'\b[^;{]*\{', src)
    if not m:
        return None
    b, depth = m.end() - 1, 0
    for i in range(b, len(src)):
        if src[i] == '{':
            depth += 1
        elif src[i] == '}':
            depth -= 1
            if depth == 0:
                return src[b:i]
    return None


def engine_member_sets():
    out, key = {}, None
    for line in ENGINE_MEMBERS.split('\n'):
        parts = line.split()
        if parts and parts[0] in HIERARCHY and len(parts) > 1:
            key = parts[0]
            out[key] = {w.lower() for w in parts[1:]}
        elif parts and parts[0] in HIERARCHY:
            key = parts[0]
            out.setdefault(key, set())
        elif key:
            out[key] |= {w.lower() for w in parts}
    return out


def chain_of(base):
    out, b = set(), base
    while b:
        out.add(b)
        b = HIERARCHY.get(b)
    return out


def main(root=None):
    root = os.path.abspath(root or os.path.join(os.path.dirname(__file__), '..', 'BreachlineUE', 'Source', 'BreachlineUE'))
    headers = sorted(glob.glob(os.path.join(root, 'Public', '**', '*.h'), recursive=True))
    cpps = sorted(glob.glob(os.path.join(root, 'Private', '**', '*.cpp'), recursive=True))
    if not headers:
        print('no headers under %s' % root)
        return 2

    engine = engine_member_sets()
    problems = []
    rel = lambda p: os.path.relpath(p, root)

    # ---- collect declarations --------------------------------------------------
    parents, structs, classes = {}, {}, {}
    for h in headers:
        src = open(h).read()
        for m in re.finditer(r'\b(?:class|struct|enum\s+class|enum)\s+(?:BREACHLINEUE_API\s+)?([AUFE]\w+)\s*[;:{:]', src):
            classes.setdefault(m.group(1), []).append(h)
        for m in re.finditer(r'\b(?:class|struct)\s+(?:BREACHLINEUE_API\s+)?([AUFI]\w+)\s*:\s*public\s+(?:BREACHLINEUE_API\s+)?([AUF]\w+)', src):
            parents[m.group(1)] = (m.group(2), h)
        for m in re.finditer(r'USTRUCT\(([^)]*)\)\s*\nstruct\s+(\w+)', src):
            structs[m.group(2)] = (m.group(1), h)

    # ---- 1 shadowing -----------------------------------------------------------
    for cls, (base, h) in sorted(parents.items()):
        inherited = set()
        for c in chain_of(base):
            inherited |= engine.get(c, set())
        if not inherited:
            continue
        body = body_of(open(h).read(), cls) or ''
        for m in re.finditer(r'(?:^|\n)[ \t]*(?:UPROPERTY\([^)]*\)[ \t]*)?'
                             r'((?:const\s+|mutable\s+|static\s+)?[A-Za-z_][\w:<>,\s\*&]*?)\b(\w+)\s*(?:=[^;]+)?;', body):
            if m.group(2).lower() in inherited:
                problems.append('%s: member `%s` shadows %s::%s' % (rel(h), m.group(2), base, m.group(2)))
        for m in re.finditer(r'UFUNCTION\([^)]*\)[^;()]*?\b(\w+)\s*\(([^;{)]*)\)', body):
            for p in m.group(2).split(','):
                parts = p.strip().split()
                if len(parts) >= 2:
                    pn = re.sub(r'\[.*\]', '', parts[-1]).strip().lstrip('*&')
                    if pn.lower() in inherited:
                        problems.append('%s: parameter `%s` of %s() shadows %s::%s'
                                        % (rel(h), pn, m.group(1), base, pn))

    # ---- 2/3 Blueprint exposure ------------------------------------------------
    for h in headers:
        src = open(h).read()
        for m in re.finditer(r'UFUNCTION\(([^)]*)\)\s*(?:virtual\s+|static\s+)?([\w:<>,\s\*&]*?)\b(\w+)\s*\(([^;{)]*)\)\s*(?:const)?\s*(?:override)?\s*;', src):
            spec, ret, name, params = m.groups()
            if 'Blueprint' not in spec:
                continue
            for t in set(re.findall(r'\b(F[A-Z]\w+)\b', (ret or '') + ' ' + params)):
                if t in structs and 'BlueprintType' not in structs[t][0]:
                    problems.append('%s: %s() is Blueprint-exposed but %s is not USTRUCT(BlueprintType)'
                                    % (rel(h), name, t))
        for m in re.finditer(r'UPROPERTY\(([^)]*BlueprintRead\w*[^)]*)\)\s*([^;]+);', src):
            spec, decl = m.groups()
            if 'TWeakObjectPtr' in decl:
                problems.append('%s: `%s` is a weak pointer exposed to Blueprint (drop the specifier)'
                                % (rel(h), decl.strip()[:60]))

    # ---- 4 AddDynamic targets --------------------------------------------------
    for c in cpps:
        src = open(c).read()
        for m in re.finditer(r'AddDynamic\(\s*this\s*,\s*&(\w+)::(\w+)\s*\)', src):
            cls, fn = m.group(1), m.group(2)
            sources = [open(h).read() for h in classes.get(cls, [])]
            if not sources:
                problems.append('%s: AddDynamic target %s not found' % (rel(c), cls))
            elif not any(re.search(r'UFUNCTION\([^)]*\)[^;()]*?\b' + fn + r'\s*\(', src) for src in sources):
                problems.append('%s: %s::%s is bound with AddDynamic but is not a UFUNCTION'
                                % (rel(c), cls, fn))

    # ---- 5 declared but not defined --------------------------------------------
    all_cpp = '\n'.join(open(c).read() for c in cpps)
    pairs = set(re.findall(r'\b([A-Z]\w+)::([A-Za-z_]\w*)\s*\(', all_cpp))
    for h in headers:
        src = open(h).read()
        for m in re.finditer(r'\b(?:class|struct)\s+(?:BREACHLINEUE_API\s+)?([AUFI]\w+)\b', src):
            cls = m.group(1)
            if src[m.end():m.end() + 200].lstrip().startswith(';'):
                continue
            body = body_of(src, cls)
            if not body or 'GENERATED_BODY' not in body:
                continue
            for d in re.finditer(r'(?:^|\n)[ \t]*(?:virtual\s+|static\s+|explicit\s+)*'
                                 r'([\w:<>,\s\*&]*?)\b([A-Za-z_]\w*)\s*\(([^;{)]*)\)\s*(?:const)?\s*(?:override)?\s*;', body):
                name = d.group(2)
                if name in ('UPROPERTY', 'UFUNCTION', 'GENERATED_BODY') or name.startswith('operator'):
                    continue
                if (cls, name) not in pairs:
                    problems.append('%s: %s::%s declared but never defined' % (rel(h), cls, name))

    # ---- 6 generated.h ---------------------------------------------------------
    for h in headers:
        raw = open(h).read()
        if not re.search(r'\b(UCLASS|USTRUCT|UENUM|UINTERFACE)\s*\(', raw):
            continue
        m = re.search(r'#include "([\w/]+)\.generated\.h"', raw)
        if not m:
            problems.append('%s: reflected header without a .generated.h include' % rel(h))
        elif m.group(1) != os.path.basename(h)[:-2]:
            problems.append('%s: includes the wrong .generated.h (%s)' % (rel(h), m.group(1)))
        elif re.search(r'\n#include', raw[m.end():]):
            problems.append('%s: .generated.h must be the last include' % rel(h))

    # ---- 7 engine includes -----------------------------------------------------
    def include_scope(path, depth=4):
        """Direct includes plus the includes of every project header in reach."""
        raw = open(path).read()
        if depth <= 0:
            return set(re.findall(r'#include "([^"]+)"', raw))
        out, queue = set(), list(re.findall(r'#include "([^"]+)"', raw))
        expanded = set()
        while queue:
            inc = queue.pop(0)
            out.add(inc)
            if inc in expanded:
                continue
            expanded.add(inc)
            cand = os.path.join(root, 'Public', inc)
            if os.path.exists(cand):
                for nested in re.findall(r'#include "([^"]+)"', open(cand).read()):
                    if nested not in out:
                        queue.append(nested)
        return out

    for f in headers + cpps:
        raw = open(f).read()
        src = strip_comments(raw)
        incs = include_scope(f)
        declared = set(re.findall(r'\bclass\s+(?:BREACHLINEUE_API\s+)?([AUF]\w+)\b', raw))
        declared |= set(re.findall(r'\bstruct\s+(?:BREACHLINEUE_API\s+)?([AUF]\w+)\b', raw))
        for t, hdr in TYPE_HEADER.items():
            if not re.search(r'\b' + t + r'\b', src) or t in declared or hdr in incs:
                continue
            pulled = any(alias in incs for alias in ALSO_PROVIDED_BY.get(t, []))
            if not pulled:
                for inc in incs:
                    cand = os.path.join(root, 'Public', inc)
                    if os.path.exists(cand):
                        up = open(cand).read()
                        if hdr in up or re.search(r'\b(?:class|struct)\s+' + t + r'\s*;', up):
                            pulled = True
                            break
            if not pulled:
                problems.append('%s: uses %s without %s in scope' % (rel(f), t, hdr))

    # ---- report ----------------------------------------------------------------
    if problems:
        print('check_uht: %d problem(s)' % len(problems))
        for p in problems:
            print('   ' + p)
        return 1
    print('check_uht: clean (%d headers, %d sources)' % (len(headers), len(cpps)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else None))
