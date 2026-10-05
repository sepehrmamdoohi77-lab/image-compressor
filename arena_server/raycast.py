"""Authoritative 3D hitscan/visibility against map volumes and soldier hit zones."""

import math

from . import config

Vec = tuple[float, float, float]


def add(a: Vec, b: Vec, scale=1.0) -> Vec:
    return a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale


def direction(yaw: float, pitch: float) -> Vec:
    cp = math.cos(pitch)
    return math.sin(yaw) * cp, math.sin(pitch), math.cos(yaw) * cp


def ray_box(origin: Vec, ray: Vec, low: Vec, high: Vec, limit: float):
    near, far = 0.0, limit
    normal = (0.0, 0.0, 0.0)
    for axis in range(3):
        if abs(ray[axis]) < 1e-10:
            if origin[axis] < low[axis] or origin[axis] > high[axis]:
                return None
            continue
        a, b = (low[axis] - origin[axis]) / ray[axis], (high[axis] - origin[axis]) / ray[axis]
        sign = -1.0
        if a > b:
            a, b, sign = b, a, 1.0
        if a >= near:
            near = a
            components = [0.0, 0.0, 0.0]
            components[axis] = sign
            normal = tuple(components)
        far = min(far, b)
        if near > far:
            return None
    return (near, normal) if 0 <= near <= limit else None


def ray_sphere(origin: Vec, ray: Vec, center: Vec, radius: float, limit: float):
    delta = tuple(origin[i] - center[i] for i in range(3))
    b = sum(delta[i] * ray[i] for i in range(3))
    c = sum(v * v for v in delta) - radius * radius
    disc = b * b - c
    if disc < 0:
        return None
    distance = -b - math.sqrt(disc)
    if distance < 0:
        distance = -b + math.sqrt(disc)
    return distance if 0 <= distance <= limit else None


def obstacles(room=None):
    destroyed = room.destroyed if room else set()
    arena = room.map_data if room else config.MAP
    items = [o for o in arena["obstacles"] if o["id"] not in destroyed]
    n = arena["size"] / 2 + 0.05
    for i, x, z, w, d in [
        (0, -n, 0, 0.3, 44.4),
        (1, n, 0, 0.3, 44.4),
        (2, 0, -n, 44.4, 0.3),
        (3, 0, n, 44.4, 0.3),
    ]:
        items.append(
            {"id": f"boundary-{i}", "x": x, "z": z, "w": w, "d": d, "h": 1.9, "kind": "wall"}
        )
    return items


def world_hit(origin: Vec, ray: Vec, limit: float, room=None, volumes=None, radius=0.0):
    nearest = None
    for o in obstacles(room) if volumes is None else volumes:
        low = (o["x"] - o["w"] / 2 - radius, -radius, o["z"] - o["d"] / 2 - radius)
        high = (o["x"] + o["w"] / 2 + radius, o["h"] + radius, o["z"] + o["d"] / 2 + radius)
        result = ray_box(origin, ray, low, high, limit)
        if result and (nearest is None or result[0] < nearest[0]):
            nearest = (result[0], o, result[1])
    return nearest


def clear_segment(a: Vec, b: Vec, room=None, volumes=None):
    delta = tuple(b[i] - a[i] for i in range(3))
    length = math.sqrt(sum(v * v for v in delta))
    if length < 1e-5:
        return True
    ray = tuple(v / length for v in delta)
    hit = world_hit(a, ray, length, room, volumes)
    return hit is None or hit[0] >= length - 0.03


def hit_zones(origin: Vec, ray: Vec, target, limit: float, pose=None):
    x, z, yaw, crouch = (
        (target.x, target.z, target.yaw, target.crouch)
        if pose is None
        else (pose["x"], pose["z"], pose["yaw"], pose["crouch"])
    )
    drop = 0.43 if crouch else 0.0
    head = ray_sphere(origin, ray, (x, 1.65 - drop, z), 0.18, limit)
    nearest = (head, "head") if head is not None else None
    cos, sin = math.cos(yaw), math.sin(yaw)
    dx, dz = origin[0] - x, origin[2] - z
    local_origin = (cos * dx - sin * dz, origin[1], sin * dx + cos * dz)
    local_ray = (cos * ray[0] - sin * ray[2], ray[1], sin * ray[0] + cos * ray[2])
    boxes = [
        ((-0.23, 0.85 - drop, -0.17), (0.23, 1.49 - drop, 0.17), "body"),
        ((-0.45, 0.94 - drop, -0.13), (-0.25, 1.45 - drop, 0.19), "arms"),
        ((0.25, 0.94 - drop, -0.13), (0.45, 1.45 - drop, 0.19), "arms"),
        ((-0.23, 0.12, -0.14), (-0.04, 0.85 - drop, 0.2), "legs"),
        ((0.04, 0.12, -0.14), (0.23, 0.85 - drop, 0.2), "legs"),
    ]
    for low, high, zone in boxes:
        result = ray_box(local_origin, local_ray, low, high, limit)
        if result and (nearest is None or result[0] < nearest[0]):
            nearest = (result[0], zone)
    return nearest


def visible(viewer, target, room):
    if (
        viewer.id == target.id
        or viewer.team == target.team
        or not room.combat_enabled
        or room.phase != "ACTIVE"
    ):
        return True
    if not target.connected:
        return False
    if math.hypot(viewer.x - target.x, viewer.z - target.z) > config.VISION_RANGE:
        return False
    eyes = (viewer.x, 1.65 - (0.43 if viewer.crouch else 0), viewer.z)
    return any(
        clear_segment(eyes, (target.x, y - (0.43 if target.crouch else 0), target.z), room)
        for y in (1.65, 1.2)
    )


def rewind_pose(room, target, at):
    if not room.history:
        return None
    before = None
    for timestamp, samples in room.history:
        pose = samples.get(target.id)
        if not pose or pose["lifeId"] != target.life_id:
            continue
        if timestamp >= at:
            if before is None:
                return pose
            bt, bp = before
            fraction = max(0, min(1, (at - bt) / max(1e-6, timestamp - bt)))
            return {
                **pose,
                "x": bp["x"] + (pose["x"] - bp["x"]) * fraction,
                "z": bp["z"] + (pose["z"] - bp["z"]) * fraction,
            }
        before = (timestamp, pose)
    return before[1] if before else None
