# Troubleshooting the first build

## "BreachlineUE could not be compiled. Try rebuilding from source manually."

That dialog is UnrealBuildTool's *summary*, not the error. It appears whenever the
automatic module rebuild fails, for two very different reasons:

1. **There is no C++ toolchain on the machine.** Most common by far on a fresh
   install: the engine is present but the compiler is not.
2. **The code did not compile.** The real errors are further up the log.

### Step 1 — get the real error

**In the editor:** Window ▸ Output Log, then filter for `error`. Or open
`<Project>/Saved/Logs/BreachlineUE.log` (and `Engine/Programs/UnrealBuildTool/Log.txt`).

**From the command line (best: shows the first error and stops there):**

```bat
:: Windows
"C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\Build.bat" ^
   BreachlineUEEditor Win64 Development ^
   -Project="C:\path\to\BreachlineUE-UE5.8\BreachlineUE\BreachlineUE.uproject" -WaitMutex
```

```bash
# Linux / macOS
"$UE_ROOT/Engine/Build/BatchFiles/Linux/Build.sh" BreachlineUEEditor Linux Development \
   -Project="/path/to/BreachlineUE/ BreachlineUE.uproject" -WaitMutex
```

The first lines containing `error` are the ones to act on (a single bad header can
produce dozens of follow-on errors).

### Step 2 — check the toolchain

| Platform | Needed |
| --- | --- |
| Windows | Visual Studio 2022 (17.8+) with **Desktop development with C++** *and* **Game development with C++**; Windows 10/11 SDK; the "Unreal Engine installer" component is not required |
| macOS | Xcode 15+ with command line tools (`xcode-select --install`) |
| Linux | clang 16+, `build-essential`, and a source-built engine |

Then regenerate project files: right-click `BreachlineUE.uproject` ▸ *Generate
Visual Studio project files* (Windows) or run
`Engine/Build/BatchFiles/Mac/GenerateProjectFiles.sh`. If the editor was opened
before the toolchain was installed, close it first: it caches the "no compiler"
state for the session.

### Symptoms that point at each cause

| What you see | Cause |
| --- | --- |
| The dialog appears a second or two after "Building 1 module…", with no compiler output | no toolchain (step 2) |
| `MSB8020`, `MSB8041`, `The C++ toolchain is not installed` | no toolchain / wrong VS workload |
| `Unrecognized type 'X'`, `missing ';'`, `undeclared identifier` | source (step 3) |
| `error : Unrecognized type 'X' - type must be a UCLASS, USTRUCT or UENUM` | UHT: a reflected type is not visible in that header |
| `error : Missing 'Category'` | a `UFUNCTION`/`UPROPERTY` without `Category` |
| `error : BlueprintReadWrite should not be used on private members` | add `meta = (AllowPrivateAccess = "true")` |
| `The following modules are missing or built with a different engine version` | normal on a fresh clone — say **Yes** to rebuild |

### Step 3 — if it is a source error

Send the first ~20 lines that contain `error`. This project was authored without an
engine available to the author, so it is reviewed rather than machine-verified; a
build error is expected to be reported rather than worked around, and every report
gets fixed at the source.

Known-good patterns already handled in the code — if a *new* error looks like one of
these, it is the same class of problem and the same fix applies:

| Pattern | Fix already applied here |
| --- | --- |
| A class named in a header without a declaration in scope | forward declarations at the top of `Core/BreachlineTypes.h`, `Combat/BreachlineCombatLibrary.h`, `Audio/BreachlineAudioSubsystem.h`, `VFX/BreachlineFXPool.h` |
| A USTRUCT used by reference in a `UFUNCTION` | `Character/HealthComponent.h` includes `Combat/DamageModel.h` |
| A dynamic delegate bound to a non-reflected function | every `AddDynamic` target is a `UFUNCTION()` |
| `UWorld` members called where only a pointer type is known | `#include "Engine/World.h"` in the files that call them |
| A type declared by an engine header that a translation unit does not include | explicit engine includes in the .cpp that uses them |

## It compiles but the level is empty

Expected. `GameDefaultMap` points at `/Game/Breachline/Maps/L_Breachline`, which is
created by `Content/Python/breachline_level.py`. Without it, `ABreachlineGameMode`
generates the compound, the navmesh bound, the lighting and the player start at
runtime, so press **Play** on any level and the game runs.

## Performance

The default tier is High (Lumen HW RT + MegaLights + VSM). Without a ray-tracing
capable GPU, set **Project Settings ▸ Game ▸ Breachline ▸ Quality** to Medium or
Low, or set it in the game instance profile — `ApplyQualityTier()` then rewrites the
CVars (see `docs/RENDERING.md`).
