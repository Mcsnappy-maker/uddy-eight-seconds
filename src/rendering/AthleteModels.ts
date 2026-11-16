import {
  Matrix,
  Mesh,
  Node,
  Quaternion,
  Scene,
  SceneLoader,
  ShadowGenerator,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { OrientedBoxCollider } from '../simulation/PhysicsWorld';
import { MaterialPalette } from './PBRMaterials';

export type AttackerVariant = 'variant_a' | 'variant_b';

export type KeeperPoseMode =
  | 'ready'
  | 'shuffle_left'
  | 'shuffle_right'
  | 'advance'
  | 'save_low_left'
  | 'save_low_right'
  | 'save_high_blocker'
  | 'save_stick_sweep'
  | 'recover';

interface BoneRestInfo {
  node: TransformNode;
  parentName: string | null;
  restLocalPos: Vector3;
  restLocalQuat: Quaternion;
  restModelQuat: Quaternion;
  restModelPos: Vector3;
}

/**
 * Wraps a loaded 53-bone glTF skeleton so bones can be posed cleanly in uniform
 * character-model space (+X = character left, +Y = up, +Z = forward) regardless of
 * MakeHuman's internal per-bone roll axes or Babylon's __root__ LH/RH transform.
 */
class SkinnedGltfRig {
  public readonly gltfRoot: TransformNode;
  public readonly meshes: Mesh[] = [];
  public readonly bones = new Map<string, BoneRestInfo>();
  private readonly orderedNames: string[] = [];
  private readonly currentModelQuat = new Map<string, Quaternion>();
  private readonly currentModelPos = new Map<string, Vector3>();

  constructor(gltfRoot: TransformNode, meshes: Mesh[]) {
    this.gltfRoot = gltfRoot;
    this.meshes = meshes;

    // Collect TransformNodes under gltfRoot that belong to skeleton bones
    const nodeByName = new Map<string, TransformNode>();
    const collect = (n: Node) => {
      if (n instanceof TransformNode && !(n instanceof Mesh)) {
        nodeByName.set(n.name, n);
      }
      for (const c of n.getChildren()) {
        collect(c);
      }
    };
    collect(gltfRoot);

    // Traverse top-down starting from 'Root' (or skeleton hierarchy)
    const visit = (tn: TransformNode, parentBoneName: string | null, pModelPos: Vector3, pModelQuat: Quaternion) => {
      const localPos = tn.position.clone();
      const localQuat = tn.rotationQuaternion ? tn.rotationQuaternion.clone() : Quaternion.FromEulerVector(tn.rotation);
      tn.rotationQuaternion = localQuat.clone();

      const rotatedOffset = new Vector3();
      localPos.rotateByQuaternionToRef(pModelQuat, rotatedOffset);
      const mPos = pModelPos.add(rotatedOffset);
      const mQuat = pModelQuat.multiply(localQuat).normalize();

      this.orderedNames.push(tn.name);
      this.bones.set(tn.name, {
        node: tn,
        parentName: parentBoneName,
        restLocalPos: localPos,
        restLocalQuat: localQuat,
        restModelPos: mPos,
        restModelQuat: mQuat,
      });
      this.currentModelPos.set(tn.name, mPos.clone());
      this.currentModelQuat.set(tn.name, mQuat.clone());

      for (const child of tn.getChildren()) {
        if (child instanceof TransformNode && !(child instanceof Mesh)) {
          visit(child, tn.name, mPos, mQuat);
        }
      }
    };

    const rootBone = nodeByName.get('Root');
    if (rootBone) {
      visit(rootBone, null, Vector3.Zero(), Quaternion.Identity());
    } else {
      // Fallback: find armature root
      for (const child of gltfRoot.getChildren()) {
        if (child instanceof TransformNode && !(child instanceof Mesh)) {
          visit(child, null, Vector3.Zero(), Quaternion.Identity());
        }
      }
    }
  }

  public getMeshTriangleStats(): { meshes: number; vertices: number; bones: number } {
    let vertices = 0;
    for (const m of this.meshes) {
      vertices += m.getTotalVertices();
    }
    return { meshes: this.meshes.length, vertices, bones: this.bones.size };
  }

  /**
   * Resets pose to rest, then applies hierarchical joint deltas (propagating parent rotations
   * through pelvis -> spine -> head and thigh -> calf -> foot) OR absolute model-space orientations
   * (for IK-solved limb segments).
   */
  public applyModelSpacePose(
    jointDeltas: Record<string, Quaternion>,
    absModelDeltas: Record<string, Quaternion>,
    pelvisOffset?: Vector3,
  ): void {
    for (const name of this.orderedNames) {
      const info = this.bones.get(name)!;
      const pQuat = info.parentName ? this.currentModelQuat.get(info.parentName)! : Quaternion.Identity();
      const pPos = info.parentName ? this.currentModelPos.get(info.parentName)! : Vector3.Zero();

      const offsetLocal =
        name === 'pelvis' && pelvisOffset
          ? info.restLocalPos.add(pelvisOffset)
          : info.restLocalPos;

      const rotOffset = new Vector3();
      offsetLocal.rotateByQuaternionToRef(pQuat, rotOffset);
      const mPos = pPos.add(rotOffset);

      const baseModelQuat = pQuat.multiply(info.restLocalQuat).normalize();
      let targetModelQuat = baseModelQuat;
      if (absModelDeltas[name]) {
        targetModelQuat = absModelDeltas[name].multiply(info.restModelQuat).normalize();
      } else if (jointDeltas[name]) {
        targetModelQuat = jointDeltas[name].multiply(baseModelQuat).normalize();
      }

      const invParent = Quaternion.Inverse(pQuat);
      const newLocalQuat = invParent.multiply(targetModelQuat).normalize();

      info.node.position.copyFrom(offsetLocal);
      info.node.rotationQuaternion!.copyFrom(newLocalQuat);
      this.currentModelPos.set(name, mPos);
      this.currentModelQuat.set(name, targetModelQuat);
    }
  }

  public getModelPos(boneName: string): Vector3 {
    return (this.currentModelPos.get(boneName) ?? Vector3.Zero()).clone();
  }

  public getRestModelPos(boneName: string): Vector3 {
    return (this.bones.get(boneName)?.restModelPos ?? Vector3.Zero()).clone();
  }

  /**
   * Solves two-bone limb IK in character-model space (+X left, +Y up, +Z forward)
   * and inserts upper + lower bone delta quaternions into rotDeltas.
   */
  public solveLimbToModelTarget(
    upperBone: string,
    lowerBone: string,
    endBone: string,
    targetModelPos: Vector3,
    poleHintModel: Vector3,
    rotDeltas: Record<string, Quaternion>,
  ): void {
    const shPos = this.getModelPos(upperBone);
    const elRest = this.getRestModelPos(lowerBone);
    const shRest = this.getRestModelPos(upperBone);
    const endRest = this.getRestModelPos(endBone);

    const restUpperVec = elRest.subtract(shRest);
    const restForeVec = endRest.subtract(elRest);
    const upperLen = Math.max(0.05, restUpperVec.length());
    const foreLen = Math.max(0.05, restForeVec.length());

    const toTarget = targetModelPos.subtract(shPos);
    const rawDist = toTarget.length();
    const maxReach = upperLen + foreLen - 0.008;
    const minReach = Math.abs(upperLen - foreLen) + 0.02;
    const dist = Math.max(minReach, Math.min(maxReach, rawDist));
    const dir = rawDist > 1e-5 ? toTarget.scale(1 / rawDist) : new Vector3(0, -1, 0);

    const cosSh = Math.max(
      -1,
      Math.min(1, (upperLen * upperLen + dist * dist - foreLen * foreLen) / (2 * upperLen * dist)),
    );
    const sinSh = Math.sqrt(Math.max(0, 1 - cosSh * cosSh));

    const proj = dir.scale(Vector3.Dot(poleHintModel, dir));
    let bendAxis = poleHintModel.subtract(proj);
    if (bendAxis.lengthSquared() < 1e-6) {
      bendAxis = new Vector3(0, 0, -1);
    } else {
      bendAxis.normalize();
    }

    const upperDir = dir.scale(cosSh).add(bendAxis.scale(sinSh)).normalize();
    const elbowTarget = shPos.add(upperDir.scale(upperLen));
    const foreDir = targetModelPos.subtract(elbowTarget).normalize();

    const qUpper = new Quaternion();
    Quaternion.FromUnitVectorsToRef(restUpperVec.normalize(), upperDir, qUpper);
    const qFore = new Quaternion();
    Quaternion.FromUnitVectorsToRef(restForeVec.normalize(), foreDir, qFore);

    rotDeltas[upperBone] = qUpper;
    rotDeltas[lowerBone] = qFore;
  }
}

function registerGltfShadows(meshes: Mesh[], shadowGen?: ShadowGenerator): void {
  for (const m of meshes) {
    m.receiveShadows = true;
    if (shadowGen && m.getTotalVertices() > 0) {
      shadowGen.addShadowCaster(m, false);
    }
  }
}

async function loadCharacterGltf(
  filename: string,
  scene: Scene,
  parentRoot: TransformNode,
  shadowGen?: ShadowGenerator,
): Promise<SkinnedGltfRig> {
  const res = await SceneLoader.ImportMeshAsync(null, './assets/models/', filename, scene);
  const gltfRoot = res.meshes[0] as TransformNode;
  gltfRoot.parent = parentRoot;
  const meshes = res.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
  registerGltfShadows(meshes, shadowGen);
  return new SkinnedGltfRig(gltfRoot, meshes);
}

export class AttackerVisualRig {
  public readonly root: TransformNode;
  private variantARig: SkinnedGltfRig | null = null;
  private variantBRig: SkinnedGltfRig | null = null;
  private activeVariant: AttackerVariant = 'variant_a';
  private stickNodeA: TransformNode | null = null;
  private stickNodeB: TransformNode | null = null;

  constructor(_palette: MaterialPalette, scene: Scene) {
    this.root = new TransformNode('attacker_root', scene);
  }

  public async loadAsync(scene: Scene, shadowGen?: ShadowGenerator): Promise<void> {
    const [rigA, rigB, stickResA, stickResB] = await Promise.all([
      loadCharacterGltf('uddy_attacker_a.glb', scene, this.root, shadowGen),
      loadCharacterGltf('uddy_attacker_b.glb', scene, this.root, shadowGen),
      SceneLoader.ImportMeshAsync(null, './assets/models/', 'uddy_stick.glb', scene),
      SceneLoader.ImportMeshAsync(null, './assets/models/', 'uddy_stick.glb', scene),
    ]);

    this.variantARig = rigA;
    this.variantBRig = rigB;

    // Parent sticks directly inside each character's gltfRoot so coordinates match 1:1 in model space
    const setupStick = (res: Awaited<ReturnType<typeof SceneLoader.ImportMeshAsync>>, parentGltf: TransformNode) => {
      const stickRoot = new TransformNode('att_stick_model_space', scene);
      stickRoot.parent = parentGltf;
      // Undo Babylon __root__ conversion on imported stick child meshes by parenting raw stick nodes
      const importedRoot = res.meshes[0] as TransformNode;
      for (const c of [...importedRoot.getChildren()]) {
        c.parent = stickRoot;
      }
      importedRoot.dispose();
      const sMeshes = res.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
      registerGltfShadows(sMeshes, shadowGen);
      return stickRoot;
    };

    this.stickNodeA = setupStick(stickResA, rigA.gltfRoot);
    this.stickNodeB = setupStick(stickResB, rigB.gltfRoot);

    this.setVariant(this.activeVariant);
    this.updateAnimation(0, 0, 0, 0, 0);
  }

  public getTriangleStats(): { meshes: number; vertices: number; bones: number } {
    const rig = this.activeVariant === 'variant_a' ? this.variantARig : this.variantBRig;
    return rig ? rig.getMeshTriangleStats() : { meshes: 0, vertices: 0, bones: 0 };
  }

  public setVariant(variant: AttackerVariant): void {
    this.activeVariant = variant;
    if (this.variantARig) this.variantARig.gltfRoot.setEnabled(variant === 'variant_a');
    if (this.variantBRig) this.variantBRig.gltfRoot.setEnabled(variant === 'variant_b');
  }

  public updateAnimation(
    walkPhase: number,
    speedMps: number,
    charge01: number,
    swing01: number,
    feintLateral: number,
  ): void {
    const rig = this.activeVariant === 'variant_a' ? this.variantARig : this.variantBRig;
    const stickNode = this.activeVariant === 'variant_a' ? this.stickNodeA : this.stickNodeB;
    if (!rig || !stickNode) return;

    const speedFactor = Math.min(1, speedMps / 7.2);
    const stride = Math.sin(walkPhase) * 0.56 * speedFactor;
    const lKneeBend = Math.max(0.24, 0.36 + Math.max(0, -Math.sin(walkPhase)) * 0.65 * speedFactor);
    const rKneeBend = Math.max(0.24, 0.36 + Math.max(0, Math.sin(walkPhase)) * 0.65 * speedFactor);

    const torsoTwist = -0.36 * charge01 + 0.58 * Math.sin(swing01 * Math.PI) + feintLateral * 0.16;
    const torsoLean = 0.54 + 0.10 * speedFactor + 0.08 * charge01;

    // 1. Hierarchical forward hockey crouch: +X rotation bends +Y spine FORWARD (+Z), head counter-tilts -X to keep eyes on goal!
    const jointDeltas: Record<string, Quaternion> = {
      pelvis: Quaternion.RotationYawPitchRoll(torsoTwist * 0.25, 0.12, feintLateral * -0.05),
      spine_01: Quaternion.RotationYawPitchRoll(torsoTwist * 0.25, torsoLean * 0.34, 0),
      spine_02: Quaternion.RotationYawPitchRoll(torsoTwist * 0.25, torsoLean * 0.34, 0),
      spine_03: Quaternion.RotationYawPitchRoll(torsoTwist * 0.35, torsoLean * 0.32, 0),
      neck_01: Quaternion.RotationYawPitchRoll(-torsoTwist * 0.4, -torsoLean * 0.42, 0),
      head: Quaternion.RotationYawPitchRoll(-torsoTwist * 0.4, -torsoLean * 0.52, 0),
      thigh_l: Quaternion.RotationAxis(new Vector3(1, 0, 0), -0.40 + stride),
      calf_l: Quaternion.RotationAxis(new Vector3(1, 0, 0), lKneeBend),
      foot_l: Quaternion.RotationAxis(new Vector3(1, 0, 0), -lKneeBend * 0.35),
      thigh_r: Quaternion.RotationAxis(new Vector3(1, 0, 0), -0.35 - stride),
      calf_r: Quaternion.RotationAxis(new Vector3(1, 0, 0), rKneeBend),
      foot_r: Quaternion.RotationAxis(new Vector3(1, 0, 0), -rKneeBend * 0.35),
    };
    const absDeltas: Record<string, Quaternion> = {};

    const pelvisDrop = new Vector3(0, -0.09 - 0.04 * speedFactor - 0.03 * charge01 + Math.abs(Math.sin(walkPhase)) * 0.025 * speedFactor, 0);
    rig.applyModelSpacePose(jointDeltas, absDeltas, pelvisDrop);

    // 2. True two-handed hockey stick grip with clear ~0.34m hand separation & stick head near the turf!
    const swingFwd = Math.sin(swing01 * Math.PI) * 0.42 - charge01 * 0.36;
    const topGripTarget = new Vector3(
      0.06 + feintLateral * 0.07 - charge01 * 0.14 + Math.sin(swing01 * Math.PI) * 0.16,
      0.92 + charge01 * 0.10,
      0.34 + swingFwd * 0.25,
    );

    const lowGripTarget = new Vector3(
      -0.14 + feintLateral * 0.11 - charge01 * 0.18 + Math.sin(swing01 * Math.PI) * 0.24,
      0.62 + charge01 * 0.20,
      0.42 + swingFwd * 0.45,
    );

    // Solve two-bone IK in absolute model space for both arms onto separated grip points
    rig.solveLimbToModelTarget(
      'upperarm_l',
      'lowerarm_l',
      'hand_l',
      topGripTarget,
      new Vector3(0.75, -0.25, -0.6),
      absDeltas,
    );
    rig.solveLimbToModelTarget(
      'upperarm_r',
      'lowerarm_r',
      'hand_r',
      lowGripTarget,
      new Vector3(-0.75, -0.25, -0.6),
      absDeltas,
    );

    // Curl fingers inward around the handle (local +X bends fingers forward/inward into palm)
    const curlL = Quaternion.RotationAxis(new Vector3(0, 0, 1), -1.25).multiply(Quaternion.RotationAxis(new Vector3(1, 0, 0), 0.45));
    const curlR = Quaternion.RotationAxis(new Vector3(0, 0, 1), 1.25).multiply(Quaternion.RotationAxis(new Vector3(1, 0, 0), 0.45));
    for (const prefix of ['index', 'middle', 'ring', 'pinky']) {
      jointDeltas[`${prefix}_01_l`] = curlL;
      jointDeltas[`${prefix}_02_l`] = curlL;
      jointDeltas[`${prefix}_01_r`] = curlR;
      jointDeltas[`${prefix}_02_r`] = curlR;
    }

    rig.applyModelSpacePose(jointDeltas, absDeltas, pelvisDrop);

    // 3. Snap carbon field-hockey stick handle directly onto hand_l palm and aim straight through hand_r palm!
    const actualLeftHand = rig.getModelPos('hand_l');
    const actualRightHand = rig.getModelPos('hand_r');
    const shaftVec = actualRightHand.subtract(actualLeftHand);
    const shaftDir = shaftVec.lengthSquared() > 1e-5 ? shaftVec.normalize() : new Vector3(-0.42, -0.88, 0.22).normalize();

    // Stick local axis is (0, -1, 0) from top grip (0,0,0) down to J-hook, with flat playing face pointing +Z.
    stickNode.position.copyFrom(actualLeftHand);
    const qStick = new Quaternion();
    Quaternion.FromUnitVectorsToRef(new Vector3(0, -1, 0), shaftDir, qStick);
    stickNode.rotationQuaternion = qStick;
  }
}

export class KeeperVisualRig {
  public readonly root: TransformNode;
  private gltfRig: SkinnedGltfRig | null = null;
  private stickNode: TransformNode | null = null;
  private headColliderNode: TransformNode | null = null;
  private torsoColliderNode: TransformNode | null = null;
  private leftFootColliderNode: TransformNode | null = null;
  private rightFootColliderNode: TransformNode | null = null;
  private leftCalfColliderNode: TransformNode | null = null;
  private rightCalfColliderNode: TransformNode | null = null;
  private leftHandColliderNode: TransformNode | null = null;
  private rightHandColliderNode: TransformNode | null = null;

  constructor(_palette: MaterialPalette, scene: Scene) {
    this.root = new TransformNode('keeper_root', scene);
  }

  public async loadAsync(scene: Scene, shadowGen?: ShadowGenerator): Promise<void> {
    const [rig, stickRes] = await Promise.all([
      loadCharacterGltf('uddy_goalkeeper.glb', scene, this.root, shadowGen),
      SceneLoader.ImportMeshAsync(null, './assets/models/', 'uddy_stick.glb', scene),
    ]);
    this.gltfRig = rig;

    const stickRoot = new TransformNode('gk_stick_model_space', scene);
    stickRoot.parent = rig.gltfRoot;
    const importedRoot = stickRes.meshes[0] as TransformNode;
    for (const c of [...importedRoot.getChildren()]) {
      c.parent = stickRoot;
    }
    importedRoot.dispose();
    const sMeshes = stickRes.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    registerGltfShadows(sMeshes, shadowGen);
    this.stickNode = stickRoot;

    // Bind collider reference nodes straight to animated skeleton bones
    this.headColliderNode = rig.bones.get('head')?.node ?? null;
    this.torsoColliderNode = rig.bones.get('spine_02')?.node ?? null;
    this.leftFootColliderNode = rig.bones.get('foot_l')?.node ?? null;
    this.rightFootColliderNode = rig.bones.get('foot_r')?.node ?? null;
    this.leftCalfColliderNode = rig.bones.get('calf_l')?.node ?? null;
    this.rightCalfColliderNode = rig.bones.get('calf_r')?.node ?? null;
    this.leftHandColliderNode = rig.bones.get('hand_l')?.node ?? null;
    this.rightHandColliderNode = rig.bones.get('hand_r')?.node ?? null;

    this.updatePose('ready', 0, 0);
  }

  public getTriangleStats(): { meshes: number; vertices: number; bones: number } {
    return this.gltfRig ? this.gltfRig.getMeshTriangleStats() : { meshes: 0, vertices: 0, bones: 0 };
  }

  public updatePose(pose: KeeperPoseMode, progress01: number, lateralPhase: number): void {
    if (!this.gltfRig || !this.stickNode) return;
    const rig = this.gltfRig;
    const p = Math.sin(progress01 * Math.PI);
    const shuffleBob = Math.abs(Math.sin(lateralPhase)) * 0.035;

    let dropY = -0.11 - shuffleBob;
    let bodyTiltZ = 0;
    let lLegSpread = 0.16;
    let rLegSpread = -0.16;
    let lKnee = 0.42;
    let rKnee = 0.42;

    if (pose === 'shuffle_left' || pose === 'shuffle_right') {
      const s = Math.sin(lateralPhase) * 0.18;
      lLegSpread += Math.max(0, s);
      rLegSpread -= Math.max(0, -s);
    } else if (pose === 'save_low_left') {
      dropY -= 0.24 * p;
      bodyTiltZ = 0.22 * p;
      lLegSpread = 0.18 + 0.72 * p;
      lKnee = 0.2 + 0.15 * p;
    } else if (pose === 'save_low_right') {
      dropY -= 0.24 * p;
      bodyTiltZ = -0.22 * p;
      rLegSpread = -0.18 - 0.72 * p;
      rKnee = 0.2 + 0.15 * p;
    }

    const jointDeltas: Record<string, Quaternion> = {
      pelvis: Quaternion.RotationYawPitchRoll(0, 0.12, bodyTiltZ),
      spine_01: Quaternion.RotationAxis(new Vector3(1, 0, 0), 0.14),
      spine_02: Quaternion.RotationAxis(new Vector3(1, 0, 0), 0.12),
      head: Quaternion.RotationAxis(new Vector3(1, 0, 0), -0.30),
      thigh_l: Quaternion.RotationYawPitchRoll(0, -0.36, lLegSpread),
      calf_l: Quaternion.RotationYawPitchRoll(0, lKnee, 0),
      foot_l: Quaternion.RotationAxis(new Vector3(1, 0, 0), -0.08),
      thigh_r: Quaternion.RotationYawPitchRoll(0, -0.36, rLegSpread),
      calf_r: Quaternion.RotationYawPitchRoll(0, rKnee, 0),
      foot_r: Quaternion.RotationAxis(new Vector3(1, 0, 0), -0.08),
    };
    const absDeltas: Record<string, Quaternion> = {};

    const pelvisDrop = new Vector3(0, dropY, 0);
    rig.applyModelSpacePose(jointDeltas, absDeltas, pelvisDrop);

    // Position Left-Hand Blocker out in ready defensive guard & Right-Hand Stick ready across low right side
    const leftBlockerTarget = new Vector3(
      0.34 + (pose === 'save_high_blocker' ? 0.28 * p : pose === 'save_low_left' ? 0.35 * p : 0),
      1.02 + (pose === 'save_high_blocker' ? 0.48 * p : pose === 'save_low_left' ? -0.35 * p : 0),
      0.34,
    );
    const rightStickHandTarget = new Vector3(
      -0.32 - (pose === 'save_stick_sweep' ? 0.42 * p : pose === 'save_low_right' ? 0.32 * p : 0),
      0.86 - (pose === 'save_low_right' ? 0.32 * p : 0),
      0.32,
    );

    rig.solveLimbToModelTarget(
      'upperarm_l',
      'lowerarm_l',
      'hand_l',
      leftBlockerTarget,
      new Vector3(0.7, -0.2, -0.6),
      absDeltas,
    );
    rig.solveLimbToModelTarget(
      'upperarm_r',
      'lowerarm_r',
      'hand_r',
      rightStickHandTarget,
      new Vector3(-0.7, -0.2, -0.6),
      absDeltas,
    );
    // Tuck fingers neatly inside blocker/stick mit
    const curlL = Quaternion.RotationAxis(new Vector3(0, 0, 1), -1.35);
    const curlR = Quaternion.RotationAxis(new Vector3(0, 0, 1), 1.35);
    for (const prefix of ['index', 'middle', 'ring', 'pinky']) {
      jointDeltas[`${prefix}_01_l`] = curlL;
      jointDeltas[`${prefix}_02_l`] = curlL;
      jointDeltas[`${prefix}_01_r`] = curlR;
      jointDeltas[`${prefix}_02_r`] = curlR;
    }
    rig.applyModelSpacePose(jointDeltas, absDeltas, pelvisDrop);

    const rhPos = rig.getModelPos('hand_r');
    this.stickNode.position.copyFrom(rhPos);
    const stickDir = new Vector3(-0.22 - (pose === 'save_stick_sweep' ? 0.55 * p : 0), -0.92, 0.24).normalize();
    const qStick = new Quaternion();
    Quaternion.FromUnitVectorsToRef(new Vector3(0, -1, 0), stickDir, qStick);
    this.stickNode.rotationQuaternion = qStick;
  }

  public getWorldEquipmentColliders(keeperVel: { x: number; y: number; z: number }): OrientedBoxCollider[] {
    this.root.computeWorldMatrix(true);
    const yaw = this.root.rotation.y;

    const toBox = (
      node: TransformNode | null,
      fallbackOffset: Vector3,
      id: string,
      tag: OrientedBoxCollider['tag'],
      halfExtents: { x: number; y: number; z: number },
      restitution: number,
    ): OrientedBoxCollider => {
      let pos: Vector3;
      if (node) {
        const m: Matrix = node.computeWorldMatrix(true);
        pos = Vector3.TransformCoordinates(Vector3.Zero(), m);
      } else {
        pos = this.root.position.add(fallbackOffset);
      }
      return {
        id,
        tag,
        center: { x: pos.x, y: Math.max(halfExtents.y, pos.y), z: pos.z },
        halfExtents,
        yaw,
        restitution,
        velocity: keeperVel,
      };
    };

    return [
      toBox(this.leftFootColliderNode, new Vector3(-0.2, 0.1, 0.1), 'gk_kicker_l', 'keeper_kicker', { x: 0.11, y: 0.1, z: 0.18 }, 0.62),
      toBox(this.rightFootColliderNode, new Vector3(0.2, 0.1, 0.1), 'gk_kicker_r', 'keeper_kicker', { x: 0.11, y: 0.1, z: 0.18 }, 0.62),
      toBox(this.leftCalfColliderNode, new Vector3(-0.2, 0.4, 0.08), 'gk_guard_l', 'keeper_pad', { x: 0.12, y: 0.28, z: 0.11 }, 0.48),
      toBox(this.rightCalfColliderNode, new Vector3(0.2, 0.4, 0.08), 'gk_guard_r', 'keeper_pad', { x: 0.12, y: 0.28, z: 0.11 }, 0.48),
      toBox(this.torsoColliderNode, new Vector3(0, 1.05, 0), 'gk_torso', 'keeper_pad', { x: 0.25, y: 0.28, z: 0.16 }, 0.34),
      toBox(this.leftHandColliderNode, new Vector3(-0.35, 0.95, 0.2), 'gk_blocker', 'keeper_blocker', { x: 0.13, y: 0.17, z: 0.08 }, 0.54),
      toBox(this.headColliderNode, new Vector3(0, 1.55, 0), 'gk_helmet', 'keeper_helmet', { x: 0.14, y: 0.15, z: 0.15 }, 0.42),
      toBox(this.rightHandColliderNode, new Vector3(0.35, 0.55, 0.25), 'gk_stick', 'keeper_stick', { x: 0.14, y: 0.36, z: 0.14 }, 0.66),
    ];
  }
}
