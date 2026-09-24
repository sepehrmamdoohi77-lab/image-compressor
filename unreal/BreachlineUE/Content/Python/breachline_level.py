"""
BREACHLINE UE — level generator.

Run inside the editor:
    Tools > Execute Python Script...      -> Content/Python/breachline_level.py
or headless:
    UnrealEditor-Cmd.exe BreachlineUE.uproject -run=pythonscript
        -script="Content/Python/breachline_level.py" -unattended -nopause

Creates /Game/Breachline/Maps/L_Breachline:
    * a 176 m (44 x 4 m cells) walled compound: four buildings, two streets,
      crates / sandbags / barrels for cover, 24 AI cover points,
    * dusk lighting (low warm sun, cool sky, volumetric fog, six street lamps),
    * a bounded navmesh, one player start, a post-process volume,
    * every actor tagged `BreachlineCompound` so ABreachlineGameMode knows the
      layout is authored and does not build its own at runtime.

Geometry is blockout on purpose: /Engine/BasicShapes scaled into place. It is
what the game is balanced against, it bakes instantly, and it is the reference the
runtime generator in Source/.../World/CompoundBuilder.cpp matches — swap in real
art per piece without touching gameplay.

This script is idempotent only in the "fresh map" sense: it recreates the map
from scratch each run (that is what you want from a generator).
"""

import unreal

LEVEL_PATH = "/Game/Breachline/Maps/L_Breachline"
COMPOUND_TAG = "BreachlineCompound"

# Grid: 44 cells of 4 m, centred on the world origin.
CELLS = 44
CELL = 400.0                     # 4 m in Unreal units
UU = 100.0                       # centimetres per metre (all sizes below are metres)
CELL_M = CELL / UU               # 4 m: the scale a 1 m engine cube needs to fill one cell
HALF = CELLS * 0.5
WALL_HEIGHT = 4.0                # metres; the engine cube is 1 m before scale
BUILDING_HEIGHT = 5.2           # metres
LOW_COVER = 1.1                 # metres
MID_COVER = 1.45                # metres
CHARACTER_HEIGHT = 1.85             # metres

CUBE = "/Engine/BasicShapes/Cube.Cube"
CYLINDER = "/Engine/BasicShapes/Cylinder.Cylinder"

_log = unreal.log
_warn = unreal.log_warning


def cell_to_world(cx, cy, z=0.0):
    """Grid cell -> world location (centred on the origin)."""
    return unreal.Vector((cx - HALF + 0.5) * CELL, (cy - HALF + 0.5) * CELL, z)


# ------------------------------------------------------- editor compat layer --
class Editor(object):
    """
    Thin wrapper over the editor scripting APIs. UE 5.8 prefers the subsystems;
    the older EditorLevelLibrary still exists in some builds, so both are tried
    rather than assuming one.
    """

    def __init__(self):
        self.actor_subsystem = None
        self.level_subsystem = None
        try:
            self.actor_subsystem = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
        except Exception:
            self.actor_subsystem = None
        try:
            self.level_subsystem = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
        except Exception:
            self.level_subsystem = None

        if self.actor_subsystem is None:
            _warn("EditorActorSubsystem unavailable: falling back to EditorLevelLibrary")
            self.legacy = getattr(unreal, "EditorLevelLibrary", None)
        else:
            self.legacy = None

    def new_level(self, path):
        if self.level_subsystem is not None:
            self.level_subsystem.new_level(path)
            return True
        if self.legacy is not None:
            self.legacy.new_level(path)
            return True
        _warn("no level creation API available")
        return False

    def save_level(self):
        if self.level_subsystem is not None:
            self.level_subsystem.save_current_level()
            return
        if self.legacy is not None:
            self.legacy.save_current_level()

    def spawn(self, actor_class, location, rotation=None):
        rotation = rotation or unreal.Rotator(0.0, 0.0, 0.0)
        if self.actor_subsystem is not None:
            return self.actor_subsystem.spawn_actor_from_class(actor_class, location, rotation)
        return self.legacy.spawn_actor_from_class(actor_class, location, rotation)

    def all_actors(self):
        if self.actor_subsystem is not None:
            return self.actor_subsystem.get_all_level_actors()
        return self.legacy.get_all_level_actors()

    def destroy(self, actor):
        if self.actor_subsystem is not None:
            self.actor_subsystem.destroy_actor(actor)
        else:
            self.legacy.destroy_actor(actor)


EDITOR = Editor()


# ------------------------------------------------------------------- pieces ---
class Piece(object):
    """A scaled static mesh, tagged so the game mode recognises the compound."""

    def __init__(self, mesh, location, scale, rotation=None, name=None, collision=True):
        self.actor = EDITOR.spawn(unreal.StaticMeshActor, location, rotation)
        if self.actor is None:
            _warn("failed to spawn piece at %s" % (location,))
            return

        if name:
            self.actor.set_actor_label(name)
        self.actor.tags.append(unreal.Name(COMPOUND_TAG))

        component = self.actor.static_mesh_component
        component.set_editor_property("static_mesh", unreal.load_asset(mesh))
        self.actor.set_actor_scale3d(unreal.Vector(*scale))
        if not collision:
            component.set_collision_profile_name("NoCollision")
        # Static mobility: the compound never moves, so it bakes and batches.
        component.set_editor_property("mobility", unreal.ComponentMobility.STATIC)

    def tag(self, extra):
        if self.actor is not None:
            self.actor.tags.append(unreal.Name(extra))


def cube(location, scale, rotation=None, name=None, collision=True):
    return Piece(CUBE, location, scale, rotation, name, collision)


def cylinder(location, scale, rotation=None, name=None):
    return Piece(CYLINDER, location, scale, rotation, name)


def build_ground():
    # One slab for the whole arena, then raised street strips that read as roads
    # from the isometric camera.
    # 44 cells x 4 m = 176 m square (the engine cube is 1 m before scale).
    cube(unreal.Vector(0.0, 0.0, -20.0), unreal.Vector(CELLS * 4.0, CELLS * 4.0, 0.4), name="GROUND_Slab")

    for i in range(0, CELLS, 11):
        row = cell_to_world(CELLS * 0.5, i + 1.0, 8.0)
        cube(row, unreal.Vector(CELLS * CELL_M, CELL_M, 0.16), name="GROUND_Street_EW_%d" % i)

        column = cell_to_world(i + 1.0, CELLS * 0.5, 8.0)
        cube(column, unreal.Vector(CELL_M, CELLS * CELL_M, 0.16), name="GROUND_Street_NS_%d" % i)


def build_perimeter():
    """Four walls with a two-cell gate mid-span on each side."""
    gate = CELLS // 2
    gate_half = 2
    wall_scale_z = WALL_HEIGHT   # engine cube is 1 m, so scale == metres
    thickness = 0.6

    for i in range(CELLS):
        is_gate = abs(i - gate) <= gate_half
        height = LOW_COVER if is_gate else wall_scale_z

        if not is_gate:
            # One cell of wall per piece: CELL_M along the run, `thickness` across,
            # so consecutive pieces butt up instead of leaving 3 m gaps.
            cube(cell_to_world(i + 0.5, 0.5, height * UU * 0.5), unreal.Vector(CELL_M, thickness, height),
                 name="WALL_S_%d" % i)
            cube(cell_to_world(i + 0.5, CELLS - 0.5, height * UU * 0.5), unreal.Vector(CELL_M, thickness, height),
                 name="WALL_N_%d" % i)
            cube(cell_to_world(0.5, i + 0.5, height * UU * 0.5), unreal.Vector(thickness, CELL_M, height),
                 name="WALL_W_%d" % i)
            cube(cell_to_world(CELLS - 0.5, i + 0.5, height * UU * 0.5), unreal.Vector(thickness, CELL_M, height),
                 name="WALL_E_%d" % i)
        else:
            # Gate lintel: low cover, shootable, passable — the "way in" for both
            # the player and flanking squads.
            for label, location, scale in (
                ("GATE_S_%d" % i, cell_to_world(i + 0.5, 0.5, LOW_COVER * UU * 0.5), unreal.Vector(CELL_M, thickness, LOW_COVER)),
                ("GATE_N_%d" % i, cell_to_world(i + 0.5, CELLS - 0.5, LOW_COVER * UU * 0.5), unreal.Vector(CELL_M, thickness, LOW_COVER)),
                ("GATE_W_%d" % i, cell_to_world(0.5, i + 0.5, LOW_COVER * UU * 0.5), unreal.Vector(thickness, CELL_M, LOW_COVER)),
                ("GATE_E_%d" % i, cell_to_world(CELLS - 0.5, i + 0.5, LOW_COVER * UU * 0.5), unreal.Vector(thickness, CELL_M, LOW_COVER)),
            ):
                cube(location, scale, name=label)


BUILDINGS = [
    # (cell x, cell y, width, depth)
    (5, 5, 11, 8),
    (27, 6, 12, 9),
    (7, 29, 9, 10),
    (26, 28, 11, 11),
]


def build_buildings():
    for index, (bx, by, width, depth) in enumerate(BUILDINGS):
        centre = cell_to_world(bx + width * 0.5, by + depth * 0.5, 12.0)
        cube(centre, unreal.Vector(width * CELL_M, depth * CELL_M, 0.25), name="BUILDING_%d_Floor" % index)

        height_scale = BUILDING_HEIGHT
        for x in range(width):
            for y in range(depth):
                edge_x = x in (0, width - 1)
                edge_y = y in (0, depth - 1)
                if not edge_x and not edge_y:
                    continue

                # Two doorways per building, opposite corners: an interior fight
                # always has a second exit, and the AI gets two approach axes.
                if (x == width // 2 and y == 0) or (x == 0 and y == depth // 2):
                    continue

                # Half a cell for the returning walls, a full cell for the run
                # walls, always measured in metres.
                scale_x = (0.5 if edge_x else 1.0) * CELL_M
                scale_y = (0.5 if edge_y else 1.0) * CELL_M
                cube(cell_to_world(bx + x + 0.5, by + y + 0.5, height_scale * 50.0),
                     unreal.Vector(scale_x, scale_y, height_scale),
                     name="BUILDING_%d_Wall_%d_%d" % (index, x, y))

        for x in range(0, width, 2):
            beam = cell_to_world(bx + x + 0.5, by + depth * 0.5, BUILDING_HEIGHT * UU + 20.0)
            cube(beam, unreal.Vector(0.4, depth * CELL_M, 0.4), name="BUILDING_%d_Beam_%d" % (index, x))


COVER_PLAN = [
    # (cell x, cell y, low cover?, kind) kind: 0 crate, 1 sandbag, 2 barrel
    (18, 4, True, 0), (21, 9, True, 0), (24, 3, False, 2),
    (18, 15, False, 1), (23, 18, True, 0), (17, 22, True, 0),
    (34, 19, True, 0), (38, 24, False, 2), (33, 33, True, 0),
    (21, 26, False, 1), (19, 33, True, 0), (14, 39, True, 0),
    (36, 4, True, 0), (39, 12, False, 2), (4, 18, True, 0),
    (3, 26, False, 1), (11, 20, False, 1), (30, 20, False, 2),
    (26, 40, True, 0), (15, 12, False, 2), (40, 37, True, 0),
    (5, 39, True, 0), (12, 4, False, 1), (29, 26, False, 2),
]


def build_cover():
    """Cover pieces plus one ACoverPoint each, oriented away from the obstacle."""
    index = 0
    for (cx, cy, is_low, kind) in COVER_PLAN:
        rotation = unreal.Rotator(0.0, (index % 4) * 90.0, 0.0)
        location = cell_to_world(cx, cy, 0.0)

        if kind == 0:
            height = LOW_COVER
            cube(unreal.Vector(location.x, location.y, height * UU * 0.5),
                 unreal.Vector(1.2, 1.2, height),
                 rotation, name="COVER_Crate_%d" % index)
        elif kind == 1:
            height = MID_COVER
            cube(unreal.Vector(location.x, location.y, height * UU * 0.5),
                 unreal.Vector(2.4, 0.7, height),
                 rotation, name="COVER_Sandbag_%d" % index)
        else:
            for barrel in range(2):
                offset = unreal.Rotator(0.0, rotation.yaw, 0.0).get_forward_vector()
                position = unreal.Vector(location.x + offset.x * 90.0 * barrel,
                                         location.y + offset.y * 90.0 * barrel,
                                         0.9 * UU * 0.5)
                cylinder(position, unreal.Vector(0.42, 0.42, 0.9),
                         name="COVER_Barrel_%d_%d" % (index, barrel))

        # The cover point sits 1.5 m out from the piece on its reverse face, so the
        # point's forward vector already means "the side a threat arrives from".
        facing = rotation.yaw + 90.0
        offset = unreal.Rotator(0.0, facing, 0.0).get_forward_vector()
        point_location = unreal.Vector(location.x + offset.x * 150.0,
                                       location.y + offset.y * 150.0,
                                       40.0)

        point = EDITOR.spawn(unreal.CoverPoint, point_location, unreal.Rotator(0.0, facing, 0.0))
        if point is not None:
            point.set_actor_label("COVERPOINT_%d" % index)
            point.set_editor_property("cover_index", index)
            point.set_editor_property("b_low_cover", is_low)
            point.tags.append(unreal.Name(COMPOUND_TAG))

        index += 1


def build_lighting():
    sun = EDITOR.spawn(unreal.DirectionalLight,
                       unreal.Vector(0.0, 0.0, 6000.0),
                       unreal.Rotator(-8.0, 205.0, 0.0))
    if sun is not None:
        sun.set_actor_label("SUN_Dusk")
        component = sun.directional_light_component
        component.set_editor_property("intensity", 9.0)
        component.set_editor_property("light_color", unreal.Color(255, 184, 122, 255))
        component.set_editor_property("cast_shadows", True)
        sun.tags.append(unreal.Name(COMPOUND_TAG))

    sky = EDITOR.spawn(unreal.SkyLight, unreal.Vector(0.0, 0.0, 3000.0))
    if sky is not None:
        sky.set_actor_label("SKY_Cool")
        component = sky.sky_light_component
        component.set_editor_property("intensity", 1.1)
        component.set_editor_property("light_color", unreal.Color(115, 148, 217, 255))
        component.set_editor_property("real_time_capture", True)
        sky.tags.append(unreal.Name(COMPOUND_TAG))

    fog = EDITOR.spawn(unreal.ExponentialHeightFog, unreal.Vector(0.0, 0.0, -200.0))
    if fog is not None:
        fog.set_actor_label("FOG_Atmosphere")
        component = fog.get_editor_property("component")
        component.set_editor_property("fog_density", 0.018)
        component.set_editor_property("fog_height_falloff", 0.22)
        component.set_editor_property("volumetric_fog", True)
        fog.tags.append(unreal.Name(COMPOUND_TAG))

    volume = EDITOR.spawn(unreal.PostProcessVolume, unreal.Vector(0.0, 0.0, 0.0))
    if volume is not None:
        volume.set_actor_label("PP_Tactical")
        volume.set_editor_property("unbound", True)
        settings = volume.get_editor_property("settings")
        settings.set_editor_property("override_auto_exposure_method", True)
        settings.set_editor_property("auto_exposure_method", unreal.AutoExposureMethod.AEM_MANUAL)
        settings.set_editor_property("override_auto_exposure_bias", True)
        settings.set_editor_property("auto_exposure_bias", 11.5)
        settings.set_editor_property("override_vignette_intensity", True)
        settings.set_editor_property("vignette_intensity", 0.45)
        settings.set_editor_property("override_motion_blur_amount", True)
        settings.set_editor_property("motion_blur_amount", 0.0)
        volume.set_editor_property("settings", settings)
        volume.tags.append(unreal.Name(COMPOUND_TAG))

    # Six street lamps: with MegaLights enabled these all cast real shadows, which
    # is the single biggest visual upgrade over the web build.
    for index, (cx, cy) in enumerate([(19, 8), (30, 12), (12, 26), (33, 30), (23, 38), (8, 14)]):
        lamp = EDITOR.spawn(unreal.PointLight, cell_to_world(cx, cy, 420.0))
        if lamp is None:
            continue
        lamp.set_actor_label("LAMP_%d" % index)
        component = lamp.point_light_component
        component.set_editor_property("intensity", 6000.0)
        component.set_editor_property("attenuation_radius", 1600.0)
        component.set_editor_property("cast_shadows", True)
        lamp.tags.append(unreal.Name(COMPOUND_TAG))
        # Physical lamp post so the light source is visible in the dusk light.
        cylinder(cell_to_world(cx, cy, 4.2 * UU * 0.5), unreal.Vector(0.18, 0.18, 4.2), name="LAMP_Post_%d" % index)


def build_gameplay():
    # Navmesh bound covering the whole compound: AI pathing needs it, and dynamic
    # generation keeps it correct as cover is added or moved.
    nav = EDITOR.spawn(unreal.NavMeshBoundsVolume, unreal.Vector(0.0, 0.0, 200.0))
    if nav is not None:
        nav.set_actor_label("NAV_Compound")
        # The volume's default brush is a 200 uu cube and the scale multiplies it:
        # (88 m half-extent + 6 m margin) * 2 / 200 uu = 94 -> a 188 m box, 8 m tall.
        nav.set_actor_scale3d(unreal.Vector(94.0, 94.0, 4.0))
        nav.tags.append(unreal.Name(COMPOUND_TAG))

    # Player start faces the compound from the south-west street.
    # z is the capsule centre: half the character height above the ground slab.
    start = EDITOR.spawn(unreal.PlayerStart, cell_to_world(16.0, 20.0, CHARACTER_HEIGHT * UU * 0.5),
                         unreal.Rotator(0.0, 20.0, 0.0))
    if start is not None:
        start.set_actor_label("START_Operator")
        start.tags.append(unreal.Name(COMPOUND_TAG))

    # Trigger-free: the round loop is driven by ABreachlineGameMode, so no
    # level-side game logic exists to drift out of sync with the C++ rules.
    note = EDITOR.spawn(unreal.TargetPoint, unreal.Vector(0.0, 0.0, 200.0))
    if note is not None:
        note.set_actor_label("NOTE_CompoundCentre")
        note.tags.append(unreal.Name(COMPOUND_TAG))


def main():
    _log("[breachline] generating %s ..." % LEVEL_PATH)

    if not EDITOR.new_level(LEVEL_PATH):
        return

    build_ground()
    build_perimeter()
    build_buildings()
    build_cover()
    build_lighting()
    build_gameplay()

    EDITOR.save_level()
    _log("[breachline] level saved. Press Play: ABreachlineGameMode runs the five-round loop.")
    _log("[breachline] expected: 4 buildings, 24 cover points, 6 lamps, navmesh bound, 1 player start.")
    _log("[breachline] actors in level: %d" % len(EDITOR.all_actors()))


if __name__ == "__main__":
    main()
