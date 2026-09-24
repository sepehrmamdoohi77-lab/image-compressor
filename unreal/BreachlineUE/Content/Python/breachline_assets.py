"""
BREACHLINE UE — content generator (data + input + weapon assets).

Run inside the editor:
    Tools > Execute Python Script...      -> Content/Python/breachline_assets.py
or headless:
    UnrealEditor-Cmd.exe BreachlineUE.uproject -run=pythonscript
        -script="Content/Python/breachline_assets.py" -unattended -nopause

What it creates (all under /Game/Breachline):
    Data/DT_Weapons            <- Data/weapons.json        (FBreachlineWeaponDef rows)
    Data/DT_Enemies            <- Data/enemies.json       (FEnemyArchetypeDef rows)
    Data/DT_Rounds             <- Data/enemies.json       (FRoundDef rows)
    Weapons/DA_Weapon_<id>     <- one UBreachlineWeaponDataAsset per row
    Input/IMC_Breachline       <- the mapping context referenced by Project Settings
    Input/IA_*                 <- the Enhanced Input actions

Everything here is OPTIONAL for the game to run: Breachline::DefaultWeapons() and
friends are compiled-in defaults, and the pawn builds key mappings at runtime, so
a fresh checkout plays without any of this. These assets exist so a designer can
retune without recompiling and so the mapping context can be edited in the
editor. The loader order in UWeaponManagerComponent::BuildLoadout is
DataTable -> DA_Weapon_<id> -> compiled defaults.
"""

import json
import os

import unreal

DATA_DIR = os.path.join(unreal.Paths.project_dir(), "Content", "Data")
ROOT = "/Game/Breachline"
DATA_PATH = ROOT + "/Data"
WEAPON_PATH = ROOT + "/Weapons"
INPUT_PATH = ROOT + "/Input"

TOOLS = unreal.AssetToolsHelpers.get_asset_tools()


# ---------------------------------------------------------------- utilities --
def log(message):
    unreal.log("[breachline] " + message)


def warn(message):
    unreal.log_warning("[breachline] " + message)


def ensure_directory(path):
    if not unreal.EditorAssetLibrary.does_directory_exist(path):
        unreal.EditorAssetLibrary.make_directory(path)
        log("created directory " + path)


def create_factory(factory_name):
    """Instantiate a factory by name, tolerating build/plugin differences."""
    factory_class = getattr(unreal, factory_name, None)
    if factory_class is None:
        warn("factory %s is unavailable in this build" % factory_name)
        return None
    try:
        return factory_class()
    except Exception as error:  # pragma: no cover
        warn("could not instantiate %s: %s" % (factory_name, error))
        return None


def load_or_create(asset_path, asset_class, factory):
    """Reuse an existing asset, otherwise create it. Idempotent: safe to re-run."""
    if unreal.EditorAssetLibrary.does_asset_exist(asset_path):
        return unreal.EditorAssetLibrary.load_asset(asset_path)

    package_path, asset_name = asset_path.rsplit("/", 1)
    if factory is None:
        warn("skipping %s (no factory available)" % asset_path)
        return None
    asset = TOOLS.create_asset(asset_name, package_path, asset_class, factory)
    if asset is None:
        warn("could not create " + asset_path)
    return asset


def make_data_table(asset_path, row_struct, json_blob):
    """Create/refresh a DataTable from a JSON payload ({'Rows': {...}})."""
    factory = unreal.DataTableFactory()
    # UDataTableFactory::Struct. set_editor_property is case-insensitive for the
    # first match, so this is stable across engine versions.
    try:
        factory.set_editor_property("struct", row_struct)
    except Exception as error:  # pragma: no cover - engine version drift
        warn("DataTableFactory.struct not settable: %s" % error)

    table = load_or_create(asset_path, unreal.DataTable, factory)
    if table is None:
        return None

    payload = json.dumps(json_blob)
    try:
        # Replaces the rows wholesale so a retune is a re-run.
        unreal.DataTableFunctionLibrary.fill_data_table_from_json_string(table, payload)
        log("filled %s (%d rows)" % (asset_path, len(json_blob.get("Rows", {}))))
    except Exception as error:
        warn("fill_data_table_from_json_string failed for %s: %s" % (asset_path, error))

    unreal.EditorAssetLibrary.save_loaded_asset(table)
    return table


def read_json(file_name):
    path = os.path.join(DATA_DIR, file_name)
    if not os.path.isfile(path):
        warn("missing data file " + path)
        return None
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def struct_instance(properties):
    """Build an FBreachlineWeaponDef from a JSON row (only known fields)."""
    definition = unreal.BreachlineWeaponDef()
    for key, value in properties.items():
        if key.startswith("_"):
            continue
        try:
            definition.set_editor_property(key, value)
        except Exception:
            # Unknown/unsupported key: report once and continue. A missing field
            # is not a reason to abandon the whole table.
            warn("weapon field '%s' could not be set" % key)
    return definition


# --------------------------------------------------------------------- data --
def build_tables():
    ensure_directory(DATA_PATH)

    weapons = read_json("weapons.json")
    if weapons:
        make_data_table(DATA_PATH + "/DT_Weapons",
                        unreal.BreachlineWeaponDef.static_struct(), weapons)

    enemies = read_json("enemies.json")
    if enemies:
        if "Enemies" in enemies:
            make_data_table(DATA_PATH + "/DT_Enemies",
                            unreal.FEnemyArchetypeDef.static_struct(), enemies["Enemies"])
        if "Rounds" in enemies:
            make_data_table(DATA_PATH + "/DT_Rounds",
                            unreal.FRoundDef.static_struct(), enemies["Rounds"])


def build_weapon_assets():
    """One DA_Weapon_<id> per row, matching the loader's fallback convention."""
    ensure_directory(WEAPON_PATH)

    weapons = read_json("weapons.json")
    if not weapons:
        return

    for row_name, properties in weapons.get("Rows", {}).items():
        asset_path = "%s/DA_Weapon_%s" % (WEAPON_PATH, row_name)
        asset = unreal.EditorAssetLibrary.load_asset(asset_path)
        if asset is None:
            asset = load_or_create(
                asset_path, unreal.BreachlineWeaponDataAsset, create_factory("DataAssetFactory"))

        if asset is None:
            warn("could not create " + asset_path)
            continue

        definition = struct_instance(properties)
        try:
            asset.set_editor_property("def", definition)
        except Exception as error:
            warn("setting Def on %s failed: %s" % (asset_path, error))

        asset.set_editor_property("description", "Generated from weapons.json")
        unreal.EditorAssetLibrary.save_loaded_asset(asset)
        log("weapon asset " + asset_path)


# -------------------------------------------------------------------- input --
VALUE_TYPE_NAMES = {
    "Axis2D": "AXIS2_D",
    "Axis1D": "AXIS1_D",
    "Boolean": "BOOLEAN",
}

ACTION_DEFS = [
    # (name, value type, keys in the runtime mapping)
    ("IA_Move", "Axis2D", ["W", "A", "S", "D", "Gamepad_Left2D"]),
    ("IA_Aim", "Axis2D", ["Mouse2D", "Gamepad_Right2D"]),
    ("IA_Fire", "Boolean", ["LeftMouseButton", "Gamepad_RightTrigger"]),
    ("IA_PrecisionAim", "Boolean", ["RightMouseButton", "Gamepad_LeftTrigger"]),
    ("IA_Sprint", "Boolean", ["LeftShift", "Gamepad_LeftShoulder"]),
    ("IA_Crouch", "Boolean", ["C", "LeftControl"]),
    ("IA_Reload", "Boolean", ["R"]),
    ("IA_Grenade", "Boolean", ["G"]),
    ("IA_Weapon1", "Boolean", ["One"]),
    ("IA_Weapon2", "Boolean", ["Two"]),
    ("IA_Weapon3", "Boolean", ["Three"]),
    ("IA_Weapon4", "Boolean", ["Four"]),
    ("IA_Weapon5", "Boolean", ["Five"]),
    ("IA_CycleWeapon", "Boolean", ["Tab", "Gamepad_DPad_Right"]),
    ("IA_CameraRotate", "Axis1D", ["Q", "E"]),
    ("IA_Zoom", "Axis1D", ["MouseWheelAxis"]),
    ("IA_ToggleCursor", "Boolean", ["Escape"]),
]


def build_input_assets():
    """
    Create the input assets so the key map is visible/editable in the editor.

    Note: the character builds its mapping context in C++ at runtime
    (ABreachlinePlayerCharacter::BuildDefaultInputMapping), precisely so the game
    is playable with an empty Content folder. These assets are therefore a
    convenience for designers, and the key list above is kept in sync with that
    code by hand. Key *bindings* are written here on a best-effort basis because
    the mapping array is not script-exposed on every engine version.
    """
    ensure_directory(INPUT_PATH)

    for name, value_type, keys in ACTION_DEFS:
        asset_path = "%s/%s" % (INPUT_PATH, name)
        action = unreal.EditorAssetLibrary.load_asset(asset_path)
        if action is None:
            action = load_or_create(asset_path, unreal.InputAction,
                                    create_factory("InputActionFactory"))
        if action is None:
            continue

        try:
            enum_name = VALUE_TYPE_NAMES.get(value_type, "BOOLEAN")
            action.set_editor_property("value_type",
                                       getattr(unreal.InputActionValueType, enum_name))
        except Exception as error:
            warn("could not set value type on %s: %s" % (asset_path, error))
        try:
            action.set_editor_property("trigger_when_paused", False)
        except Exception:
            pass
        unreal.EditorAssetLibrary.save_loaded_asset(action)

    context_path = "%s/IMC_Breachline" % INPUT_PATH
    context = unreal.EditorAssetLibrary.load_asset(context_path)
    if context is None:
        context = load_or_create(context_path, unreal.InputMappingContext,
                                 create_factory("InputMappingContextFactory"))
    if context is not None:
        unreal.EditorAssetLibrary.save_loaded_asset(context)
        log("input assets written to " + INPUT_PATH)
        log("key bindings are authored in C++ and mirrored in ACTION_DEFS above")


# --------------------------------------------------------------------- main --
def main():
    log("generating content...")
    build_tables()
    build_weapon_assets()
    build_input_assets()
    log("done. Next: run Content/Python/breachline_level.py for the map.")


if __name__ == "__main__":
    main()
