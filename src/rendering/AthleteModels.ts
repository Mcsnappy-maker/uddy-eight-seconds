import {
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  ShadowGenerator,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
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

function registerShadows(meshes: Mesh[], shadowGen?: ShadowGenerator): void {
  for (const m of meshes) {
    m.receiveShadows = true;
    if (shadowGen) {
      shadowGen.addShadowCaster(m, false);
    }
  }
}

/**
 * Builds one continuous tapered field-hockey stick (grip handle -> carbon shaft -> curved J-hook)
 * with zero seams or gaps, flattened along Z to represent the flat left playing face.
 */
function buildFieldHockeyStick(
  name: string,
  lengthM: number,
  palette: MaterialPalette,
  scene: Scene,
  parent: TransformNode,
  meshesOut: Mesh[],
): TransformNode {
  const stickRoot = new TransformNode(`${name}_stickRoot`, scene);
  stickRoot.parent = parent;

  const shaftEnd = -(lengthM - 0.14);
  const path = [
    new Vector3(0, 0, 0),
    new Vector3(0, -0.34, 0),
    new Vector3(0, shaftEnd, 0),
    new Vector3(-0.012, -lengthM + 0.08, 0.02),
    new Vector3(-0.036, -lengthM + 0.036, 0.055),
    new Vector3(-0.072, -lengthM + 0.025, 0.095),
    new Vector3(-0.104, -lengthM + 0.042, 0.112),
    new Vector3(-0.122, -lengthM + 0.072, 0.102),
  ];

  const stickTube = MeshBuilder.CreateTube(
    `${name}_stick_body`,
    {
      path,
      tessellation: 14,
      cap: Mesh.CAP_ALL,
      radiusFunction: (i) => {
        if (i <= 1) return 0.0145;
        if (i === 2) return 0.016;
        return 0.019;
      },
    },
    scene,
  );
  stickTube.scaling = new Vector3(1.0, 1.0, 0.68);
  stickTube.material = palette.stickCarbon;
  stickTube.parent = stickRoot;
  meshesOut.push(stickTube);

  const grip = MeshBuilder.CreateCylinder(
    `${name}_grip`,
    { height: 0.36, diameterTop: 0.032, diameterBottom: 0.029, tessellation: 14 },
    scene,
  );
  grip.position.y = -0.18;
  grip.scaling = new Vector3(1.0, 1.0, 0.85);
  grip.material = palette.stickGrip;
  grip.parent = stickRoot;
  meshesOut.push(grip);

  return stickRoot;
}

/**
 * Solves a clean 2-bone analytical IK in parent space so the athlete's hands
 * land directly on the stick grip points across every locomotion/swing pose.
 */
function solveTwoBoneArmIK(
  shoulderPos: Vector3,
  targetPos: Vector3,
  upperLen: number,
  foreLen: number,
  poleHint: Vector3,
  shoulderNode: TransformNode,
  elbowNode: TransformNode,
): void {
  const toTarget = targetPos.subtract(shoulderPos);
  const rawDist = toTarget.length();
  const maxReach = upperLen + foreLen - 0.008;
  const minReach = Math.abs(upperLen - foreLen) + 0.02;
  const dist = Math.max(minReach, Math.min(maxReach, rawDist));
  const dir = rawDist > 1e-5 ? toTarget.scale(1 / rawDist) : new Vector3(0, -1, 0);

  // Law of cosines for shoulder angle & elbow angle
  const cosShoulder = Math.max(
    -1,
    Math.min(1, (upperLen * upperLen + dist * dist - foreLen * foreLen) / (2 * upperLen * dist)),
  );
  const sinShoulder = Math.sqrt(Math.max(0, 1 - cosShoulder * cosShoulder));

  // Orthonormal bend plane toward poleHint (outward/backward elbow hint)
  const proj = dir.scale(Vector3.Dot(poleHint, dir));
  let bendAxis = poleHint.subtract(proj);
  if (bendAxis.lengthSquared() < 1e-6) {
    bendAxis = new Vector3(0, 0, -1);
  } else {
    bendAxis.normalize();
  }

  const upperDir = dir.scale(cosShoulder).add(bendAxis.scale(sinShoulder)).normalize();
  const elbowWorld = shoulderPos.add(upperDir.scale(upperLen));
  const foreDir = targetPos.subtract(elbowWorld).normalize();

  // Align -Y of shoulderNode along upperDir
  const down = new Vector3(0, -1, 0);
  const shQuat = Quaternion.FromUnitVectorsToRef(down, upperDir, new Quaternion());
  shoulderNode.rotationQuaternion = shQuat;

  // Compute foreDir in shoulderNode local space and align -Y of elbowNode along it
  const invSh = shQuat.clone().conjugate();
  const foreLocal = new Vector3();
  foreDir.rotateByQuaternionToRef(invSh, foreLocal);
  foreLocal.normalize();
  const elQuat = Quaternion.FromUnitVectorsToRef(down, foreLocal, new Quaternion());
  elbowNode.rotationQuaternion = elQuat;
}

export class AttackerVisualRig {
  public readonly root: TransformNode;
  private readonly hips: TransformNode;
  private readonly torso: TransformNode;
  private readonly headPivot: TransformNode;
  private readonly leftUpperLeg: TransformNode;
  private readonly leftLowerLeg: TransformNode;
  private readonly rightUpperLeg: TransformNode;
  private readonly rightLowerLeg: TransformNode;
  private readonly leftUpperArm: TransformNode;
  private readonly leftForearm: TransformNode;
  private readonly rightUpperArm: TransformNode;
  private readonly rightForearm: TransformNode;
  private readonly stickPivot: TransformNode;
  private readonly meshes: Mesh[] = [];

  private readonly variantAJersey;
  private readonly variantBJersey;
  private readonly skinLight;
  private readonly skinRich;
  private readonly headMesh: Mesh;
  private readonly neckMesh: Mesh;
  private readonly noseMesh: Mesh;
  private readonly leftHandMesh: Mesh;
  private readonly rightHandMesh: Mesh;
  private readonly torsoMesh: Mesh;
  private readonly chestPadMesh: Mesh;
  private readonly leftSleeveMesh: Mesh;
  private readonly rightSleeveMesh: Mesh;
  private readonly skinParts: Mesh[] = [];

  private readonly upperArmLen = 0.27;
  private readonly forearmLen = 0.25;
  private readonly leftShoulderLocal = new Vector3(-0.195, 0.43, 0.01);
  private readonly rightShoulderLocal = new Vector3(0.195, 0.43, 0.01);

  constructor(palette: MaterialPalette, scene: Scene, shadowGen?: ShadowGenerator) {
    this.variantAJersey = palette.jerseyAttackerA;
    this.variantBJersey = palette.jerseyAttackerB;
    this.skinLight = palette.skinLightWarm;
    this.skinRich = palette.skinRichBrown;

    this.root = new TransformNode('attacker_root', scene);
    this.hips = new TransformNode('attacker_hips', scene);
    this.hips.parent = this.root;
    this.hips.position = new Vector3(0, 0.9, 0);

    // Sculpted Athletic Pelvis / Shorts Waistband (non-boxy)
    const pelvis = MeshBuilder.CreateCylinder(
      'att_pelvis',
      { height: 0.19, diameterTop: 0.31, diameterBottom: 0.34, tessellation: 18 },
      scene,
    );
    pelvis.scaling = new Vector3(1.02, 1.0, 0.7);
    pelvis.material = palette.shortsDarkBlue;
    pelvis.parent = this.hips;
    this.meshes.push(pelvis);

    const hipCap = MeshBuilder.CreateSphere(
      'att_hip_cap',
      { diameterX: 0.34, diameterY: 0.16, diameterZ: 0.23, segments: 12 },
      scene,
    );
    hipCap.position.y = -0.05;
    hipCap.material = palette.shortsDarkBlue;
    hipCap.parent = this.hips;
    this.meshes.push(hipCap);

    // Sculpted Athletic Torso
    this.torso = new TransformNode('att_torso_pivot', scene);
    this.torso.parent = this.hips;
    this.torso.position = new Vector3(0, 0.08, 0);

    this.torsoMesh = MeshBuilder.CreateCylinder(
      'att_torso',
      { height: 0.49, diameterTop: 0.39, diameterBottom: 0.3, tessellation: 18 },
      scene,
    );
    this.torsoMesh.position.y = 0.245;
    this.torsoMesh.scaling = new Vector3(1.04, 1.0, 0.68);
    this.torsoMesh.material = this.variantAJersey;
    this.torsoMesh.parent = this.torso;
    this.meshes.push(this.torsoMesh);

    this.chestPadMesh = MeshBuilder.CreateSphere(
      'att_chest_contour',
      { diameterX: 0.38, diameterY: 0.28, diameterZ: 0.24, segments: 12 },
      scene,
    );
    this.chestPadMesh.position = new Vector3(0, 0.33, 0.015);
    this.chestPadMesh.material = this.variantAJersey;
    this.chestPadMesh.parent = this.torso;
    this.meshes.push(this.chestPadMesh);

    // Head, Jaw, Nose, Eyes & Hair
    this.headPivot = new TransformNode('att_head_pivot', scene);
    this.headPivot.parent = this.torso;
    this.headPivot.position = new Vector3(0, 0.5, 0.02);

    this.neckMesh = MeshBuilder.CreateCylinder(
      'att_neck',
      { height: 0.11, diameterTop: 0.095, diameterBottom: 0.11, tessellation: 14 },
      scene,
    );
    this.neckMesh.position.y = 0.04;
    this.neckMesh.material = this.skinLight;
    this.neckMesh.parent = this.headPivot;
    this.meshes.push(this.neckMesh);

    this.headMesh = MeshBuilder.CreateSphere(
      'att_head',
      { diameterX: 0.185, diameterY: 0.23, diameterZ: 0.205, segments: 16 },
      scene,
    );
    this.headMesh.position.y = 0.175;
    this.headMesh.material = this.skinLight;
    this.headMesh.parent = this.headPivot;
    this.meshes.push(this.headMesh);

    this.noseMesh = MeshBuilder.CreateBox('att_nose', { width: 0.022, height: 0.042, depth: 0.028 }, scene);
    this.noseMesh.position = new Vector3(0, 0.165, 0.104);
    this.noseMesh.rotation.x = -0.25;
    this.noseMesh.material = this.skinLight;
    this.noseMesh.parent = this.headPivot;
    this.meshes.push(this.noseMesh);

    const hair = MeshBuilder.CreateSphere(
      'att_hair',
      { diameterX: 0.198, diameterY: 0.175, diameterZ: 0.215, segments: 14 },
      scene,
    );
    hair.position = new Vector3(0, 0.225, -0.02);
    hair.material = palette.hairDark;
    hair.parent = this.headPivot;
    this.meshes.push(hair);

    for (const side of [-1, 1]) {
      const sclera = MeshBuilder.CreateSphere(`att_sclera_${side}`, { diameter: 0.024, segments: 8 }, scene);
      sclera.position = new Vector3(side * 0.036, 0.19, 0.092);
      sclera.material = palette.eyeWhite;
      sclera.parent = this.headPivot;
      this.meshes.push(sclera);

      const pupil = MeshBuilder.CreateSphere(`att_eye_${side}`, { diameter: 0.014, segments: 8 }, scene);
      pupil.position = new Vector3(side * 0.036, 0.19, 0.101);
      pupil.material = palette.hairDark;
      pupil.parent = this.headPivot;
      this.meshes.push(pupil);
    }

    // Contoured Legs + Hooped Socks + Multi-part Sculpted Turf Shoes
    const buildLeg = (side: -1 | 1, label: string) => {
      const hipJ = new TransformNode(`att_${label}_hip`, scene);
      hipJ.parent = this.hips;
      hipJ.position = new Vector3(side * 0.105, -0.04, 0);

      const shortsLeg = MeshBuilder.CreateCylinder(
        `att_${label}_shorts_cuff`,
        { height: 0.24, diameterTop: 0.165, diameterBottom: 0.145, tessellation: 14 },
        scene,
      );
      shortsLeg.position.y = -0.11;
      shortsLeg.material = palette.shortsDarkBlue;
      shortsLeg.parent = hipJ;
      this.meshes.push(shortsLeg);

      const lowerThigh = MeshBuilder.CreateCylinder(
        `att_${label}_thigh_skin`,
        { height: 0.21, diameterTop: 0.132, diameterBottom: 0.112, tessellation: 14 },
        scene,
      );
      lowerThigh.position.y = -0.31;
      lowerThigh.material = this.skinLight;
      lowerThigh.parent = hipJ;
      this.meshes.push(lowerThigh);
      this.skinParts.push(lowerThigh);

      const kneeJ = new TransformNode(`att_${label}_knee`, scene);
      kneeJ.parent = hipJ;
      kneeJ.position = new Vector3(0, -0.415, 0);

      const kneeCap = MeshBuilder.CreateSphere(`att_${label}_knee_cap`, { diameter: 0.112, segments: 10 }, scene);
      kneeCap.material = this.skinLight;
      kneeCap.parent = kneeJ;
      this.meshes.push(kneeCap);
      this.skinParts.push(kneeCap);

      const shin = MeshBuilder.CreateCylinder(
        `att_${label}_shin`,
        { height: 0.38, diameterTop: 0.116, diameterBottom: 0.086, tessellation: 14 },
        scene,
      );
      shin.position.y = -0.195;
      shin.material = palette.socksHooped;
      shin.parent = kneeJ;
      this.meshes.push(shin);

      // Sculpted Turf Shoe (rounded toe + heel cup + gold flash + studded sole)
      const shoeHeel = MeshBuilder.CreateCapsule(
        `att_${label}_shoe_heel`,
        { height: 0.19, radius: 0.046, tessellation: 10 },
        scene,
      );
      shoeHeel.rotation.x = Math.PI * 0.5;
      shoeHeel.position = new Vector3(0, -0.395, 0.03);
      shoeHeel.scaling = new Vector3(1.0, 1.0, 0.85);
      shoeHeel.material = palette.turfShoeUpper;
      shoeHeel.parent = kneeJ;
      this.meshes.push(shoeHeel);

      const shoeStripe = MeshBuilder.CreateBox(
        `att_${label}_shoe_stripe`,
        { width: 0.098, height: 0.018, depth: 0.12 },
        scene,
      );
      shoeStripe.position = new Vector3(0, -0.392, 0.02);
      shoeStripe.material = palette.turfShoeAccent;
      shoeStripe.parent = kneeJ;
      this.meshes.push(shoeStripe);

      const shoeSole = MeshBuilder.CreateCapsule(
        `att_${label}_sole`,
        { height: 0.25, radius: 0.049, tessellation: 10 },
        scene,
      );
      shoeSole.rotation.x = Math.PI * 0.5;
      shoeSole.position = new Vector3(0, -0.43, 0.04);
      shoeSole.scaling = new Vector3(1.06, 1.0, 0.35);
      shoeSole.material = palette.turfShoeSole;
      shoeSole.parent = kneeJ;
      this.meshes.push(shoeSole);

      return { hipJ, kneeJ };
    };

    const leftLeg = buildLeg(-1, 'L');
    const rightLeg = buildLeg(1, 'R');
    this.leftUpperLeg = leftLeg.hipJ;
    this.leftLowerLeg = leftLeg.kneeJ;
    this.rightUpperLeg = rightLeg.hipJ;
    this.rightLowerLeg = rightLeg.kneeJ;

    // Articulated Arms with Rounded Shoulders, Forearms & Sculpted Hands
    const buildArm = (label: string, shPos: Vector3) => {
      const shJ = new TransformNode(`att_${label}_sh`, scene);
      shJ.parent = this.torso;
      shJ.position.copyFrom(shPos);

      const shoulderCap = MeshBuilder.CreateSphere(`att_${label}_shcap`, { diameter: 0.125, segments: 10 }, scene);
      shoulderCap.material = this.variantAJersey;
      shoulderCap.parent = shJ;
      this.meshes.push(shoulderCap);

      const sleeve = MeshBuilder.CreateCylinder(
        `att_${label}_sleeve`,
        { height: 0.16, diameterTop: 0.115, diameterBottom: 0.098, tessellation: 12 },
        scene,
      );
      sleeve.position.y = -0.075;
      sleeve.material = this.variantAJersey;
      sleeve.parent = shJ;
      this.meshes.push(sleeve);

      const uArm = MeshBuilder.CreateCylinder(
        `att_${label}_uarm`,
        { height: 0.14, diameterTop: 0.09, diameterBottom: 0.078, tessellation: 12 },
        scene,
      );
      uArm.position.y = -0.205;
      uArm.material = this.skinLight;
      uArm.parent = shJ;
      this.meshes.push(uArm);
      this.skinParts.push(uArm);

      const elbowJ = new TransformNode(`att_${label}_elbow`, scene);
      elbowJ.parent = shJ;
      elbowJ.position = new Vector3(0, -this.upperArmLen, 0);

      const elbowCap = MeshBuilder.CreateSphere(`att_${label}_elcap`, { diameter: 0.078, segments: 8 }, scene);
      elbowCap.material = this.skinLight;
      elbowCap.parent = elbowJ;
      this.meshes.push(elbowCap);
      this.skinParts.push(elbowCap);

      const fArm = MeshBuilder.CreateCylinder(
        `att_${label}_farm`,
        { height: this.forearmLen, diameterTop: 0.078, diameterBottom: 0.062, tessellation: 12 },
        scene,
      );
      fArm.position.y = -this.forearmLen * 0.5;
      fArm.material = this.skinLight;
      fArm.parent = elbowJ;
      this.meshes.push(fArm);
      this.skinParts.push(fArm);

      const hand = MeshBuilder.CreateSphere(
        `att_${label}_hand`,
        { diameterX: 0.056, diameterY: 0.072, diameterZ: 0.062, segments: 10 },
        scene,
      );
      hand.position.y = -this.forearmLen - 0.01;
      hand.material = this.skinLight;
      hand.parent = elbowJ;
      this.meshes.push(hand);

      return { shJ, elbowJ, sleeve, hand, shoulderCap };
    };

    const leftArm = buildArm('L', this.leftShoulderLocal);
    const rightArm = buildArm('R', this.rightShoulderLocal);
    this.leftUpperArm = leftArm.shJ;
    this.leftForearm = leftArm.elbowJ;
    this.rightUpperArm = rightArm.shJ;
    this.rightForearm = rightArm.elbowJ;
    this.leftSleeveMesh = leftArm.sleeve;
    this.rightSleeveMesh = rightArm.sleeve;
    this.leftHandMesh = leftArm.hand;
    this.rightHandMesh = rightArm.hand;
    this.meshes.push(leftArm.shoulderCap, rightArm.shoulderCap);

    // Field-hockey stick parented to torso, with analytical IK locking BOTH hands onto its grip!
    this.stickPivot = new TransformNode('att_stick_pivot', scene);
    this.stickPivot.parent = this.torso;
    this.stickPivot.position = new Vector3(0.08, 0.14, 0.25);
    buildFieldHockeyStick('att', 0.94, palette, scene, this.stickPivot, this.meshes);

    registerShadows(this.meshes, shadowGen);
    this.updateAnimation(0, 0, 0, 0, 0);
  }

  public setVariant(variant: AttackerVariant): void {
    const jersey = variant === 'variant_a' ? this.variantAJersey : this.variantBJersey;
    const skin = variant === 'variant_a' ? this.skinLight : this.skinRich;
    this.torsoMesh.material = jersey;
    this.chestPadMesh.material = jersey;
    this.leftSleeveMesh.material = jersey;
    this.rightSleeveMesh.material = jersey;
    for (const m of this.meshes) {
      if (m.name.includes('_shcap')) m.material = jersey;
    }
    this.headMesh.material = skin;
    this.neckMesh.material = skin;
    this.noseMesh.material = skin;
    this.leftHandMesh.material = skin;
    this.rightHandMesh.material = skin;
    for (const sp of this.skinParts) {
      sp.material = skin;
    }
    this.root.scaling = variant === 'variant_a' ? new Vector3(1, 1, 1) : new Vector3(0.97, 0.96, 0.97);
  }

  public updateAnimation(
    walkPhase: number,
    speedMps: number,
    charge01: number,
    swing01: number,
    feintLateral: number,
  ): void {
    const speedFactor = Math.min(1, speedMps / 7.5);
    const strideAmp = 0.62 * speedFactor;

    // Athletic forward hockey crouch
    const crouchY = 0.86 - 0.045 * speedFactor - 0.035 * charge01;
    this.hips.position.y = crouchY + Math.abs(Math.sin(walkPhase)) * 0.025 * speedFactor;
    this.hips.rotation.z = feintLateral * -0.12;
    this.torso.rotation.x = 0.26 + 0.11 * speedFactor + 0.12 * charge01;
    this.torso.rotation.y = -0.32 * charge01 + 0.52 * Math.sin(swing01 * Math.PI);
    this.headPivot.rotation.x = -0.22;

    const lHip = Math.sin(walkPhase) * strideAmp;
    const rHip = -Math.sin(walkPhase) * strideAmp;
    this.leftUpperLeg.rotation.x = -0.26 + lHip;
    this.leftLowerLeg.rotation.x = 0.4 + Math.max(0, -lHip) * 0.68;
    this.rightUpperLeg.rotation.x = -0.26 + rHip;
    this.rightLowerLeg.rotation.x = 0.4 + Math.max(0, -rHip) * 0.68;

    const backswing = charge01 * 0.78;
    const followThrough = Math.sin(swing01 * Math.PI) * 1.1;
    const stickPitch = -0.28 - backswing + followThrough;

    this.stickPivot.position = new Vector3(0.11 + feintLateral * 0.06, 0.09, 0.25);
    this.stickPivot.rotation.set(stickPitch, 0.08 - charge01 * 0.35 + followThrough * 0.3, -0.16 + feintLateral * 0.2);

    // Compute exact local torso-space points along the stick grip so BOTH hands grip the stick cleanly!
    const stickRotMatrix = Matrix.RotationYawPitchRoll(
      this.stickPivot.rotation.y,
      this.stickPivot.rotation.x,
      this.stickPivot.rotation.z,
    );
    const topGripOffset = Vector3.TransformCoordinates(new Vector3(0, -0.06, 0), stickRotMatrix);
    const midGripOffset = Vector3.TransformCoordinates(new Vector3(0, -0.26, 0), stickRotMatrix);

    const leftGripInTorso = this.stickPivot.position.add(topGripOffset);
    const rightGripInTorso = this.stickPivot.position.add(midGripOffset);

    solveTwoBoneArmIK(
      this.leftShoulderLocal,
      leftGripInTorso,
      this.upperArmLen,
      this.forearmLen,
      new Vector3(-0.6, -0.1, -0.8),
      this.leftUpperArm,
      this.leftForearm,
    );
    solveTwoBoneArmIK(
      this.rightShoulderLocal,
      rightGripInTorso,
      this.upperArmLen,
      this.forearmLen,
      new Vector3(0.65, -0.1, -0.8),
      this.rightUpperArm,
      this.rightForearm,
    );
  }
}

export class KeeperVisualRig {
  public readonly root: TransformNode;
  private readonly pelvis: TransformNode;
  private readonly torso: TransformNode;
  private readonly leftLegPivot: TransformNode;
  private readonly rightLegPivot: TransformNode;
  private readonly leftArmPivot: TransformNode;
  private readonly rightArmPivot: TransformNode;
  private readonly leftKickerMesh: Mesh;
  private readonly rightKickerMesh: Mesh;
  private readonly leftLegGuardMesh: Mesh;
  private readonly rightLegGuardMesh: Mesh;
  private readonly leftBlockerMesh: Mesh;
  private readonly torsoArmourMesh: Mesh;
  private readonly helmetMesh: Mesh;
  private readonly stickBladeMesh: Mesh;
  private readonly meshes: Mesh[] = [];

  constructor(palette: MaterialPalette, scene: Scene, shadowGen?: ShadowGenerator) {
    this.root = new TransformNode('keeper_root', scene);
    this.pelvis = new TransformNode('keeper_pelvis', scene);
    this.pelvis.parent = this.root;
    this.pelvis.position = new Vector3(0, 0.88, 0);

    // Contoured Padded Goalkeeper Girdle / Shorts (non-boxy)
    const girdle = MeshBuilder.CreateCylinder(
      'gk_girdle',
      { height: 0.24, diameterTop: 0.39, diameterBottom: 0.42, tessellation: 18 },
      scene,
    );
    girdle.scaling = new Vector3(1.05, 1.0, 0.72);
    girdle.material = palette.shortsDarkBlue;
    girdle.parent = this.pelvis;
    this.meshes.push(girdle);

    // Sculpted Padded Torso & Chest Armour
    this.torso = new TransformNode('gk_torso_pivot', scene);
    this.torso.parent = this.pelvis;
    this.torso.position = new Vector3(0, 0.1, 0);

    this.torsoArmourMesh = MeshBuilder.CreateCylinder(
      'gk_torso_armour',
      { height: 0.51, diameterTop: 0.47, diameterBottom: 0.37, tessellation: 18 },
      scene,
    );
    this.torsoArmourMesh.position.y = 0.255;
    this.torsoArmourMesh.scaling = new Vector3(1.06, 1.0, 0.68);
    this.torsoArmourMesh.material = palette.jerseyKeeper;
    this.torsoArmourMesh.parent = this.torso;
    this.meshes.push(this.torsoArmourMesh);

    // Flat beveled front chest-bib protector plate (replaces bulging capsules)
    const chestPlate = MeshBuilder.CreateCylinder(
      'gk_chest_plate',
      { height: 0.42, diameterTop: 0.36, diameterBottom: 0.28, tessellation: 8 },
      scene,
    );
    chestPlate.position = new Vector3(0, 0.26, 0.085);
    chestPlate.scaling = new Vector3(1.0, 1.0, 0.32);
    chestPlate.material = palette.keeperFoamPanel;
    chestPlate.parent = this.torso;
    this.meshes.push(chestPlate);

    for (const side of [-1, 1]) {
      // Rounded shoulder Pauldron Caps
      const shCap = MeshBuilder.CreateSphere(
        `gk_shpad_${side}`,
        { diameterX: 0.18, diameterY: 0.15, diameterZ: 0.21, segments: 12 },
        scene,
      );
      shCap.position = new Vector3(side * 0.265, 0.46, 0.0);
      shCap.material = palette.keeperFoamPanel;
      shCap.parent = this.torso;
      this.meshes.push(shCap);
    }

    // Neck + Field-Hockey Helmet Shell + Visor Peak + Chin Guard + Curved Steel Face Cage
    const neck = MeshBuilder.CreateCylinder('gk_neck', { height: 0.11, diameter: 0.135, tessellation: 14 }, scene);
    neck.position = new Vector3(0, 0.54, 0.02);
    neck.material = palette.keeperGloveDark;
    neck.parent = this.torso;
    this.meshes.push(neck);

    const innerHead = MeshBuilder.CreateSphere(
      'gk_inner_head',
      { diameterX: 0.175, diameterY: 0.205, diameterZ: 0.185, segments: 14 },
      scene,
    );
    innerHead.position = new Vector3(0, 0.69, 0.03);
    innerHead.material = palette.skinLightWarm;
    innerHead.parent = this.torso;
    this.meshes.push(innerHead);

    for (const side of [-1, 1]) {
      const eye = MeshBuilder.CreateSphere(`gk_eye_${side}`, { diameter: 0.02, segments: 8 }, scene);
      eye.position = new Vector3(side * 0.034, 0.70, 0.118);
      eye.material = palette.hairDark;
      eye.parent = this.torso;
      this.meshes.push(eye);
    }

    this.helmetMesh = MeshBuilder.CreateSphere(
      'gk_helmet_shell',
      { diameterX: 0.24, diameterY: 0.26, diameterZ: 0.28, segments: 16 },
      scene,
    );
    this.helmetMesh.position = new Vector3(0, 0.70, -0.005);
    this.helmetMesh.material = palette.keeperHelmetShell;
    this.helmetMesh.parent = this.torso;
    this.meshes.push(this.helmetMesh);

    const helmetBrow = MeshBuilder.CreateCapsule(
      'gk_helmet_brow',
      { height: 0.22, radius: 0.032, tessellation: 10 },
      scene,
    );
    helmetBrow.rotation.z = Math.PI * 0.5;
    helmetBrow.position = new Vector3(0, 0.77, 0.115);
    helmetBrow.material = palette.turfShoeAccent;
    helmetBrow.parent = this.torso;
    this.meshes.push(helmetBrow);

    const chinCup = MeshBuilder.CreateCapsule(
      'gk_helmet_chin',
      { height: 0.15, radius: 0.035, tessellation: 10 },
      scene,
    );
    chinCup.rotation.z = Math.PI * 0.5;
    chinCup.position = new Vector3(0, 0.585, 0.115);
    chinCup.material = palette.keeperHelmetShell;
    chinCup.parent = this.torso;
    this.meshes.push(chinCup);

    // Curved Steel Wire Face Cage
    for (let i = -2; i <= 2; i += 1) {
      const vBar = MeshBuilder.CreateCylinder(
        `gk_cage_v_${i}`,
        { height: 0.165, diameter: 0.007, tessellation: 6 },
        scene,
      );
      vBar.position = new Vector3(i * 0.026, 0.675, 0.152 - Math.abs(i) * 0.011);
      vBar.material = palette.keeperCageMetal;
      vBar.parent = this.torso;
      this.meshes.push(vBar);
    }
    for (const hOff of [-0.042, 0, 0.042]) {
      const hBar = MeshBuilder.CreateCylinder(
        `gk_cage_h_${hOff}`,
        { height: 0.125, diameter: 0.007, tessellation: 6 },
        scene,
      );
      hBar.rotation.z = Math.PI * 0.5;
      hBar.position = new Vector3(0, 0.675 + hOff, 0.15);
      hBar.material = palette.keeperCageMetal;
      hBar.parent = this.torso;
      this.meshes.push(hBar);
    }

    // Authentic Contoured Outdoor Field-Hockey Leg Guards + Strapped Foam Kickers over Turf Soles (NO SKATES!)
    const buildKeeperLeg = (side: -1 | 1, label: string) => {
      const legPivot = new TransformNode(`gk_${label}_leg`, scene);
      legPivot.parent = this.pelvis;
      legPivot.position = new Vector3(side * 0.15, -0.06, 0);

      const thigh = MeshBuilder.CreateCylinder(
        `gk_${label}_thigh`,
        { height: 0.34, diameterTop: 0.175, diameterBottom: 0.145, tessellation: 14 },
        scene,
      );
      thigh.position.y = -0.17;
      thigh.material = palette.shortsDarkBlue;
      thigh.parent = legPivot;
      this.meshes.push(thigh);

      // Curved contoured front foam leg guard
      const legGuard = MeshBuilder.CreateCylinder(
        `gk_${label}_legguard`,
        { height: 0.56, diameterTop: 0.195, diameterBottom: 0.175, tessellation: 14 },
        scene,
      );
      legGuard.position = new Vector3(0, -0.44, 0.068);
      legGuard.scaling = new Vector3(1.06, 1.0, 0.66);
      legGuard.material = palette.keeperFoamPanel;
      legGuard.parent = legPivot;
      this.meshes.push(legGuard);

      // Raised chamfered knee-roll bolster + inner pad wing
      const kneeRoll = MeshBuilder.CreateCapsule(
        `gk_${label}_kneeroll`,
        { height: 0.18, radius: 0.052, tessellation: 10 },
        scene,
      );
      kneeRoll.rotation.z = Math.PI * 0.5;
      kneeRoll.position = new Vector3(0, -0.19, 0.095);
      kneeRoll.material = palette.keeperFoamPanel;
      kneeRoll.parent = legPivot;
      this.meshes.push(kneeRoll);

      // Calf straps
      for (const sy of [-0.32, -0.54]) {
        const strap = MeshBuilder.CreateCylinder(
          `gk_${label}_strap_${sy}`,
          { height: 0.03, diameter: 0.16, tessellation: 12 },
          scene,
        );
        strap.position = new Vector3(0, sy, 0.02);
        strap.material = palette.keeperStrap;
        strap.parent = legPivot;
        this.meshes.push(strap);
      }

      // Sculpted Foam Kicker enclosing turf shoe (rounded toe + padded bridge + turf sole underneath)
      const kicker = MeshBuilder.CreateCapsule(
        `gk_${label}_kicker`,
        { height: 0.32, radius: 0.088, tessellation: 12 },
        scene,
      );
      kicker.rotation.x = Math.PI * 0.5;
      kicker.position = new Vector3(0, -0.735, 0.09);
      kicker.scaling = new Vector3(1.0, 1.0, 0.9);
      kicker.material = palette.keeperKicker;
      kicker.parent = legPivot;
      this.meshes.push(kicker);

      const turfSole = MeshBuilder.CreateCapsule(
        `gk_${label}_turfsole`,
        { height: 0.28, radius: 0.068, tessellation: 10 },
        scene,
      );
      turfSole.rotation.x = Math.PI * 0.5;
      turfSole.position = new Vector3(0, -0.808, 0.085);
      turfSole.scaling = new Vector3(1.05, 1.0, 0.32);
      turfSole.material = palette.turfShoeSole;
      turfSole.parent = legPivot;
      this.meshes.push(turfSole);

      return { legPivot, legGuard, kicker };
    };

    const leftLeg = buildKeeperLeg(-1, 'L');
    const rightLeg = buildKeeperLeg(1, 'R');
    this.leftLegPivot = leftLeg.legPivot;
    this.rightLegPivot = rightLeg.legPivot;
    this.leftLegGuardMesh = leftLeg.legGuard;
    this.rightLegGuardMesh = rightLeg.legGuard;
    this.leftKickerMesh = leftLeg.kicker;
    this.rightKickerMesh = rightLeg.kicker;

    // LEFT ARM (-X in keeper local frame): Sculpted Beveled Rectangular Field-Hockey Hand Protector / Blocker
    this.leftArmPivot = new TransformNode('gk_L_arm', scene);
    this.leftArmPivot.parent = this.torso;
    this.leftArmPivot.position = new Vector3(-0.28, 0.42, 0.02);

    const lSleeve = MeshBuilder.CreateCylinder(
      'gk_L_sleeve',
      { height: 0.26, diameterTop: 0.135, diameterBottom: 0.105, tessellation: 12 },
      scene,
    );
    lSleeve.position.y = -0.13;
    lSleeve.material = palette.jerseyKeeper;
    lSleeve.parent = this.leftArmPivot;
    this.meshes.push(lSleeve);

    const lForearm = MeshBuilder.CreateCylinder(
      'gk_L_forearm',
      { height: 0.23, diameterTop: 0.12, diameterBottom: 0.105, tessellation: 12 },
      scene,
    );
    lForearm.position = new Vector3(0, -0.32, 0.075);
    lForearm.rotation.x = -0.55;
    lForearm.material = palette.keeperGloveDark;
    lForearm.parent = this.leftArmPivot;
    this.meshes.push(lForearm);

    this.leftBlockerMesh = MeshBuilder.CreateCylinder(
      'gk_left_blocker',
      { height: 0.31, diameterTop: 0.21, diameterBottom: 0.21, tessellation: 8 },
      scene,
    );
    this.leftBlockerMesh.scaling = new Vector3(1.0, 1.0, 0.32);
    this.leftBlockerMesh.position = new Vector3(-0.04, -0.41, 0.19);
    this.leftBlockerMesh.material = palette.keeperFoamPanel;
    this.leftBlockerMesh.parent = this.leftArmPivot;
    this.meshes.push(this.leftBlockerMesh);

    const blockerTopRoll = MeshBuilder.CreateCapsule(
      'gk_blocker_top',
      { height: 0.2, radius: 0.036, tessellation: 8 },
      scene,
    );
    blockerTopRoll.rotation.z = Math.PI * 0.5;
    blockerTopRoll.position = new Vector3(-0.04, -0.255, 0.19);
    blockerTopRoll.material = palette.keeperFoamPanel;
    blockerTopRoll.parent = this.leftArmPivot;
    this.meshes.push(blockerTopRoll);

    // RIGHT ARM (+X in keeper local frame): Contoured Stick Glove Gripping True Field-Hockey Stick
    this.rightArmPivot = new TransformNode('gk_R_arm', scene);
    this.rightArmPivot.parent = this.torso;
    this.rightArmPivot.position = new Vector3(0.28, 0.42, 0.02);

    const rSleeve = MeshBuilder.CreateCylinder(
      'gk_R_sleeve',
      { height: 0.26, diameterTop: 0.135, diameterBottom: 0.105, tessellation: 12 },
      scene,
    );
    rSleeve.position.y = -0.13;
    rSleeve.material = palette.jerseyKeeper;
    rSleeve.parent = this.rightArmPivot;
    this.meshes.push(rSleeve);

    const rForearm = MeshBuilder.CreateCylinder(
      'gk_R_forearm',
      { height: 0.22, diameterTop: 0.115, diameterBottom: 0.098, tessellation: 12 },
      scene,
    );
    rForearm.position = new Vector3(0.01, -0.32, 0.07);
    rForearm.rotation.x = -0.5;
    rForearm.material = palette.keeperGloveDark;
    rForearm.parent = this.rightArmPivot;
    this.meshes.push(rForearm);

    const rStickGlove = MeshBuilder.CreateCapsule(
      'gk_right_stickglove',
      { height: 0.18, radius: 0.072, tessellation: 10 },
      scene,
    );
    rStickGlove.position = new Vector3(0.03, -0.41, 0.145);
    rStickGlove.material = palette.keeperGloveDark;
    rStickGlove.parent = this.rightArmPivot;
    this.meshes.push(rStickGlove);

    // Position stick handle right inside rStickGlove!
    const stickPivot = new TransformNode('gk_stick_holder', scene);
    stickPivot.parent = this.rightArmPivot;
    stickPivot.position = new Vector3(0.03, -0.34, 0.15);
    stickPivot.rotation.set(-0.18, 0, -0.3);
    buildFieldHockeyStick('gk', 0.96, palette, scene, stickPivot, this.meshes);

    this.stickBladeMesh = MeshBuilder.CreateBox(
      'gk_stick_hitbox_ref',
      { width: 0.06, height: 0.48, depth: 0.08 },
      scene,
    );
    this.stickBladeMesh.isVisible = false;
    this.stickBladeMesh.position = new Vector3(-0.08, -0.7, 0.08);
    this.stickBladeMesh.parent = stickPivot;

    registerShadows(this.meshes, shadowGen);
    this.updatePose('ready', 0, 0);
  }

  public updatePose(pose: KeeperPoseMode, progress01: number, lateralPhase: number): void {
    const p = Math.sin(progress01 * Math.PI);
    const shuffleBob = Math.abs(Math.sin(lateralPhase)) * 0.04;

    this.pelvis.position.y = 0.85 - shuffleBob;
    this.pelvis.rotation.z = 0;
    this.torso.rotation.x = 0.22;
    this.torso.rotation.z = 0;

    this.leftLegPivot.rotation.set(0, 0, 0.12);
    this.rightLegPivot.rotation.set(0, 0, -0.12);
    this.leftArmPivot.rotation.set(-0.25, 0, 0.28);
    this.rightArmPivot.rotation.set(-0.2, 0, -0.24);

    if (pose === 'shuffle_left' || pose === 'shuffle_right') {
      const s = Math.sin(lateralPhase) * 0.22;
      this.leftLegPivot.rotation.z = 0.15 + Math.max(0, s);
      this.rightLegPivot.rotation.z = -0.15 - Math.max(0, -s);
    } else if (pose === 'save_low_left') {
      this.pelvis.position.y = 0.85 - 0.34 * p;
      this.pelvis.rotation.z = -0.28 * p;
      this.leftLegPivot.rotation.z = 0.2 + 0.82 * p;
      this.rightLegPivot.rotation.z = -0.15 - 0.35 * p;
      this.leftArmPivot.rotation.z = 0.3 + 0.85 * p;
    } else if (pose === 'save_low_right') {
      this.pelvis.position.y = 0.85 - 0.34 * p;
      this.pelvis.rotation.z = 0.28 * p;
      this.rightLegPivot.rotation.z = -0.2 - 0.82 * p;
      this.leftLegPivot.rotation.z = 0.15 + 0.35 * p;
      this.rightArmPivot.rotation.z = -0.3 - 0.9 * p;
    } else if (pose === 'save_high_blocker') {
      this.leftArmPivot.rotation.x = -0.25 - 1.4 * p;
      this.leftArmPivot.rotation.z = 0.45 * p;
    } else if (pose === 'save_stick_sweep') {
      this.rightArmPivot.rotation.x = -0.5 - 0.6 * p;
      this.rightArmPivot.rotation.z = -0.95 * p;
      this.torso.rotation.z = 0.24 * p;
    }
  }

  public getWorldEquipmentColliders(keeperVel: { x: number; y: number; z: number }): OrientedBoxCollider[] {
    this.root.computeWorldMatrix(true);
    const yaw = this.root.rotation.y;

    const toBox = (
      mesh: Mesh,
      id: string,
      tag: OrientedBoxCollider['tag'],
      halfExtents: { x: number; y: number; z: number },
      restitution: number,
    ): OrientedBoxCollider => {
      const m: Matrix = mesh.computeWorldMatrix(true);
      const pos = Vector3.TransformCoordinates(Vector3.Zero(), m);
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
      toBox(this.leftKickerMesh, 'gk_kicker_l', 'keeper_kicker', { x: 0.11, y: 0.095, z: 0.18 }, 0.62),
      toBox(this.rightKickerMesh, 'gk_kicker_r', 'keeper_kicker', { x: 0.11, y: 0.095, z: 0.18 }, 0.62),
      toBox(this.leftLegGuardMesh, 'gk_guard_l', 'keeper_pad', { x: 0.115, y: 0.29, z: 0.09 }, 0.48),
      toBox(this.rightLegGuardMesh, 'gk_guard_r', 'keeper_pad', { x: 0.115, y: 0.29, z: 0.09 }, 0.48),
      toBox(this.torsoArmourMesh, 'gk_torso', 'keeper_pad', { x: 0.25, y: 0.27, z: 0.16 }, 0.34),
      toBox(this.leftBlockerMesh, 'gk_blocker', 'keeper_blocker', { x: 0.12, y: 0.165, z: 0.055 }, 0.54),
      toBox(this.helmetMesh, 'gk_helmet', 'keeper_helmet', { x: 0.14, y: 0.14, z: 0.15 }, 0.42),
      toBox(this.stickBladeMesh, 'gk_stick', 'keeper_stick', { x: 0.12, y: 0.28, z: 0.1 }, 0.66),
    ];
  }
}
