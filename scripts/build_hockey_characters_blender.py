"""Headless Blender 5.3 pipeline generating 53-bone vertex-skinned CC0 human
field-hockey athletes and equipment (.blend + .glb) for Uddy: Eight Seconds.

Run:
  "C:\Program Files\Blender Foundation\Blender 5.3\blender.exe" --background --python scripts/build_hockey_characters_blender.py
"""
import gzip
import json
import math
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = REPO_ROOT / "assets_src" / "makehuman_cc0"
BLEND_DIR = REPO_ROOT / "assets_src" / "blend"
TEX_DIR = REPO_ROOT / "assets_src" / "textures"
OUT_GLB_DIR = REPO_ROOT / "public" / "assets" / "models"

for d in (BLEND_DIR, TEX_DIR, OUT_GLB_DIR):
    d.mkdir(parents=True, exist_ok=True)


def load_base_obj(obj_path: Path):
    verts = []
    uvs = []
    groups = {}
    cubes = {}
    cur_g = "default"
    with open(obj_path, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("v "):
                p = line.split()
                verts.append([float(p[1]), float(p[2]), float(p[3])])
            elif line.startswith("vt "):
                p = line.split()
                uvs.append([float(p[1]), float(p[2])])
            elif line.startswith("g "):
                cur_g = line.strip()[2:]
            elif line.startswith("f "):
                fv = []
                fvt = []
                for tok in line.split()[1:]:
                    parts = tok.split("/")
                    vi = int(parts[0]) - 1
                    ti = int(parts[1]) - 1 if len(parts) > 1 and parts[1] else 0
                    fv.append(vi)
                    fvt.append(ti)
                groups.setdefault(cur_g, []).append((fv, fvt))
                if cur_g.startswith("joint-"):
                    cubes.setdefault(cur_g, set()).update(fv)
    return np.array(verts, dtype=np.float64), np.array(uvs, dtype=np.float64), groups, cubes


def apply_morph_target(verts: np.ndarray, gz_path: Path, weight: float = 1.0) -> np.ndarray:
    out = verts.copy()
    with gzip.open(gz_path, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            p = line.split()
            idx = int(p[0])
            if 0 <= idx < len(out):
                out[idx, 0] += float(p[1]) * weight
                out[idx, 1] += float(p[2]) * weight
                out[idx, 2] += float(p[3]) * weight
    return out


def mh_to_blender_coords(verts_mh: np.ndarray) -> tuple[np.ndarray, float]:
    """Convert MakeHuman decimetres (X=left, Y=up, Z=fwd) to grounded Blender meters (X=left, Y=-fwd, Z=up)."""
    # Body vertices are 0..13379
    min_mh_y = float(np.min(verts_mh[:13380, 1]))
    ground_shift = -min_mh_y * 0.1 + 0.012  # Allow 12mm molded turf sole underneath foot skin
    bl = np.zeros_like(verts_mh)
    bl[:, 0] = verts_mh[:, 0] * 0.1
    bl[:, 1] = -verts_mh[:, 2] * 0.1
    bl[:, 2] = verts_mh[:, 1] * 0.1 + ground_shift
    return bl, ground_shift


def load_grayscale_mask(path: Path, size: int) -> np.ndarray:
    img = bpy.data.images.load(str(path), check_existing=True)
    img.scale(size, size)
    px = np.array(img.pixels[:], dtype=np.float32).reshape((size, size, 4))
    bpy.data.images.remove(img)
    return px[:, :, 0]


def make_image_from_rgba(name: str, rgba: np.ndarray, out_path: Path) -> bpy.types.Image:
    h, w, _ = rgba.shape
    img = bpy.data.images.new(name, width=w, height=h, alpha=True)
    # Blender image pixels are bottom-to-top
    img.pixels.foreach_set(np.clip(rgba, 0.0, 1.0).astype(np.float32).ravel())
    img.filepath_raw = str(out_path)
    img.file_format = "PNG"
    img.save()
    img.pack()
    return img


def generate_skin_texture(name: str, base_rgb: tuple, lip_rgb: tuple, size: int = 1024) -> bpy.types.Image:
    face_mask = load_grayscale_mask(SRC_DIR / "mpfb_face.jpg", size)
    lips_mask = load_grayscale_mask(SRC_DIR / "mpfb_lips.jpg", size)
    lids_mask = load_grayscale_mask(SRC_DIR / "mpfb_eyelids.jpg", size)
    ears_mask = load_grayscale_mask(SRC_DIR / "mpfb_ears.jpg", size)
    nails_mask = load_grayscale_mask(SRC_DIR / "mpfb_fingernails.jpg", size)

    rgba = np.ones((size, size, 4), dtype=np.float32)
    rgba[:, :, 0] = base_rgb[0]
    rgba[:, :, 1] = base_rgb[1]
    rgba[:, :, 2] = base_rgb[2]

    # Subtle warm flush on face cheeks & ears, realistic lip pigment, slightly darker eyelids, natural nails
    for c in range(3):
        cheek_delta = (0.04 if c == 0 else -0.01) * face_mask
        ear_delta = -0.04 * ears_mask
        lid_delta = -0.08 * lids_mask
        rgba[:, :, c] = rgba[:, :, c] + cheek_delta + ear_delta + lid_delta
        rgba[:, :, c] = rgba[:, :, c] * (1.0 - 0.72 * lips_mask) + lip_rgb[c] * (0.72 * lips_mask)
        rgba[:, :, c] = rgba[:, :, c] * (1.0 - 0.45 * nails_mask) + min(1.0, base_rgb[c] + 0.16) * (0.45 * nails_mask)

    # Subtle skin micro-variation (prevents flat plastic look)
    rng = np.random.default_rng(77)
    grain = rng.normal(0.0, 0.012, (size, size, 1)).astype(np.float32)
    rgba[:, :, :3] += grain

    # Convert authored sRGB values to linear RGB because Blender expects linear floats in Image.pixels
    rgba[:, :, :3] = np.power(np.clip(rgba[:, :, :3], 0.0, 1.0), 2.2)

    return make_image_from_rgba(name, rgba, TEX_DIR / f"{name}.png")


def generate_eye_texture(name: str, iris_rgb: tuple, size: int = 256) -> bpy.types.Image:
    # MakeHuman helper-l-eye / helper-r-eye UV occupies small patches near v=0.932..0.957, u=0.76..0.813
    # We map our eye spheres with fresh spherical/planar front UVs (0..1 centered at 0.5, 0.5) so iris sits dead center!
    yy, xx = np.mgrid[0:size, 0:size]
    nx = (xx / (size - 1)) * 2.0 - 1.0
    ny = (yy / (size - 1)) * 2.0 - 1.0
    r = np.sqrt(nx * nx + ny * ny)
    rgba = np.ones((size, size, 4), dtype=np.float32)
    rgba[:, :, :3] = 0.94  # Natural warm sclera

    iris = (r < 0.36) & (r >= 0.15)
    limbal = (r < 0.38) & (r >= 0.33)
    pupil = r < 0.15
    for c in range(3):
        rgba[iris, c] = iris_rgb[c]
        rgba[limbal, c] = iris_rgb[c] * 0.42
        rgba[pupil, c] = 0.04
    return make_image_from_rgba(name, rgba, TEX_DIR / f"{name}.png")


def generate_digit_bitmap(ch: str) -> np.ndarray:
    """Crisp 7x9 athletic block digit pattern."""
    patterns = {
        "0": [
            ".11111.",
            "11...11",
            "11...11",
            "11...11",
            "11...11",
            "11...11",
            "11...11",
            "11...11",
            ".11111.",
        ],
        "1": [
            "..111..",
            ".1111..",
            "11.11..",
            "...11..",
            "...11..",
            "...11..",
            "...11..",
            "1111111",
            "1111111",
        ],
        "2": [
            ".11111.",
            "11...11",
            ".....11",
            "....11.",
            "...11..",
            "..11...",
            ".11....",
            "1111111",
            "1111111",
        ],
        "3": [
            ".11111.",
            "11...11",
            ".....11",
            "..1111.",
            ".....11",
            ".....11",
            ".....11",
            "11...11",
            ".11111.",
        ],
        "4": [
            "11...11",
            "11...11",
            "11...11",
            "1111111",
            ".....11",
            ".....11",
            ".....11",
            ".....11",
            ".....11",
        ],
        "5": [
            "1111111",
            "11.....",
            "11.....",
            "111111.",
            ".....11",
            ".....11",
            ".....11",
            "11...11",
            ".11111.",
        ],
        "6": [
            ".11111.",
            "11...11",
            "11.....",
            "111111.",
            "11...11",
            "11...11",
            "11...11",
            "11...11",
            ".11111.",
        ],
        "7": [
            "1111111",
            "1111111",
            "....11.",
            "...11..",
            "...11..",
            "..11...",
            "..11...",
            "..11...",
            "..11...",
        ],
        "8": [
            ".11111.",
            "11...11",
            "11...11",
            ".11111.",
            "11...11",
            "11...11",
            "11...11",
            "11...11",
            ".11111.",
        ],
        "9": [
            ".11111.",
            "1111111",
            "11...11",
            "11...11",
            "1111111",
            ".111111",
            ".....11",
            "1111111",
            ".11111.",
        ],
    }
    grid = patterns.get(ch, patterns["9"])
    arr = np.zeros((9, 7), dtype=np.float32)
    for r, row in enumerate(grid):
        for c, val in enumerate(row):
            arr[8 - r, c] = 1.0 if val == "1" else 0.0  # flip vertically for bottom-up Blender image
    return arr


def generate_jersey_texture(name: str, number_str: str, is_keeper: bool, size: int = 1024) -> bpy.types.Image:
    """UV layout for tailored jersey: u=0..1 wraps waist circumference (0.5=front chest, 0.0/1.0=back center)
    Wait: we assign clean cylindrical UVs centered at u=0.25 = Front Chest, u=0.75 = Back!"""
    rgba = np.ones((size, size, 4), dtype=np.float32)
    deep_blue = (0.045, 0.145, 0.36) if not is_keeper else (0.055, 0.095, 0.175)
    gold = (0.95, 0.74, 0.12)
    chalk = (0.95, 0.96, 0.98)

    # Woven athletic polyester micro-pique texture
    yy, xx = np.mgrid[0:size, 0:size]
    weave = (((xx // 3) + (yy // 3)) % 2) * 0.02 - 0.01
    for c in range(3):
        rgba[:, :, c] = deep_blue[c] + weave

    # Refined gold & chalk piping near collar (top v=0.88..0.95) and subtle side/chest stripe (v=0.48..0.54)
    chest_band = (yy >= int(size * 0.50)) & (yy <= int(size * 0.555))
    piping_top = (yy >= int(size * 0.556)) & (yy <= int(size * 0.566))
    piping_bot = (yy >= int(size * 0.488)) & (yy <= int(size * 0.498))
    collar_band = yy >= int(size * 0.90)
    for c in range(3):
        rgba[chest_band, c] = gold[c] + weave[chest_band]
        rgba[piping_top | piping_bot, c] = chalk[c]
        rgba[collar_band, c] = gold[c] if not is_keeper else (0.045, 0.145, 0.36)[c]

    # Sharp squad number centered on BACK (u=0.75) and small chest badge on FRONT (u=0.25)
    digits = list(number_str)
    dw = int(size * 0.075)
    dh = int(size * 0.17)
    total_w = len(digits) * dw + (len(digits) - 1) * int(size * 0.014)
    start_x = int(size * 0.75) - total_w // 2
    start_y = int(size * 0.60)
    for idx, ch in enumerate(digits):
        bmp = generate_digit_bitmap(ch)
        bx0 = start_x + idx * (dw + int(size * 0.014))
        for py in range(dh):
            sy = min(8, int(py * 9 / dh))
            for px in range(dw):
                sx = min(6, int(px * 7 / dw))
                # Flip horizontally on cylindrical back projection (u decreases left-to-right across back)
                if bmp[sy, 6 - sx] > 0.5:
                    rgba[start_y + py, bx0 + px, :3] = chalk if not is_keeper else gold

    # Front chest club emblem diamond (u=0.25, left-chest offset u=0.29)
    cx, cy = int(size * 0.29), int(size * 0.68)
    dist = np.abs(xx - cx) + np.abs(yy - cy)
    crest_outer = dist <= int(size * 0.026)
    crest_inner = dist <= int(size * 0.017)
    for c in range(3):
        rgba[crest_outer, c] = gold[c]
        rgba[crest_inner, c] = deep_blue[c]

    return make_image_from_rgba(name, rgba, TEX_DIR / f"{name}.png")


def generate_socks_texture(name: str, size: int = 512) -> bpy.types.Image:
    rgba = np.ones((size, size, 4), dtype=np.float32)
    blue = (0.045, 0.145, 0.36)
    gold = (0.95, 0.74, 0.12)
    yy, _ = np.mgrid[0:size, 0:size]
    for c in range(3):
        rgba[:, :, c] = blue[c]
    hoop1 = (yy >= int(size * 0.76)) & (yy <= int(size * 0.83))
    hoop2 = (yy >= int(size * 0.87)) & (yy <= int(size * 0.93))
    for c in range(3):
        rgba[hoop1 | hoop2, c] = gold[c]
    return make_image_from_rgba(name, rgba, TEX_DIR / f"{name}.png")


def generate_keeper_pad_texture(name: str, size: int = 1024) -> bpy.types.Image:
    rgba = np.ones((size, size, 4), dtype=np.float32)
    charcoal = (0.055, 0.075, 0.115)
    blue = (0.055, 0.165, 0.40)
    gold = (0.95, 0.74, 0.12)
    chalk = (0.94, 0.95, 0.97)
    yy, xx = np.mgrid[0:size, 0:size]

    for c in range(3):
        rgba[:, :, c] = charcoal[c]
    # Vertical ergonomic central blue channel + diagonal gold trim + crisp stitched border
    center_band = (xx >= int(size * 0.18)) & (xx <= int(size * 0.82)) & (yy >= int(size * 0.08)) & (yy <= int(size * 0.92))
    diag_gold = (yy - 0.35 * xx >= int(size * 0.55 * size)) & (yy - 0.35 * xx <= int(size * 0.65 * size)) & center_band
    diag_white = (yy - 0.35 * xx >= int(size * 0.65 * size)) & (yy - 0.35 * xx <= int(size * 0.68 * size)) & center_band
    knee_wrap = (yy >= int(size * 0.75)) & (yy <= int(size * 0.88)) & center_band
    seam = (xx <= 16) | (xx >= size - 16) | (yy <= 16) | (yy >= size - 16)
    for c in range(3):
        rgba[center_band, c] = blue[c]
        rgba[diag_gold, c] = gold[c]
        rgba[diag_white, c] = chalk[c]
        rgba[knee_wrap, c] = charcoal[c]
        rgba[seam, c] = chalk[c]

    return make_image_from_rgba(name, rgba, TEX_DIR / f"{name}.png")


def create_pbr_mat(name: str, image: bpy.types.Image | None = None, base_color=(0.5, 0.5, 0.5, 1.0), metallic=0.0, roughness=0.6) -> bpy.types.Material:
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if image is not None:
        tex_node = nt.nodes.new("ShaderNodeTexImage")
        tex_node.image = image
        nt.links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = base_color
    return mat


def build_mesh_object(name: str, verts_xyz: np.ndarray, faces_list: list, uvs: np.ndarray, mat: bpy.types.Material, smooth: bool = True) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bm_verts = [bm.verts.new(v) for v in verts_xyz]
    bm.verts.ensure_lookup_table()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    created_faces = []
    for fv, fvt in faces_list:
        try:
            face = bm.faces.new([bm_verts[i] for i in fv])
            for loop, ti in zip(face.loops, fvt):
                if 0 <= ti < len(uvs):
                    loop[uv_layer].uv = (uvs[ti][0], uvs[ti][1])
            created_faces.append(face)
        except ValueError:
            pass

    # Delete isolated unused vertices so weights/indices stay compact? NO — keep vertex index mapping 1:1 with base_obj during weight assignment!
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def assign_weights_to_object(obj: bpy.types.Object, orig_vert_map: list[int], weights_dict: dict, bone_names: list[str]):
    for bname in bone_names:
        obj.vertex_groups.new(name=bname)
    vg_map = {vg.name: vg for vg in obj.vertex_groups}

    # Build lookup: orig_vert_idx -> list of (bone_name, weight)
    per_vert = {}
    for bname, pairs in weights_dict.items():
        if bname not in vg_map:
            continue
        for vi, w in pairs:
            if w > 0.0005:
                per_vert.setdefault(vi, []).append((bname, float(w)))

    for local_vi, orig_vi in enumerate(orig_vert_map):
        items = per_vert.get(orig_vi)
        if not items:
            continue
        total = sum(w for _, w in items)
        inv = 1.0 / max(1e-6, total)
        for bname, w in items:
            vg_map[bname].add([local_vi], w * inv, "REPLACE")


def extract_submesh_by_face_mask(
    name: str,
    verts_xyz: np.ndarray,
    body_faces: list,
    face_predicate,
    offset_m: float,
    normals_xyz: np.ndarray,
    weights_dict: dict,
    bone_names: list[str],
    mat: bpy.types.Material,
    uv_mode: str = "cylindrical",
    solidify_m: float = 0.0,
) -> bpy.types.Object:
    """Extracts an anatomical garment/equipment mesh directly from morphed body faces,
    inherits exact vertex weights from the underlying body vertices, pushes outward cleanly,
    and optionally adds garment hem thickness."""
    selected = [f for f in body_faces if face_predicate([verts_xyz[i] for i in f[0]])]
    used_orig = sorted({vi for fv, _ in selected for vi in fv})
    orig_to_local = {ov: lv for lv, ov in enumerate(used_orig)}

    sub_verts = verts_xyz[used_orig] + normals_xyz[used_orig] * offset_m
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bm_verts = [bm.verts.new(v) for v in sub_verts]
    bm.verts.ensure_lookup_table()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    # Compute bounds for clean cylindrical or planar UV projection
    zs = sub_verts[:, 2]
    z_min, z_max = float(np.min(zs)), float(np.max(zs))
    z_span = max(0.05, z_max - z_min)

    for fv, _ in selected:
        try:
            face = bm.faces.new([bm_verts[orig_to_local[i]] for i in fv])
            for loop in face.loops:
                co = loop.vert.co
                if uv_mode == "cylindrical":
                    ang = math.atan2(-co.y, co.x)
                    u = (ang / (2.0 * math.pi)) % 1.0
                    v = (co.z - z_min) / z_span
                    loop[uv_layer].uv = (u, v)
                elif uv_mode == "leg_sock":
                    ang = math.atan2(-co.y, co.x)
                    u = (ang / (2.0 * math.pi)) % 1.0
                    v = (co.z - z_min) / z_span
                    loop[uv_layer].uv = (u, v)
                else:
                    xs = sub_verts[:, 0]
                    x_min, x_max = float(np.min(xs)), float(np.max(xs))
                    x_span = max(0.05, x_max - x_min)
                    loop[uv_layer].uv = ((co.x - x_min) / x_span, (co.z - z_min) / z_span)
        except ValueError:
            pass

    # Smooth boundary edge loops (cuffs, hems, collars, helmet rims) to eliminate sawtooth polygon edges
    bm.edges.ensure_lookup_table()
    for _ in range(4):
        boundary_verts = {v for e in bm.edges if e.is_boundary for v in e.verts}
        if not boundary_verts:
            break
        updates = {}
        for v in boundary_verts:
            b_nbrs = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(b_nbrs) >= 2:
                avg = sum((nb.co for nb in b_nbrs), Vector((0, 0, 0))) / len(b_nbrs)
                updates[v] = v.co.lerp(avg, 0.55)
        for v, new_co in updates.items():
            v.co = new_co

    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True

    assign_weights_to_object(obj, used_orig, weights_dict, bone_names)

    if solidify_m > 0.0:
        mod = obj.modifiers.new(name="Solidify", type="SOLIDIFY")
        mod.thickness = solidify_m
        mod.offset = 1.0
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier="Solidify")

    return obj


def compute_vertex_normals(verts: np.ndarray, faces: list) -> np.ndarray:
    normals = np.zeros_like(verts)
    for fv, _ in faces:
        if len(fv) < 3:
            continue
        p0, p1, p2 = verts[fv[0]], verts[fv[1]], verts[fv[2]]
        n = np.cross(p1 - p0, p2 - p0)
        for vi in fv:
            normals[vi] += n
    norms = np.linalg.norm(normals, axis=1, keepdims=True)
    norms[norms < 1e-8] = 1.0
    return normals / norms


def build_armature(name: str, rig_json: dict, morphed_bl: np.ndarray, cubes: dict) -> tuple[bpy.types.Object, list[str]]:
    arm_data = bpy.data.armatures.new(f"{name}_armature")
    arm_obj = bpy.data.objects.new(f"{name}_rig", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")

    bone_keys = [
        k for k in rig_json.keys()
        if k not in ("copyright", "description", "license", "name", "version")
    ]

    def resolve_pos(spec: dict) -> Vector:
        strategy = spec.get("strategy", "CUBE")
        if strategy == "CUBE" and spec.get("cube_name") in cubes:
            pts = morphed_bl[list(cubes[spec["cube_name"]])]
            c = np.mean(pts, axis=0)
            return Vector((float(c[0]), float(c[1]), float(c[2])))
        if strategy == "MEAN" and spec.get("vertex_indices"):
            pts = morphed_bl[spec["vertex_indices"]]
            c = np.mean(pts, axis=0)
            return Vector((float(c[0]), float(c[1]), float(c[2])))
        dp = spec.get("default_position", [0, 0, 0])
        return Vector((float(dp[0]), float(dp[1]), float(dp[2]) + 0.8183))

    edit_bones = {}
    for bname in bone_keys:
        bdata = rig_json[bname]
        eb = arm_data.edit_bones.new(bname)
        head = resolve_pos(bdata["head"])
        tail = resolve_pos(bdata["tail"])
        if (tail - head).length < 0.005:
            tail = head + Vector((0, 0, 0.03))
        eb.head = head
        eb.tail = tail
        eb.roll = float(bdata.get("roll", 0.0))
        edit_bones[bname] = eb

    for bname in bone_keys:
        parent_name = rig_json[bname].get("parent", "")
        if parent_name and parent_name in edit_bones:
            edit_bones[bname].parent = edit_bones[parent_name]
            edit_bones[bname].use_connect = False

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj, bone_keys


def create_eye_mesh(name: str, verts_bl: np.ndarray, faces: list, mat: bpy.types.Material, bone_name: str, arm_obj: bpy.types.Object) -> bpy.types.Object:
    used = sorted({vi for fv, _ in faces for vi in fv})
    sub = verts_bl[used]
    center = np.mean(sub, axis=0)
    radius = max(0.01, float(np.max(np.linalg.norm(sub - center, axis=1))))
    orig_to_local = {ov: lv for lv, ov in enumerate(used)}

    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bm_verts = [bm.verts.new(v) for v in sub]
    bm.verts.ensure_lookup_table()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for fv, _ in faces:
        try:
            face = bm.faces.new([bm_verts[orig_to_local[i]] for i in fv])
            for loop in face.loops:
                d = loop.vert.co - Vector(center)
                # Forward face of eye points -Y in Blender; map frontal circle onto center of UV (0.5, 0.5)
                if d.y < 0.001:
                    u = 0.5 + (d.x / (radius * 2.0)) * 0.9
                    v = 0.5 + (d.z / (radius * 2.0)) * 0.9
                else:
                    u, v = 0.05, 0.05
                loop[uv_layer].uv = (u, v)
        except ValueError:
            pass
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    vg = obj.vertex_groups.new(name=bone_name)
    vg.add(list(range(len(used))), 1.0, "REPLACE")
    mod = obj.modifiers.new(name="Armature", type="ARMATURE")
    mod.object = arm_obj
    obj.parent = arm_obj
    return obj


def bind_to_armature(obj: bpy.types.Object, arm_obj: bpy.types.Object):
    mod = obj.modifiers.new(name="Armature", type="ARMATURE")
    mod.object = arm_obj
    obj.parent = arm_obj


def extract_bisected_garment(
    name: str,
    verts_xyz: np.ndarray,
    body_faces: list,
    initial_predicate,
    bisect_planes: list[tuple[tuple, tuple]],
    offset_m: float,
    normals_xyz: np.ndarray,
    weights_dict: dict,
    bone_names: list[str],
    mat: bpy.types.Material,
    uv_mode: str = "cylindrical",
    solidify_m: float = 0.0,
) -> bpy.types.Object:
    """Extracts an anatomical garment region slightly oversized, slices crisp tailor-straight
    boundary cuffs/hems with bmesh.ops.bisect_plane, transfers nearest-body-vertex skinning weights,
    pushes outward cleanly, and solidifies thickness."""
    selected = [f for f in body_faces if initial_predicate([verts_xyz[i] for i in f[0]])]
    used_orig = sorted({vi for fv, _ in selected for vi in fv})
    orig_to_local = {ov: lv for lv, ov in enumerate(used_orig)}

    sub_verts = verts_xyz[used_orig] + normals_xyz[used_orig] * offset_m
    orig_positions = verts_xyz[used_orig]

    bm = bmesh.new()
    bm_verts = [bm.verts.new(v) for v in sub_verts]
    bm.verts.ensure_lookup_table()
    for fv, _ in selected:
        try:
            bm.faces.new([bm_verts[orig_to_local[i]] for i in fv])
        except ValueError:
            pass

    # Slice clean planar seams (no sawtooth polygon hems/cuffs!)
    for plane_co, plane_no in bisect_planes:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(
            bm,
            geom=geom,
            plane_co=Vector(plane_co),
            plane_no=Vector(plane_no),
            clear_outer=True,
            clear_inner=False,
        )

    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    all_co = np.array([[v.co.x, v.co.y, v.co.z] for v in bm.verts], dtype=np.float64) if len(bm.verts) > 0 else np.zeros((1, 3))
    z_min, z_max = float(np.min(all_co[:, 2])), float(np.max(all_co[:, 2]))
    x_min, x_max = float(np.min(all_co[:, 0])), float(np.max(all_co[:, 0]))
    z_span = max(0.05, z_max - z_min)
    x_span = max(0.05, x_max - x_min)

    for face in bm.faces:
        for loop in face.loops:
            co = loop.vert.co
            if uv_mode in ("cylindrical", "leg_sock"):
                ang = math.atan2(-co.y, co.x)
                u = (ang / (2.0 * math.pi)) % 1.0
                v = (co.z - z_min) / z_span
                loop[uv_layer].uv = (u, v)
            else:
                loop[uv_layer].uv = ((co.x - x_min) / x_span, (co.z - z_min) / z_span)

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True

    # Map every bisected vertex to its nearest original body vertex for exact smooth skin weights
    nearest_orig = []
    search_pts = orig_positions + normals_xyz[used_orig] * offset_m
    for v in obj.data.vertices:
        d2 = np.sum((search_pts - np.array([v.co.x, v.co.y, v.co.z])) ** 2, axis=1)
        nearest_orig.append(used_orig[int(np.argmin(d2))])

    assign_weights_to_object(obj, nearest_orig, weights_dict, bone_names)

    if solidify_m > 0.0:
        mod = obj.modifiers.new(name="Solidify", type="SOLIDIFY")
        mod.thickness = solidify_m
        mod.offset = 1.0
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier="Solidify")

    return obj


def build_athletic_turf_shoes(
    prefix: str,
    morphed_bl: np.ndarray,
    arm_obj: bpy.types.Object,
    mat_shoe: bpy.types.Material,
    mat_sole: bpy.types.Material,
    mat_trim: bpy.types.Material,
):
    """Builds smooth, sculpted rounded athletic field-hockey turf shoes (convex-hull toe box +
    ankle collar + gold trim + molded turf outsole) — completely enclosing toes inside."""
    body_pts = morphed_bl[:13380]
    for side, foot_bone, ball_bone, label in [(1, "foot_l", "ball_l", "L"), (-1, "foot_r", "ball_r", "R")]:
        mask = (body_pts[:, 2] < 0.095) & (body_pts[:, 0] * side > 0.03)
        pts = body_pts[mask]
        min_x, max_x = float(np.min(pts[:, 0])), float(np.max(pts[:, 0]))
        min_y, max_y = float(np.min(pts[:, 1])), float(np.max(pts[:, 1]))
        cx, cy = (min_x + max_x) * 0.5, (min_y + max_y) * 0.5
        w, l = (max_x - min_x) * 1.12, (max_y - min_y) * 1.08

        # Sculpted rounded shoe upper built via convex hull of expanded foot cloud + bevel/subsurf
        bm = bmesh.new()
        expanded = pts.copy()
        expanded[:, 0] = cx + (expanded[:, 0] - cx) * 1.10
        expanded[:, 1] = cy + (expanded[:, 1] - cy) * 1.07
        expanded[:, 2] = np.clip(expanded[:, 2] + 0.014, 0.018, 0.105)
        for p in expanded:
            bm.verts.new((float(p[0]), float(p[1]), float(p[2])))
        bmesh.ops.convex_hull(bm, input=bm.verts[:])
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
        for v in bm.verts:
            # Round & slightly taper nose downward at toe end (-Y is forward in Blender)
            if v.co.y < cy - l * 0.15 and v.co.z > 0.045:
                v.co.z -= (cy - l * 0.15 - v.co.y) * 0.16

        shoe_mesh = bpy.data.meshes.new(f"{prefix}_shoe_upper_{label}")
        bm.to_mesh(shoe_mesh)
        bm.free()
        shoe_obj = bpy.data.objects.new(f"{prefix}_shoe_upper_{label}", shoe_mesh)
        bpy.context.collection.objects.link(shoe_obj)
        shoe_obj.data.materials.append(mat_shoe)
        for p in shoe_obj.data.polygons:
            p.use_smooth = True

        # Skin heel/ankle vertices to foot_bone and forefoot/toe vertices to ball_bone
        vg_foot = shoe_obj.vertex_groups.new(name=foot_bone)
        vg_ball = shoe_obj.vertex_groups.new(name=ball_bone)
        for vi, v in enumerate(shoe_obj.data.vertices):
            t_toe = max(0.0, min(1.0, (cy - v.co.y) / max(0.04, l * 0.45) + 0.35))
            vg_ball.add([vi], t_toe, "REPLACE")
            vg_foot.add([vi], 1.0 - t_toe, "REPLACE")
        bind_to_armature(shoe_obj, arm_obj)

        # Dark Molded Turf Cleat Outsole resting flush at z = 0.0
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.5, depth=0.022, location=(cx, cy, 0.011))
        sole = bpy.context.active_object
        sole.name = f"{prefix}_sole_{label}"
        sole.scale = (w * 1.02, l * 1.02, 1.0)
        bpy.ops.object.transform_apply(scale=True)
        sole.data.materials.append(mat_sole)
        vg_s = sole.vertex_groups.new(name=ball_bone)
        vg_s.add(list(range(len(sole.data.vertices))), 1.0, "REPLACE")
        bind_to_armature(sole, arm_obj)

        # Gold side athletic flash on shoe
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(cx, cy + 0.01, 0.042))
        flash = bpy.context.active_object
        flash.name = f"{prefix}_shoe_trim_{label}"
        flash.scale = (w * 1.03, l * 0.55, 0.016)
        bpy.ops.object.transform_apply(scale=True)
        flash.data.materials.append(mat_trim)
        vg_f = flash.vertex_groups.new(name=foot_bone)
        vg_f.add(list(range(len(flash.data.vertices))), 1.0, "REPLACE")
        bind_to_armature(flash, arm_obj)


def build_keeper_gear(
    arm_obj: bpy.types.Object,
    morphed_bl: np.ndarray,
    body_faces: list,
    normals_bl: np.ndarray,
    weights_dict: dict,
    bone_names: list[str],
    rig_json: dict,
    cubes: dict,
    mat_pads: bpy.types.Material,
    mat_helmet: bpy.types.Material,
    mat_cage: bpy.types.Material,
    mat_glove: bpy.types.Material,
):
    # 1. Contoured Field-Hockey Helmet Shell + Curved Steel Wire Face Cage (skinned to head bone)
    head_pts = morphed_bl[:13380]
    head_mask = head_pts[:, 2] > 1.50
    hc = np.mean(head_pts[head_mask], axis=0)
    # Build shell from scalp/ear/jaw head faces leaving an open front viewport for face & eyes!
    helmet = extract_submesh_by_face_mask(
        "gk_helmet_shell",
        morphed_bl,
        body_faces,
        lambda pts: (
            all(p[2] > 1.49 for p in pts)
            and not (
                sum(p[1] for p in pts) / len(pts) < hc[1] - 0.025
                and 1.54 < sum(p[2] for p in pts) / len(pts) < 1.69
                and abs(sum(p[0] for p in pts) / len(pts)) < 0.075
            )
        ),
        0.018,
        normals_bl,
        weights_dict,
        bone_names,
        mat_helmet,
        uv_mode="planar",
        solidify_m=0.008,
    )
    bind_to_armature(helmet, arm_obj)

    # Steel Face Cage Wires spanning front face opening
    cage_parts = []
    face_y = float(np.min(head_pts[head_mask][:, 1])) - 0.024
    for i in range(-2, 3):
        x = i * 0.024
        curve_y = face_y + abs(i) * 0.009
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.0028, depth=0.14, location=(x, curve_y, 1.60))
        bar = bpy.context.active_object
        cage_parts.append(bar)
    for z in (1.555, 1.595, 1.635):
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.0028, depth=0.115, location=(0.0, face_y + 0.005, z))
        hbar = bpy.context.active_object
        hbar.rotation_euler = (0.0, math.pi * 0.5, 0.0)
        cage_parts.append(hbar)

    for c_obj in cage_parts:
        c_obj.select_set(True)
    bpy.context.view_layer.objects.active = cage_parts[0]
    bpy.ops.object.join()
    cage = bpy.context.active_object
    cage.name = "gk_face_cage"
    cage.data.materials.append(mat_cage)
    vg = cage.vertex_groups.new(name="head")
    vg.add(list(range(len(cage.data.vertices))), 1.0, "REPLACE")
    bind_to_armature(cage, arm_obj)

    # 2. Ergonomic Field-Hockey Leg Guards wrapped over human shins & knees (skinned to calf + thigh)
    for side_sign, calf_bone, side_label in [(1, "calf_l", "L"), (-1, "calf_r", "R")]:
        guard = extract_submesh_by_face_mask(
            f"gk_legguard_{side_label}",
            morphed_bl,
            body_faces,
            lambda pts, s=side_sign: (
                all(0.10 < p[2] < 0.58 and p[0] * s > 0.015 for p in pts)
                and sum(p[1] for p in pts) / len(pts) < 0.055
            ),
            0.032,
            normals_bl,
            weights_dict,
            bone_names,
            mat_pads,
            uv_mode="planar",
            solidify_m=0.018,
        )
        # Widen slightly laterally on outer edge for authentic rectangular field-hockey guard silhouette
        for v in guard.data.vertices:
            v.co.x += side_sign * 0.014
            v.co.y -= 0.014
        bind_to_armature(guard, arm_obj)

        # Foam toe kicker contoured smoothly around turf shoe
        kicker = extract_submesh_by_face_mask(
            f"gk_kicker_{side_label}",
            morphed_bl,
            body_faces,
            lambda pts, s=side_sign: all(0.012 < p[2] < 0.145 and p[0] * s > 0.015 for p in pts),
            0.025,
            normals_bl,
            weights_dict,
            bone_names,
            mat_pads,
            uv_mode="planar",
            solidify_m=0.012,
        )
        bind_to_armature(kicker, arm_obj)

    # 3. Left-Hand Flat Rectangular Field-Hockey Hand Protector / Deflector (covers entire hand_l & fingers)
    hand_l_pts = morphed_bl[list(cubes["joint-l-hand"])]
    hl = np.mean(hand_l_pts, axis=0)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(float(hl[0]) + 0.015, float(hl[1]) - 0.055, float(hl[2]) - 0.02))
    blocker = bpy.context.active_object
    blocker.name = "gk_left_blocker"
    blocker.scale = (0.075, 0.21, 0.32)
    bpy.ops.object.transform_apply(scale=True)
    bev = blocker.modifiers.new(name="Bevel", type="BEVEL")
    bev.width = 0.014
    bev.segments = 3
    bpy.context.view_layer.objects.active = blocker
    bpy.ops.object.modifier_apply(modifier="Bevel")
    if blocker.data.uv_layers:
        uv_l = blocker.data.uv_layers.active.data
        vs = blocker.data.vertices
        ys_b = [v.co.y for v in vs]
        zs_b = [v.co.z for v in vs]
        ymin, ymax = min(ys_b), max(ys_b)
        zmin, zmax = min(zs_b), max(zs_b)
        for poly in blocker.data.polygons:
            for li in poly.loop_indices:
                v = vs[blocker.data.loops[li].vertex_index]
                uv_l[li].uv = ((v.co.y - ymin) / max(0.01, ymax - ymin), (v.co.z - zmin) / max(0.01, zmax - zmin))
    blocker.data.materials.append(mat_pads)
    vg_bl = blocker.vertex_groups.new(name="hand_l")
    vg_bl.add(list(range(len(blocker.data.vertices))), 1.0, "REPLACE")
    bind_to_armature(blocker, arm_obj)

    # 4. Right-Hand Padded Field-Hockey Stick Glove/Mit (beveled cuff fully enclosing right fingers)
    hand_r_pts = morphed_bl[list(cubes["joint-r-hand"])]
    hr = np.mean(hand_r_pts, axis=0)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(float(hr[0]) - 0.01, float(hr[1]) - 0.025, float(hr[2]) - 0.04))
    rglove = bpy.context.active_object
    rglove.name = "gk_right_stick_glove"
    rglove.scale = (0.125, 0.16, 0.19)
    bpy.ops.object.transform_apply(scale=True)
    bev_r = rglove.modifiers.new(name="Bevel", type="BEVEL")
    bev_r.width = 0.028
    bev_r.segments = 3
    bpy.context.view_layer.objects.active = rglove
    bpy.ops.object.modifier_apply(modifier="Bevel")
    rglove.data.materials.append(mat_glove)
    vg_rg = rglove.vertex_groups.new(name="hand_r")
    vg_rg.add(list(range(len(rglove.data.vertices))), 1.0, "REPLACE")
    bind_to_armature(rglove, arm_obj)


def build_character(cfg: dict, base_verts, base_uvs, groups, cubes, rig_json, weights_dict):
    bpy.ops.wm.read_factory_settings(use_empty=True)

    morphed_mh = base_verts.copy()
    for target_name, weight in cfg["morphs"]:
        morphed_mh = apply_morph_target(morphed_mh, SRC_DIR / target_name, weight)

    morphed_bl, _ = mh_to_blender_coords(morphed_mh)
    body_faces = groups["body"]
    normals_bl = compute_vertex_normals(morphed_bl, body_faces)

    # Generate embedded textures & PBR materials
    skin_img = generate_skin_texture(f"{cfg['id']}_skin", cfg["skin_rgb"], cfg["lip_rgb"])
    eye_img = generate_eye_texture(f"{cfg['id']}_eye", cfg["iris_rgb"])
    jersey_img = generate_jersey_texture(f"{cfg['id']}_jersey", cfg["number"], cfg["is_keeper"])
    socks_img = generate_socks_texture(f"{cfg['id']}_socks")

    mat_skin = create_pbr_mat(f"{cfg['id']}_mat_skin", skin_img, roughness=0.56)
    mat_eye = create_pbr_mat(f"{cfg['id']}_mat_eye", eye_img, roughness=0.14)
    mat_hair = create_pbr_mat(f"{cfg['id']}_mat_hair", None, base_color=cfg["hair_rgba"], roughness=0.72)
    mat_jersey = create_pbr_mat(f"{cfg['id']}_mat_jersey", jersey_img, roughness=0.78)
    mat_shorts = create_pbr_mat(f"{cfg['id']}_mat_shorts", None, base_color=(0.03, 0.08, 0.21, 1.0), roughness=0.80)
    mat_socks = create_pbr_mat(f"{cfg['id']}_mat_socks", socks_img, roughness=0.82)
    mat_shoe = create_pbr_mat(f"{cfg['id']}_mat_shoe", None, base_color=(0.08, 0.24, 0.56, 1.0), roughness=0.45)
    mat_sole = create_pbr_mat(f"{cfg['id']}_mat_sole", None, base_color=(0.05, 0.06, 0.08, 1.0), roughness=0.72)

    # Armature
    arm_obj, bone_names = build_armature(cfg["id"], rig_json, morphed_bl, cubes)

    # Human body mesh (retract foot vertices slightly inside shoe upper so bare toes never poke through)
    body_used = sorted({vi for fv, _ in body_faces for vi in fv})
    body_verts_adj = morphed_bl[: max(body_used) + 1].copy()
    foot_v_mask = body_verts_adj[:, 2] < 0.088
    body_verts_adj[foot_v_mask, 2] += 0.008
    body_verts_adj[foot_v_mask, 1] *= 0.88
    body_obj = build_mesh_object(f"{cfg['id']}_body", body_verts_adj, body_faces, base_uvs, mat_skin)
    assign_weights_to_object(body_obj, list(range(len(body_obj.data.vertices))), weights_dict, bone_names)
    bind_to_armature(body_obj, arm_obj)

    # Sculpted Eyes
    create_eye_mesh(f"{cfg['id']}_eye_l", morphed_bl, groups["helper-l-eye"], mat_eye, "head", arm_obj)
    create_eye_mesh(f"{cfg['id']}_eye_r", morphed_bl, groups["helper-r-eye"], mat_eye, "head", arm_obj)

    # Anatomical Heights for Tailored Garment Extraction
    def cube_z(cname: str) -> float:
        pts = morphed_bl[list(cubes[cname])]
        return float(np.mean(pts[:, 2]))

    pelvis_z = cube_z("joint-pelvis")
    neck_z = cube_z("joint-neck")
    knee_z = cube_z("joint-l-knee")
    ankle_z = cube_z("joint-l-ankle")
    head_pts = morphed_bl[list(cubes["joint-head"])]
    head_cy = float(np.mean(head_pts[:, 1]))
    head_cz = float(np.mean(head_pts[:, 2]))

    # Natural Hair Cap extracted from scalp above brow/ears
    if not cfg["is_keeper"]:
        hair_obj = extract_submesh_by_face_mask(
            f"{cfg['id']}_hair",
            morphed_bl,
            body_faces,
            lambda pts: (
                all(p[2] > head_cz + 0.015 for p in pts)
                and (sum(p[2] for p in pts) / len(pts) > head_cz + 0.06 or sum(p[1] for p in pts) / len(pts) > head_cy + 0.015)
            ),
            0.004,
            normals_bl,
            weights_dict,
            bone_names,
            mat_hair,
            uv_mode="planar",
            solidify_m=0.013,
        )
        bind_to_armature(hair_obj, arm_obj)

        if cfg.get("is_female", False):
            # Sculpted athletic ponytail attached cleanly at occiput (+Y back, -Z down in Blender coords)
            pt_curve = bpy.data.curves.new(f"{cfg['id']}_ponytail_curve", type="CURVE")
            pt_curve.dimensions = "3D"
            pt_curve.bevel_depth = 0.028
            pt_curve.bevel_resolution = 6
            pt_curve.resolution_u = 14
            pt_curve.use_fill_caps = True

            pts = [
                (0.0, head_cy + 0.055, head_cz + 0.025, 0.42),
                (0.0, head_cy + 0.085, head_cz + 0.015, 0.72),
                (0.0, head_cy + 0.125, head_cz - 0.025, 1.05),
                (0.0, head_cy + 0.145, head_cz - 0.095, 0.92),
                (0.0, head_cy + 0.140, head_cz - 0.170, 0.42),
            ]
            spline = pt_curve.splines.new("NURBS")
            spline.points.add(len(pts) - 1)
            for i, (px, py, pz, rad) in enumerate(pts):
                spline.points[i].co = (px, py, pz, 1.0)
                spline.points[i].radius = rad
            spline.use_endpoint_u = True

            pt_obj = bpy.data.objects.new(f"{cfg['id']}_ponytail", pt_curve)
            bpy.context.collection.objects.link(pt_obj)
            pt_obj.select_set(True)
            bpy.context.view_layer.objects.active = pt_obj
            bpy.ops.object.convert(target="MESH")
            pt_mesh_obj = bpy.context.active_object
            pt_mesh_obj.data.materials.append(mat_hair)
            for p in pt_mesh_obj.data.polygons:
                p.use_smooth = True
            vg_pt = pt_mesh_obj.vertex_groups.new(name="head")
            vg_pt.add(list(range(len(pt_mesh_obj.data.vertices))), 1.0, "REPLACE")
            bind_to_armature(pt_mesh_obj, arm_obj)

            # Gold elastic hair tie ring at base of ponytail
            mat_headband = create_pbr_mat(
                f"{cfg['id']}_mat_headband",
                None,
                base_color=(0.95, 0.74, 0.12, 1.0),
                metallic=0.05,
                roughness=0.55,
            )
            bpy.ops.mesh.primitive_torus_add(
                major_radius=0.024,
                minor_radius=0.006,
                location=(0.0, head_cy + 0.088, head_cz + 0.014),
                rotation=(math.radians(65), 0.0, 0.0),
            )
            tie_obj = bpy.context.active_object
            tie_obj.name = f"{cfg['id']}_ponytail_tie"
            tie_obj.data.materials.append(mat_headband)
            vg_tie = tie_obj.vertex_groups.new(name="head")
            vg_tie.add(list(range(len(tie_obj.data.vertices))), 1.0, "REPLACE")
            bind_to_armature(tie_obj, arm_obj)

            # Fitted athletic headband extracted above brow & wrapped cleanly over hair
            eye_z = float(np.max(morphed_bl[[vi for fv, _ in groups["helper-l-eye"] for vi in fv], 2]))
            band_bot_z = eye_z + 0.022
            band_top_z = band_bot_z + 0.028
            headband_obj = extract_bisected_garment(
                f"{cfg['id']}_headband",
                morphed_bl,
                body_faces,
                lambda pts: any(band_bot_z - 0.03 <= p[2] <= band_top_z + 0.03 for p in pts),
                [
                    ((0, 0, band_bot_z), (0, -0.25, -1.0)),
                    ((0, 0, band_top_z), (0, 0.25, 1.0)),
                ],
                0.012,
                normals_bl,
                weights_dict,
                bone_names,
                mat_headband,
                uv_mode="planar",
                solidify_m=0.003,
            )
            bind_to_armature(headband_obj, arm_obj)

    # Tailored Uddingston Jersey / Goalkeeper Smock (razor-clean bisected waist & bicep cuffs)
    j_offset = 0.015 if cfg["is_keeper"] else 0.007
    sleeve_x = 0.34 if cfg["is_keeper"] else 0.30
    jersey_obj = extract_bisected_garment(
        f"{cfg['id']}_jersey",
        morphed_bl,
        body_faces,
        lambda pts: any((pelvis_z - 0.02) <= p[2] <= (neck_z + 0.03) and abs(p[0]) <= sleeve_x + 0.05 for p in pts),
        [
            ((0, 0, pelvis_z + 0.025), (0, 0, -1)),       # Straight waist hem
            ((0, 0, neck_z - 0.01), (0, 0, 1)),           # Clean collar neckline
            ((sleeve_x, 0, 0), (1, 0, 0)),                # Straight left sleeve cuff
            ((-sleeve_x, 0, 0), (-1, 0, 0)),              # Straight right sleeve cuff
        ],
        j_offset,
        normals_bl,
        weights_dict,
        bone_names,
        mat_jersey,
        uv_mode="cylindrical",
        solidify_m=0.004,
    )
    bind_to_armature(jersey_obj, arm_obj)

    # Tailored Athletic Shorts / Women's Hockey Skort Cut (clean horizontal waist & mid-thigh hems)
    shorts_bottom = knee_z + (0.175 if cfg.get("is_female", False) else 0.14)
    shorts_top = pelvis_z + 0.09
    shorts_obj = extract_bisected_garment(
        f"{cfg['id']}_shorts",
        morphed_bl,
        body_faces,
        lambda pts: any((shorts_bottom - 0.05) <= p[2] <= (shorts_top + 0.05) and abs(p[0]) <= 0.28 for p in pts),
        [
            ((0, 0, shorts_bottom), (0, 0, -1)),          # Straight thigh cuff
            ((0, 0, shorts_top), (0, 0, 1)),              # Clean waistband
        ],
        0.009 if cfg["is_keeper"] else 0.006,
        normals_bl,
        weights_dict,
        bone_names,
        mat_shorts,
        uv_mode="cylindrical",
        solidify_m=0.0035,
    )
    bind_to_armature(shorts_obj, arm_obj)

    # Fitted Knee-High Hooped Hockey Socks (clean straight below-knee band)
    socks_top = knee_z - 0.025
    socks_bot = ankle_z - 0.02
    socks_obj = extract_bisected_garment(
        f"{cfg['id']}_socks",
        morphed_bl,
        body_faces,
        lambda pts: any((socks_bot - 0.04) <= p[2] <= (socks_top + 0.04) for p in pts),
        [
            ((0, 0, socks_bot), (0, 0, -1)),
            ((0, 0, socks_top), (0, 0, 1)),
        ],
        0.004,
        normals_bl,
        weights_dict,
        bone_names,
        mat_socks,
        uv_mode="leg_sock",
        solidify_m=0.0025,
    )
    bind_to_armature(socks_obj, arm_obj)

    # Smooth Rounded Athletic Turf Shoes + Molded Turf Soles (zero individual toes)
    mat_shoe_trim = create_pbr_mat(f"{cfg['id']}_mat_shoe_trim", None, base_color=(0.95, 0.74, 0.12, 1.0), metallic=0.1, roughness=0.35)
    build_athletic_turf_shoes(cfg["id"], morphed_bl, arm_obj, mat_shoe, mat_sole, mat_shoe_trim)

    # Goalkeeper-specific fitted outdoor field-hockey kit
    if cfg["is_keeper"]:
        pad_img = generate_keeper_pad_texture(f"{cfg['id']}_pads")
        mat_pads = create_pbr_mat(f"{cfg['id']}_mat_pads", pad_img, roughness=0.40)
        mat_helmet = create_pbr_mat(f"{cfg['id']}_mat_helmet", None, base_color=(0.045, 0.145, 0.36, 1.0), metallic=0.15, roughness=0.22)
        mat_cage = create_pbr_mat(f"{cfg['id']}_mat_cage", None, base_color=(0.82, 0.85, 0.89, 1.0), metallic=0.88, roughness=0.20)
        mat_glove = create_pbr_mat(f"{cfg['id']}_mat_glove", None, base_color=(0.07, 0.10, 0.16, 1.0), roughness=0.50)
        build_keeper_gear(
            arm_obj,
            morphed_bl,
            body_faces,
            normals_bl,
            weights_dict,
            bone_names,
            rig_json,
            cubes,
            mat_pads,
            mat_helmet,
            mat_cage,
            mat_glove,
        )

    # Save .blend source and export .glb runtime asset
    blend_path = BLEND_DIR / f"{cfg['id']}.blend"
    glb_path = OUT_GLB_DIR / f"{cfg['id']}.glb"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        export_yup=True,
        export_skins=True,
        export_apply=False,
    )
    print(f"Exported {glb_path} ({glb_path.stat().st_size} bytes)")


def build_hockey_stick_glb():
    """Creates a clean high-detail field-hockey stick .glb with origin at top handle grip (0,0,0),
    extending down -Y (0.94m) and curving into a flat-left-face J-hook toward +Z."""
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Carbon shaft & J-hook curve in Blender Z-up before Y-up export:
    # Actually let's build in Blender (X, Y, Z) such that glTF Y-up has handle at (0,0,0), shaft down -Y, hook curving +Z / -X!
    # Remember Blender -> glTF: (bx, by, bz) -> (bx, bz, -by). So glTF -Y = Blender -Z, glTF +Z = Blender -Y!
    curve_data = bpy.data.curves.new("stick_curve", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.bevel_depth = 0.0155
    curve_data.bevel_resolution = 6
    curve_data.resolution_u = 16
    curve_data.use_fill_caps = True

    pts = [
        (0.0, 0.0, 0.0, 0.90),        # Top handle grip
        (0.0, 0.0, -0.34, 0.92),      # End of grip
        (0.0, 0.0, -0.78, 1.05),      # Lower shaft taper
        (-0.012, -0.025, -0.87, 1.18),# Bow start
        (-0.040, -0.065, -0.915, 1.24),
        (-0.078, -0.100, -0.922, 1.24),
        (-0.108, -0.105, -0.892, 1.12),
    ]
    spline = curve_data.splines.new("NURBS")
    spline.points.add(len(pts) - 1)
    for i, (x, y, z, rad) in enumerate(pts):
        spline.points[i].co = (x, y, z, 1.0)
        spline.points[i].radius = rad
    spline.use_endpoint_u = True

    stick_obj = bpy.data.objects.new("uddy_stick_shaft", curve_data)
    bpy.context.collection.objects.link(stick_obj)
    stick_obj.select_set(True)
    bpy.context.view_layer.objects.active = stick_obj
    bpy.ops.object.convert(target="MESH")
    stick_mesh = bpy.context.active_object
    # Flatten playing face slightly along Blender Y (= glTF Z)
    stick_mesh.scale = (1.0, 0.68, 1.0)
    bpy.ops.object.transform_apply(scale=True)

    mat_carbon = create_pbr_mat("stick_carbon", None, base_color=(0.06, 0.08, 0.11, 1.0), metallic=0.25, roughness=0.24)
    stick_mesh.data.materials.append(mat_carbon)

    # Wrapped grip sleeve around top 0.35m
    bpy.ops.mesh.primitive_cylinder_add(vertices=18, radius=0.0165, depth=0.35, location=(0.0, 0.0, -0.175))
    grip = bpy.context.active_object
    grip.name = "uddy_stick_grip"
    mat_grip = create_pbr_mat("stick_grip", None, base_color=(0.03, 0.035, 0.045, 1.0), roughness=0.82)
    grip.data.materials.append(mat_grip)

    # Gold club trim ring at grip collar
    bpy.ops.mesh.primitive_cylinder_add(vertices=18, radius=0.0172, depth=0.025, location=(0.0, 0.0, -0.355))
    ring = bpy.context.active_object
    ring.name = "uddy_stick_trim"
    mat_gold = create_pbr_mat("stick_gold", None, base_color=(0.95, 0.74, 0.12, 1.0), metallic=0.2, roughness=0.3)
    ring.data.materials.append(mat_gold)

    glb_path = OUT_GLB_DIR / "uddy_stick.glb"
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format="GLB", export_yup=True)
    print(f"Exported {glb_path} ({glb_path.stat().st_size} bytes)")


def main():
    base_verts, base_uvs, groups, cubes = load_base_obj(SRC_DIR / "base.obj")
    rig_json = json.loads((SRC_DIR / "rig.game_engine.json").read_text(encoding="utf-8"))
    weights_dict = json.loads((SRC_DIR / "weights.game_engine.json").read_text(encoding="utf-8"))["weights"]

    configs = [
        {
            "id": "uddy_attacker_a",
            "number": "9",
            "is_keeper": False,
            "is_female": False,
            "morphs": [
                ("caucasian-male-young.target.gz", 1.0),
                ("universal-male-young-maxmuscle-averageweight.target.gz", 0.65),
            ],
            "skin_rgb": (0.86, 0.68, 0.56),
            "lip_rgb": (0.72, 0.44, 0.40),
            "iris_rgb": (0.24, 0.42, 0.62),
            "hair_rgba": (0.12, 0.08, 0.05, 1.0),
        },
        {
            "id": "uddy_attacker_b",
            "number": "11",
            "is_keeper": False,
            "is_female": True,
            "morphs": [
                ("african-female-young.target.gz", 1.0),
                ("universal-female-young-maxmuscle-averageweight.target.gz", 0.65),
            ],
            "skin_rgb": (0.34, 0.20, 0.13),
            "lip_rgb": (0.26, 0.13, 0.11),
            "iris_rgb": (0.14, 0.09, 0.05),
            "hair_rgba": (0.03, 0.025, 0.02, 1.0),
        },
        {
            "id": "uddy_attacker_c",
            "number": "7",
            "is_keeper": False,
            "is_female": True,
            "morphs": [
                ("universal-female-young-maxmuscle-averageweight.target.gz", 1.0),
            ],
            "skin_rgb": (0.58, 0.39, 0.26),
            "lip_rgb": (0.48, 0.26, 0.24),
            "iris_rgb": (0.18, 0.12, 0.07),
            "hair_rgba": (0.06, 0.04, 0.03, 1.0),
        },
        {
            "id": "uddy_attacker_d",
            "number": "10",
            "is_keeper": False,
            "is_female": False,
            "morphs": [
                ("caucasian-male-young.target.gz", 0.5),
                ("universal-male-young-maxmuscle-averageweight.target.gz", 0.8),
            ],
            "skin_rgb": (0.36, 0.22, 0.14),
            "lip_rgb": (0.28, 0.15, 0.12),
            "iris_rgb": (0.14, 0.09, 0.05),
            "hair_rgba": (0.03, 0.025, 0.02, 1.0),
        },
        {
            "id": "uddy_goalkeeper",
            "number": "1",
            "is_keeper": True,
            "is_female": False,
            "morphs": [
                ("caucasian-male-young.target.gz", 1.0),
                ("universal-male-young-maxmuscle-averageweight.target.gz", 0.85),
            ],
            "skin_rgb": (0.84, 0.66, 0.54),
            "lip_rgb": (0.70, 0.42, 0.38),
            "iris_rgb": (0.22, 0.38, 0.28),
            "hair_rgba": (0.12, 0.08, 0.05, 1.0),
        },
    ]

    for cfg in configs:
        build_character(cfg, base_verts, base_uvs, groups, cubes, rig_json, weights_dict)
    build_hockey_stick_glb()


if __name__ == "__main__":
    main()
