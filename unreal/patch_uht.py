#!/usr/bin/env python3
"""Fix the six UHT errors reported by the first real build.

1. FBreachlineHitMarker: a struct used in a Blueprint-exposed function must be
   USTRUCT(BlueprintType). It was plain USTRUCT() -> "not supported by blueprint".
2. ASpawnDirector::Owner shadows AActor::Owner (UHT forbids shadowing) -> rename.
3. ABreachlineHUD::bShowHud shadows AHUD::bShowHUD (the check is case-insensitive)
   -> rename to a name the engine does not own.
4. ABreachlinePlayerController::HandlePlayerHealthChanged(.., AActor* Instigator)
   shadows AActor::Instigator -> rename the parameter.
5. ABreachlinePlayerController::Player shadows APlayerController::Player
   (the UPlayer* it owns) -> rename to OperatorPawn everywhere.
6. FBulletResult carries a TWeakObjectPtr and is passed to a BlueprintCallable
   function: drop the UFUNCTION from NotifyShotResolved, which only C++ calls.
"""
import re
import sys

ROOT = "/home/user/image-compressor/unreal/BreachlineUE/Source/BreachlineUE/"


def patch(rel, pairs, count=1):
    path = ROOT + rel
    src = open(path).read()
    ok = True
    for old, new in pairs:
        n = src.count(old)
        if n != count:
            print("SKIP %-46s anchor x%d (expected %d): %r" % (rel, n, count, old[:60]))
            ok = False
            continue
        src = src.replace(old, new)
    if ok:
        open(path, "w").write(src)
        print("ok   %s" % rel)
    return ok


def rename_player_member(rel):
    """Rename the bare identifier `Player` (member of the controller) to OperatorPawn."""
    path = ROOT + rel
    src = open(path).read()
    pattern = re.compile(r'(?<![\w>:])Player(?![\w])')
    new, n = pattern.subn('OperatorPawn', src)
    # `Player` as a type/parameter name of another class must not exist in these files
    if n == 0:
        print("SKIP %s: no bare `Player` identifier" % rel)
        return False
    open(path, "w").write(new)
    print("ok   %s (%d occurrences)" % (rel, n))
    return True


def main():
    rc = 0

    # 1 + 4 + 5 + 6 -----------------------------------------------------------
    pairs = [
        # 1: Blueprint-exposed struct
        ("""USTRUCT()
struct FBreachlineHitMarker
{
	GENERATED_BODY()

	UPROPERTY() bool bHeadshot = false;
	UPROPERTY() bool bKill = false;
	UPROPERTY() float Time = -1000.f;
	UPROPERTY() int32 Damage = 0;
};""",
         """USTRUCT(BlueprintType)
struct FBreachlineHitMarker
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Breachline|HUD") bool bHeadshot = false;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|HUD") bool bKill = false;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|HUD") float Time = -1000.f;
	UPROPERTY(BlueprintReadOnly, Category = "Breachline|HUD") int32 Damage = 0;
};"""),

        # 4: parameter shadowing AActor::Instigator
        ("""	/** Bound to the possessed pawn's health: damage flash, direction, no-hit bonus. */
	UFUNCTION()
	void HandlePlayerHealthChanged(float NewHealth, float Delta, AActor* Instigator);""",
         """	/**
	 * Bound to the possessed pawn's health: damage flash, direction, no-hit bonus.
	 * The parameter cannot be called `Instigator`: AActor already has a reflected
	 * member by that name and UHT forbids shadowing it.
	 */
	UFUNCTION()
	void HandlePlayerHealthChanged(float NewHealth, float Delta, AActor* Causer);"""),

        # 5: member shadowing APlayerController::Player
        ("""	UPROPERTY() TObjectPtr<ABreachlinePlayerCharacter> Player = nullptr;""",
         """	/**
	 * The operator pawn. NOT named `Player`: APlayerController already owns a
	 * reflected `Player` (the UPlayer*), and UHT forbids shadowing it.
	 */
	UPROPERTY() TObjectPtr<ABreachlinePlayerCharacter> OperatorPawn = nullptr;"""),

        # 6: FBulletResult has a weak pointer -> keep it out of Blueprint signatures
        ("""	/**
	 * One resolved player bullet: hit marker, damage number and the kill feed.
	 * Scoring (score/headshots/kills) is claimed by the combat library the moment
	 * the victim dies, so this is presentation only.
	 */
	UFUNCTION(BlueprintCallable, Category = "Breachline|Feedback")
	void NotifyShotResolved(const FBulletResult& Report);""",
         """	/**
	 * One resolved player bullet: hit marker, damage number and the kill feed.
	 * Scoring (score/headshots/kills) is claimed by the combat library the moment
	 * the victim dies, so this is presentation only.
	 *
	 * Deliberately NOT a UFUNCTION: FBulletResult holds a TWeakObjectPtr, which UHT
	 * refuses to expose to Blueprint. Only C++ (the combat library) calls this.
	 */
	void NotifyShotResolved(const FBulletResult& Report);"""),
    ]
    if not patch("Public/UI/BreachlinePlayerController.h", pairs):
        rc = 1

    # 2 ----------------------------------------------------------------------
    if not patch("Public/AI/SpawnDirector.h", [(
        "	UPROPERTY() TObjectPtr<ABreachlineGameMode> Owner = nullptr;",
        "	/** Cannot be called `Owner`: AActor already has a reflected member by that name. */\n"
        "	UPROPERTY() TObjectPtr<ABreachlineGameMode> GameModeOwner = nullptr;")]):
        rc = 1
    if not patch("Private/AI/SpawnDirector.cpp", [("	Owner = InOwner;", "	GameModeOwner = InOwner;")]):
        rc = 1

    # 3 ----------------------------------------------------------------------
    if not patch("Public/UI/BreachlineHUD.h", [(
        """	/** Master switch: F1 in the shipped game (also used by the screenshot tests). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|HUD")
	bool bShowHud = true;""",
        """	/**
	 * Master switch for the tactical overlay (also used by the screenshot tests).
	 * Not named `bShowHud`: the check is case-insensitive, so it would clash with
	 * AHUD::bShowHUD, which the engine uses to skip PostRender entirely.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Breachline|HUD")
	bool bDrawTacticalHud = true;""")]):
        rc = 1
    if not patch("Private/UI/BreachlineHUD.cpp", [("	if (!bShowHud || !Canvas) return;",
                                                   "	if (!bDrawTacticalHud || !Canvas) return;")]):
        rc = 1

    # 4 + 5 in the .cpp ------------------------------------------------------
    if not patch("Private/UI/BreachlinePlayerController.cpp", [(
        "void ABreachlinePlayerController::HandlePlayerHealthChanged(float NewHealth, float Delta, AActor* Instigator)",
        "void ABreachlinePlayerController::HandlePlayerHealthChanged(float NewHealth, float Delta, AActor* Causer)")]):
        rc = 1
    if not rename_player_member("Private/UI/BreachlinePlayerController.cpp"):
        rc = 1

    return rc


if __name__ == "__main__":
    sys.exit(main())
